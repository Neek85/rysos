"""
Test de integración para el catálogo de actividades de Sanidad
configurable por organización — PECUARIO_ACTIVIDADES_SANIDAD (catálogo) +
PECUARIO_SANIDAD_REGISTROS (transaccional), incluido el aislamiento RLS
cruzado de ambas tablas (pedido explícito: el system prompt del proyecto
exige un test dedicado de este tipo para toda tarea que toque RLS, mismo
patrón que tests/test_pecuario_mortalidad_fotos.py).

Ver supabase/migrations/20260923130000_pecuario_sanidad_actividades_configurables.sql
(specs/pecuario_sanidad_actividades_configurables.md no existe en este
repo -- solo referenciada por la migración, nunca comiteada; mismo
hallazgo que Guano/Mortalidad-fotos. La migración trae suficiente
contexto en su propia cabecera para verificar sin ella).

La migración NO se aplica desde este archivo ni desde ningún script de este
repo -- ninguna migración SQL se aplica automáticamente contra la base real
(system prompt / docs/RYZOS_ORQUESTADOR_V3.1.md §4.1.4). Este archivo
verifica el contenido estático de la migración y del contrato Zod siempre,
y sus casos en vivo solo cuando ambas tablas ya existen (aplicadas a mano
en Supabase Studio) -- `unittest.SkipTest` explícito en caso contrario,
sin fallar la suite.
"""

import os
import time
import unittest
from pathlib import Path

import httpx
import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase" / "migrations" / "20260923130000_pecuario_sanidad_actividades_configurables.sql"
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

NEEDS_SUPABASE = pytest.mark.skipif(
    not SUPABASE_URL or not SUPABASE_ANON_KEY or not SUPABASE_SERVICE_ROLE_KEY,
    reason="SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY no configuradas — test requiere Supabase Live",
)

ORG_A = "ORG-TEST-DEMO"
ORG_B = "COOP-AROMAS-VALLE"
ADMIN_EMAIL = "admin-demo@ryzos-demo.test"


def _service_headers():
    return {"apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"}


def _session_headers(access_token):
    return {"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {access_token}"}


def _magic_link_access_token(email: str) -> str:
    gen = httpx.post(
        f"{SUPABASE_URL}/auth/v1/admin/generate_link",
        headers={"apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"},
        json={"type": "magiclink", "email": email},
        timeout=30,
    )
    gen.raise_for_status()
    gen_json = gen.json()
    hashed_token = (gen_json.get("properties") or {}).get("hashed_token") or gen_json.get("hashed_token")
    verify = httpx.post(
        f"{SUPABASE_URL}/auth/v1/verify",
        headers={"apikey": SUPABASE_ANON_KEY},
        json={"type": "magiclink", "token_hash": hashed_token},
        timeout=30,
    )
    verify.raise_for_status()
    return verify.json()["access_token"]


def _migracion_aplicada():
    try:
        cat = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_ACTIVIDADES_SANIDAD",
            headers=_service_headers(), params={"select": "id", "limit": 1}, timeout=15,
        )
        reg = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_SANIDAD_REGISTROS",
            headers=_service_headers(), params={"select": "id", "limit": 1}, timeout=15,
        )
    except Exception:
        return False
    return cat.status_code == 200 and reg.status_code == 200


class TestMigrationFileStatic(unittest.TestCase):
    """No requiere Supabase Live -- verifica el contenido de la migración
    en disco, siempre corre."""

    @classmethod
    def setUpClass(cls):
        if not MIGRATION_PATH.exists():
            raise AssertionError(f"No existe {MIGRATION_PATH}")
        cls.sql = MIGRATION_PATH.read_text(encoding="utf-8")

    def test_dos_tablas_catalogo_y_transaccional(self):
        self.assertIn('CREATE TABLE IF NOT EXISTS public."PECUARIO_ACTIVIDADES_SANIDAD"', self.sql)
        self.assertIn('CREATE TABLE IF NOT EXISTS public."PECUARIO_SANIDAD_REGISTROS"', self.sql)

    def test_activo_boolean_no_borrado_fisico(self):
        self.assertIn("activo BOOLEAN NOT NULL DEFAULT true", self.sql)

    def test_check_frecuencia_positiva(self):
        self.assertIn("chk_actividades_sanidad_frecuencia_positiva", self.sql)
        self.assertIn("CHECK (frecuencia_dias > 0)", self.sql)

    def test_fk_actividad_y_galpon(self):
        self.assertIn("fk_sanidad_registros_actividad", self.sql)
        self.assertIn('REFERENCES public."PECUARIO_ACTIVIDADES_SANIDAD"(id) ON DELETE RESTRICT', self.sql)
        self.assertIn("fk_sanidad_registros_galpon", self.sql)

    def test_trigger_guarda_galpon_ambos_sentidos(self):
        self.assertIn("trg_validar_sanidad_registro_galpon", self.sql)
        self.assertIn("v_alcance = 'galpon' AND NEW.galpon_id IS NULL", self.sql)
        self.assertIn("v_alcance = 'granja' AND NEW.galpon_id IS NOT NULL", self.sql)

    def test_rls_habilitado_en_ambas_tablas(self):
        self.assertIn('ALTER TABLE public."PECUARIO_ACTIVIDADES_SANIDAD" ENABLE ROW LEVEL SECURITY', self.sql)
        self.assertIn('ALTER TABLE public."PECUARIO_SANIDAD_REGISTROS" ENABLE ROW LEVEL SECURITY', self.sql)

    def test_preflight_exige_galpones_y_auth_org_id(self):
        self.assertIn('to_regclass(\'public."PECUARIO_GALPONES"\')', self.sql)
        self.assertIn("proname = 'auth_org_id'", self.sql)

    def test_no_hace_drop_de_tablas_viejas(self):
        # v2 (PECUARIO_CONTROL_SANITARIO/PECUARIO_LIMPIEZA_GALPON) queda
        # marcada SUPERADA vía COMMENT ON, nunca DROP -- la cabecera SÍ
        # menciona "DROP TABLE" en prosa (explicando por qué no se usa),
        # así que se busca la sentencia real, no la mención.
        self.assertNotIn('DROP TABLE public."PECUARIO_CONTROL_SANITARIO"', self.sql)
        self.assertNotIn('DROP TABLE public."PECUARIO_LIMPIEZA_GALPON"', self.sql)
        self.assertIn('COMMENT ON TABLE public."PECUARIO_CONTROL_SANITARIO"', self.sql)
        self.assertIn('COMMENT ON TABLE public."PECUARIO_LIMPIEZA_GALPON"', self.sql)

    def test_no_siembra_catalogo_inicial(self):
        # Spec deja "sembrar actividades por defecto" sin confirmar -- no
        # debe haber ningún INSERT hardcodeado en PECUARIO_ACTIVIDADES_SANIDAD.
        self.assertNotIn('INSERT INTO public."PECUARIO_ACTIVIDADES_SANIDAD"', self.sql)


class TestZodContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parent.parent / "lib" / "validations" / "pecuario.ts"
        if not path.exists():
            raise AssertionError(f"No existe {path}")
        cls.ts = path.read_text(encoding="utf-8")

    def test_ambos_schemas_exportados(self):
        self.assertIn("export const SanidadActividadSchema", self.ts)
        self.assertIn("export const SanidadRegistroSchema", self.ts)
        self.assertIn("export type SanidadActividadInput", self.ts)
        self.assertIn("export type SanidadRegistroInput", self.ts)

    def test_campos_minimos_presentes(self):
        start = self.ts.index("export const SanidadActividadSchema")
        end = self.ts.index("export type SanidadActividadInput")
        body = self.ts[start:end]
        for campo in ("nombre", "alcance", "frecuencia_dias"):
            with self.subTest(campo=campo):
                self.assertIn(f"{campo}:", body)


@NEEDS_SUPABASE
class TestSanidadActividadesLive(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not _migracion_aplicada():
            raise unittest.SkipTest(
                "PECUARIO_ACTIVIDADES_SANIDAD/PECUARIO_SANIDAD_REGISTROS no existen "
                "todavía -- 20260923130000_pecuario_sanidad_actividades_configurables.sql "
                "no aplicada (aplicación manual pendiente, ver §4.1.4)."
            )
        cls.admin_token = _magic_link_access_token(ADMIN_EMAIL)

    def setUp(self):
        self.suffix = str(int(time.time() * 1000))
        self._cleanup = []  # list of (table, field, value), LIFO en tearDown

    def tearDown(self):
        for table, field, value in reversed(self._cleanup):
            httpx.delete(f"{SUPABASE_URL}/rest/v1/{table}", headers=_service_headers(), params={field: f"eq.{value}"}, timeout=30)

    def _crear_actividad(self, org=ORG_A, alcance="granja", frecuencia=7):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_ACTIVIDADES_SANIDAD",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": org, "nombre": f"TEST-SANIDAD-{self.suffix}", "alcance": alcance, "frecuencia_dias": frecuencia},
            timeout=30,
        )
        res.raise_for_status()
        actividad_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_ACTIVIDADES_SANIDAD", "id", actividad_id))
        return actividad_id

    def _crear_galpon(self, org=ORG_A):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_GALPONES",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": org, "codigo_galpon": f"TEST-SANIDAD-{self.suffix}"},
            timeout=30,
        )
        res.raise_for_status()
        galpon_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_GALPONES", "id", galpon_id))
        return galpon_id

    # ---- CHECK / trigger de la lógica de negocio ----

    def test_frecuencia_cero_falla_check(self):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_ACTIVIDADES_SANIDAD",
            headers={**_service_headers(), "Content-Type": "application/json"},
            json={"ID_Organizacion": ORG_A, "nombre": f"TEST-FRECCERO-{self.suffix}", "alcance": "granja", "frecuencia_dias": 0},
            timeout=30,
        )
        self.assertEqual(res.status_code, 400, res.text)

    def test_registro_granja_con_galpon_falla_trigger(self):
        actividad_id = self._crear_actividad(alcance="granja")
        galpon_id = self._crear_galpon()
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_SANIDAD_REGISTROS",
            headers={**_service_headers(), "Content-Type": "application/json"},
            json={"ID_Organizacion": ORG_A, "actividad_id": actividad_id, "galpon_id": galpon_id},
            timeout=30,
        )
        self.assertEqual(res.status_code, 400, res.text)

    def test_registro_galpon_sin_galpon_falla_trigger(self):
        actividad_id = self._crear_actividad(alcance="galpon")
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_SANIDAD_REGISTROS",
            headers={**_service_headers(), "Content-Type": "application/json"},
            json={"ID_Organizacion": ORG_A, "actividad_id": actividad_id},
            timeout=30,
        )
        self.assertEqual(res.status_code, 400, res.text)

    def test_registro_valido_granja_sin_galpon(self):
        actividad_id = self._crear_actividad(alcance="granja")
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_SANIDAD_REGISTROS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": ORG_A, "actividad_id": actividad_id},
            timeout=30,
        )
        self.assertEqual(res.status_code, 201, res.text)
        row = res.json()[0]
        self._cleanup.append(("PECUARIO_SANIDAD_REGISTROS", "id", row["id"]))
        self.assertIsNone(row["galpon_id"])

    def test_registro_valido_galpon_con_galpon(self):
        actividad_id = self._crear_actividad(alcance="galpon")
        galpon_id = self._crear_galpon()
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_SANIDAD_REGISTROS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": ORG_A, "actividad_id": actividad_id, "galpon_id": galpon_id},
            timeout=30,
        )
        self.assertEqual(res.status_code, 201, res.text)
        row = res.json()[0]
        self._cleanup.append(("PECUARIO_SANIDAD_REGISTROS", "id", row["id"]))
        self.assertEqual(row["galpon_id"], galpon_id)

    # ---- Aislamiento RLS cruzado -- pedido explícito, ambas tablas ----

    def test_actividades_authenticated_session_can_write_own_org(self):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_ACTIVIDADES_SANIDAD",
            headers={**_session_headers(self.admin_token), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": ORG_A, "nombre": f"TEST-SESSION-{self.suffix}", "alcance": "granja", "frecuencia_dias": 15},
            timeout=30,
        )
        self.assertEqual(res.status_code, 201, res.text)
        self._cleanup.append(("PECUARIO_ACTIVIDADES_SANIDAD", "id", res.json()[0]["id"]))

    def test_actividades_cross_org_read_isolation(self):
        actividad_b = self._crear_actividad(org=ORG_B)
        read = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_ACTIVIDADES_SANIDAD",
            headers=_session_headers(self.admin_token), params={"id": f"eq.{actividad_b}"}, timeout=30,
        )
        self.assertEqual(read.status_code, 200)
        self.assertEqual(read.json(), [], "Una sesión autenticada de ORG_A no debe ver actividades de Sanidad de ORG_B.")

    def test_actividades_cross_org_insert_rejected(self):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_ACTIVIDADES_SANIDAD",
            headers={**_session_headers(self.admin_token), "Content-Type": "application/json"},
            json={"ID_Organizacion": ORG_B, "nombre": f"TEST-CROSSORG-{self.suffix}", "alcance": "granja", "frecuencia_dias": 10},
            timeout=30,
        )
        self.assertIn(
            res.status_code, (401, 403),
            f"Una sesión autenticada de ORG_A no debe poder insertar una actividad con ID_Organizacion de ORG_B. status={res.status_code} body={res.text}",
        )

    def test_registros_authenticated_session_can_write_own_org(self):
        actividad_id = self._crear_actividad()
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_SANIDAD_REGISTROS",
            headers={**_session_headers(self.admin_token), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": ORG_A, "actividad_id": actividad_id},
            timeout=30,
        )
        self.assertEqual(res.status_code, 201, res.text)
        self._cleanup.append(("PECUARIO_SANIDAD_REGISTROS", "id", res.json()[0]["id"]))

    def test_registros_cross_org_read_isolation(self):
        actividad_b = self._crear_actividad(org=ORG_B)
        seed = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_SANIDAD_REGISTROS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": ORG_B, "actividad_id": actividad_b},
            timeout=30,
        )
        seed.raise_for_status()
        seeded_id = seed.json()[0]["id"]
        self._cleanup.append(("PECUARIO_SANIDAD_REGISTROS", "id", seeded_id))

        read = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_SANIDAD_REGISTROS",
            headers=_session_headers(self.admin_token), params={"id": f"eq.{seeded_id}"}, timeout=30,
        )
        self.assertEqual(read.status_code, 200)
        self.assertEqual(read.json(), [], "Una sesión autenticada de ORG_A no debe ver registros de Sanidad de ORG_B.")

    def test_registros_cross_org_insert_rejected(self):
        actividad_b = self._crear_actividad(org=ORG_B)
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_SANIDAD_REGISTROS",
            headers={**_session_headers(self.admin_token), "Content-Type": "application/json"},
            json={"ID_Organizacion": ORG_B, "actividad_id": actividad_b},
            timeout=30,
        )
        self.assertIn(
            res.status_code, (401, 403),
            f"Una sesión autenticada de ORG_A no debe poder insertar un registro con ID_Organizacion de ORG_B. status={res.status_code} body={res.text}",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
