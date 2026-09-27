"""
Test de integración para el ítem 9 del roadmap Pecuario: alerta de
consanguinidad en Empadre/Alta — solo capa de datos (configuración por
organización, chequeo de "jaula ya ocupada", auditoría de la
confirmación del técnico). No hay Server Action que probar en este
repo (confirmado antes de esta tarea: Pecuario no tiene esa capa acá)
-- todo Python contra Supabase directo, mismo patrón que el resto de
la suite de Pecuario.

Ver supabase/migrations/20260927100000_pecuario_alerta_consanguinidad_config.sql
(specs/pecuario_alerta_consanguinidad_empadre.md referenciada, no
existe en este repo -- mismo hallazgo recurrente de toda esta ronda, no
se fabrica).

No crea lógica de consanguinidad nueva -- fn_son_parientes() ya existe
desde v3 (2026-09-11); este ítem solo agrega configuración,
fn_jaula_tiene_otro_macho_activo() y 2 columnas de auditoría. Ningún
CHECK/trigger nuevo bloquea nada por diseño (advertencia, nunca acción
bloqueante) -- ver el test explícito de eso más abajo.

Usa la organización real GRANJA-VALENCIA (mismo criterio que el resto
de la suite) para los casos de negocio -- todas las filas de estos
tests son descartables, con prefijo TEST-, creadas y borradas dentro de
cada test. El aislamiento cruzado usa ORG-TEST-DEMO.

La migración NO se aplica desde este archivo ni desde ningún script de
este repo -- ninguna migración SQL se aplica automáticamente contra la
base real (system prompt / docs/RYZOS_ORQUESTADOR_V3.1.md §4.1.4). Este
archivo verifica el contenido estático de la migración siempre, y sus
casos en vivo solo cuando las columnas/función nuevas ya existen
(aplicadas a mano en Supabase Studio) -- `unittest.SkipTest` explícito
en caso contrario, sin fallar la suite.
"""

import os
import time
import unittest
from pathlib import Path

import httpx
import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase" / "migrations" / "20260927100000_pecuario_alerta_consanguinidad_config.sql"
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

NEEDS_SUPABASE = pytest.mark.skipif(
    not SUPABASE_URL or not SUPABASE_ANON_KEY or not SUPABASE_SERVICE_ROLE_KEY,
    reason="SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY no configuradas — test requiere Supabase Live",
)

ORG_A = "GRANJA-VALENCIA"     # organización real, mismo criterio que el resto de la suite
ORG_B = "ORG-TEST-DEMO"       # "otra organización" para el aislamiento cruzado
ADMIN_EMAIL = "admin-demo@ryzos-demo.test"  # cuenta admin de ORG_B, ya usada en el resto de la suite


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
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_CONFIGURACION",
            headers=_service_headers(),
            params={"select": "alerta_consanguinidad_activa,generaciones_consanguinidad", "limit": 1},
            timeout=15,
        )
        if res.status_code != 200:
            return False
        for tabla in ("PECUARIO_HISTORIAL_MACHOS", "PECUARIO_REPRODUCTORES"):
            res = httpx.get(
                f"{SUPABASE_URL}/rest/v1/{tabla}",
                headers=_service_headers(), params={"select": "advertencia_confirmada", "limit": 1}, timeout=15,
            )
            if res.status_code != 200:
                return False
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/rpc/fn_jaula_tiene_otro_macho_activo",
            headers={**_service_headers(), "Content-Type": "application/json"},
            json={"p_jaula_id": "00000000-0000-0000-0000-000000000000"},
            timeout=15,
        )
        if res.status_code != 200:
            return False
    except Exception:
        return False
    return True


class TestMigrationFileStatic(unittest.TestCase):
    """No requiere Supabase Live -- verifica el contenido de la migración
    en disco, siempre corre."""

    @classmethod
    def setUpClass(cls):
        if not MIGRATION_PATH.exists():
            raise AssertionError(f"No existe {MIGRATION_PATH}")
        cls.sql = MIGRATION_PATH.read_text(encoding="utf-8")

    def test_wrapped_in_transaction(self):
        self.assertIn("BEGIN;", self.sql)
        self.assertIn("COMMIT;", self.sql)

    def test_no_reescribe_fn_son_parientes(self):
        self.assertNotIn("fn_son_parientes(animal_a", self.sql)
        self.assertNotIn("CREATE OR REPLACE FUNCTION public.fn_son_parientes", self.sql)

    def test_columnas_config_con_default_correcto(self):
        self.assertIn("alerta_consanguinidad_activa BOOLEAN NOT NULL DEFAULT true", self.sql)
        self.assertIn("generaciones_consanguinidad INT NOT NULL DEFAULT 3", self.sql)

    def test_columnas_auditoria_advertencia_confirmada(self):
        self.assertEqual(self.sql.count("advertencia_confirmada BOOLEAN NOT NULL DEFAULT false"), 2)
        self.assertIn('ALTER TABLE public."PECUARIO_HISTORIAL_MACHOS" ADD COLUMN IF NOT EXISTS advertencia_confirmada', self.sql)
        self.assertIn('ALTER TABLE public."PECUARIO_REPRODUCTORES" ADD COLUMN IF NOT EXISTS advertencia_confirmada', self.sql)

    def test_fn_jaula_tiene_otro_macho_activo_nueva(self):
        self.assertIn("CREATE OR REPLACE FUNCTION public.fn_jaula_tiene_otro_macho_activo", self.sql)
        self.assertIn("sexo = 'macho'", self.sql)
        self.assertIn("estado = 'activo'", self.sql)

    def test_sin_check_ni_trigger_nuevo(self):
        self.assertNotIn("CREATE TRIGGER", self.sql)
        self.assertNotIn("ADD CONSTRAINT", self.sql)
        self.assertNotIn("CHECK (", self.sql)

    def test_preflight_exige_dependencias(self):
        self.assertIn('to_regclass(\'public."PECUARIO_REPRODUCTORES"\')', self.sql)
        self.assertIn('to_regclass(\'public."PECUARIO_CONFIGURACION"\')', self.sql)
        self.assertIn('to_regclass(\'public."PECUARIO_HISTORIAL_MACHOS"\')', self.sql)


class TestZodContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parent.parent / "lib" / "validations" / "pecuario.ts"
        if not path.exists():
            raise AssertionError(f"No existe {path}")
        cls.ts = path.read_text(encoding="utf-8")

    def test_reproductor_schema_gana_advertencia_confirmada(self):
        start = self.ts.index("export const ReproductorSchema")
        end = self.ts.index("export const HistorialMachoSchema")
        body = self.ts[start:end]
        self.assertIn("padre_id: z.string().uuid().optional().nullable()", body, "padre_id ya debía existir -- no se tocó.")
        self.assertIn("advertencia_confirmada: z.boolean().optional().default(false)", body)

    def test_historial_macho_schema_gana_advertencia_confirmada(self):
        start = self.ts.index("export const HistorialMachoSchema")
        end = self.ts.index("export const", start + 1)
        body = self.ts[start:end]
        self.assertIn("advertencia_confirmada: z.boolean().optional().default(false)", body)

    def test_no_se_creo_ningun_schema_nuevo(self):
        self.assertNotIn("ConsanguinidadSchema", self.ts)
        self.assertNotIn("AlertaConsanguinidadSchema", self.ts)


@NEEDS_SUPABASE
class TestAlertaConsanguinidadLive(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not _migracion_aplicada():
            raise unittest.SkipTest(
                "PECUARIO_CONFIGURACION.alerta_consanguinidad_activa/generaciones_consanguinidad, "
                "advertencia_confirmada (HISTORIAL_MACHOS/REPRODUCTORES) o "
                "fn_jaula_tiene_otro_macho_activo no existen todavía -- "
                "20260927100000_pecuario_alerta_consanguinidad_config.sql "
                "no aplicada (aplicación manual pendiente, ver §4.1.4)."
            )
        cls.otra_org_token = _magic_link_access_token(ADMIN_EMAIL)

    def setUp(self):
        self.suffix = str(int(time.time() * 1000))
        self._cleanup = []  # list of (table, field, value), LIFO en tearDown

    def tearDown(self):
        for table, field, value in reversed(self._cleanup):
            httpx.delete(f"{SUPABASE_URL}/rest/v1/{table}", headers=_service_headers(), params={field: f"eq.{value}"}, timeout=30)

    def _crear_jaula(self, org=ORG_A):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_JAULAS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": org, "codigo_poza": f"TEST-CONSANG-{self.suffix}-{len(self._cleanup)}"},
            timeout=30,
        )
        res.raise_for_status()
        jaula_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_JAULAS", "id", jaula_id))
        return jaula_id

    def _crear_reproductor(self, sexo, madre_id=None, padre_id=None, jaula_actual_id=None,
                            estado="activo", advertencia_confirmada=None, org=ORG_A):
        payload = {"ID_Organizacion": org, "codigo_arete": f"TEST-CONSANG-{self.suffix}-{len(self._cleanup)}", "sexo": sexo, "estado": estado}
        if madre_id is not None:
            payload["madre_id"] = madre_id
        if padre_id is not None:
            payload["padre_id"] = padre_id
        if jaula_actual_id is not None:
            payload["jaula_actual_id"] = jaula_actual_id
        if advertencia_confirmada is not None:
            payload["advertencia_confirmada"] = advertencia_confirmada
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_REPRODUCTORES",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json=payload, timeout=30,
        )
        res.raise_for_status()
        animal_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_REPRODUCTORES", "id", animal_id))
        return animal_id

    def _son_parientes(self, animal_a, animal_b, generaciones=None):
        payload = {"animal_a": animal_a, "animal_b": animal_b}
        if generaciones is not None:
            payload["generaciones"] = generaciones
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/rpc/fn_son_parientes",
            headers={**_service_headers(), "Content-Type": "application/json"},
            json=payload, timeout=30,
        )
        res.raise_for_status()
        return res.json()

    def _jaula_tiene_otro_macho_activo(self, jaula_id, macho_id_excluir=None):
        payload = {"p_jaula_id": jaula_id}
        if macho_id_excluir is not None:
            payload["p_macho_id_excluir"] = macho_id_excluir
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/rpc/fn_jaula_tiene_otro_macho_activo",
            headers={**_service_headers(), "Content-Type": "application/json"},
            json=payload, timeout=30,
        )
        res.raise_for_status()
        return res.json()

    def _get_config(self, org=ORG_A):
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_CONFIGURACION", headers=_service_headers(),
            params={"ID_Organizacion": f"eq.{org}", "select": "alerta_consanguinidad_activa,generaciones_consanguinidad"},
            timeout=30,
        )
        res.raise_for_status()
        return res.json()

    # ---- fn_son_parientes(): no-regresión ----

    def test_fn_son_parientes_detecta_hermanos_por_madre_comun(self):
        madre = self._crear_reproductor("hembra")
        hijo_a = self._crear_reproductor("macho", madre_id=madre)
        hijo_b = self._crear_reproductor("hembra", madre_id=madre)

        self.assertTrue(self._son_parientes(hijo_a, hijo_b))

    def test_fn_son_parientes_false_sin_relacion(self):
        animal_a = self._crear_reproductor("macho")
        animal_b = self._crear_reproductor("hembra")

        self.assertFalse(self._son_parientes(animal_a, animal_b))

    def test_fn_son_parientes_detecta_padre_hijo_directo(self):
        padre = self._crear_reproductor("macho")
        hijo = self._crear_reproductor("hembra", padre_id=padre)

        self.assertTrue(self._son_parientes(padre, hijo))

    # ---- fn_jaula_tiene_otro_macho_activo(): caso nuevo ----

    def test_jaula_tiene_otro_macho_activo_true_cuando_hay_uno(self):
        jaula = self._crear_jaula()
        self._crear_reproductor("macho", jaula_actual_id=jaula, estado="activo")

        self.assertTrue(self._jaula_tiene_otro_macho_activo(jaula))

    def test_jaula_tiene_otro_macho_activo_false_sin_macho(self):
        jaula = self._crear_jaula()

        self.assertFalse(self._jaula_tiene_otro_macho_activo(jaula))

    def test_jaula_tiene_otro_macho_activo_false_si_el_macho_esta_vendido(self):
        jaula = self._crear_jaula()
        self._crear_reproductor("macho", jaula_actual_id=jaula, estado="vendido")

        self.assertFalse(self._jaula_tiene_otro_macho_activo(jaula))

    def test_jaula_tiene_otro_macho_activo_excluye_al_propio_macho_reasignado(self):
        jaula = self._crear_jaula()
        macho = self._crear_reproductor("macho", jaula_actual_id=jaula, estado="activo")

        # El mismo macho, reasignado a su propia jaula -- no debe contar
        # como "otro" macho al excluirse a sí mismo.
        self.assertFalse(self._jaula_tiene_otro_macho_activo(jaula, macho_id_excluir=macho))
        # Sin excluir a nadie, sigue viéndose a sí mismo -- confirma que
        # el resultado anterior es por la exclusión, no porque la jaula
        # esté vacía.
        self.assertTrue(self._jaula_tiene_otro_macho_activo(jaula))

    # ---- Configuración por organización: columnas y defaults ----

    def test_columnas_config_existen_con_default_true_3(self):
        rows = self._get_config()
        # GRANJA-VALENCIA puede o no tener fila propia todavía -- si no
        # tiene, no hay fila que leer (el default de columna solo se ve
        # al insertar una fila real).
        if rows:
            self.assertEqual(rows[0]["alerta_consanguinidad_activa"], True)
            self.assertEqual(rows[0]["generaciones_consanguinidad"], 3)
        else:
            res = httpx.post(
                f"{SUPABASE_URL}/rest/v1/PECUARIO_CONFIGURACION",
                headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
                json={"ID_Organizacion": ORG_A},
                timeout=30,
            )
            res.raise_for_status()
            self._cleanup.append(("PECUARIO_CONFIGURACION", "ID_Organizacion", ORG_A))
            fila = res.json()[0]
            self.assertEqual(fila["alerta_consanguinidad_activa"], True)
            self.assertEqual(fila["generaciones_consanguinidad"], 3)

    # ---- advertencia_confirmada: existe con default false, nunca bloquea ----

    def test_advertencia_confirmada_default_false_en_ambas_tablas(self):
        jaula = self._crear_jaula()
        macho = self._crear_reproductor("macho", jaula_actual_id=jaula)

        reproductor = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_REPRODUCTORES", headers=_service_headers(),
            params={"id": f"eq.{macho}", "select": "advertencia_confirmada"}, timeout=30,
        ).json()[0]
        self.assertEqual(reproductor["advertencia_confirmada"], False)

        historial = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_HISTORIAL_MACHOS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": ORG_A, "macho_id": macho, "jaula_id": jaula},
            timeout=30,
        )
        historial.raise_for_status()
        fila = historial.json()[0]
        self._cleanup.append(("PECUARIO_HISTORIAL_MACHOS", "id", fila["id"]))
        self.assertEqual(fila["advertencia_confirmada"], False)

    def test_insert_con_parentesco_real_y_jaula_ocupada_no_se_bloquea_aunque_advertencia_confirmada_sea_false(self):
        # Caso deliberado: consanguinidad real Y jaula ya ocupada, con
        # advertencia_confirmada=false explícito -- no debe existir
        # ningún CHECK/trigger que lo impida (advertencia, nunca acción
        # bloqueante, por diseño de esta migración).
        jaula = self._crear_jaula()
        padre = self._crear_reproductor("macho", jaula_actual_id=jaula, estado="activo")
        hijo = self._crear_reproductor("macho", padre_id=padre, jaula_actual_id=jaula, advertencia_confirmada=False)

        self.assertTrue(self._son_parientes(padre, hijo))
        self.assertTrue(self._jaula_tiene_otro_macho_activo(jaula, macho_id_excluir=hijo))

        historial = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_HISTORIAL_MACHOS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": ORG_A, "macho_id": hijo, "jaula_id": jaula, "advertencia_confirmada": False},
            timeout=30,
        )
        self.assertEqual(historial.status_code, 201, historial.text)
        self._cleanup.append(("PECUARIO_HISTORIAL_MACHOS", "id", historial.json()[0]["id"]))

    # ---- Aislamiento RLS cruzado de la configuración ----

    def test_aislamiento_cruzado_configuracion(self):
        existente = self._get_config(org=ORG_A)
        if not existente:
            res = httpx.post(
                f"{SUPABASE_URL}/rest/v1/PECUARIO_CONFIGURACION",
                headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
                json={"ID_Organizacion": ORG_A},
                timeout=30,
            )
            res.raise_for_status()
            self._cleanup.append(("PECUARIO_CONFIGURACION", "ID_Organizacion", ORG_A))

        read = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_CONFIGURACION",
            headers=_session_headers(self.otra_org_token), params={"ID_Organizacion": f"eq.{ORG_A}"}, timeout=30,
        )
        self.assertEqual(read.status_code, 200)
        self.assertEqual(read.json(), [], f"Una sesión de {ORG_B} no debe ver la configuración de {ORG_A}.")


if __name__ == "__main__":
    unittest.main(verbosity=2)
