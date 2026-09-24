"""
Test de integración para PECUARIO_VENTAS_SUBPRODUCTOS (venta de guano,
separada de PECUARIO_VENTAS) y el retiro de 'guano' como tipo_salida de
venta de animales.

Ver supabase/migrations/20260923110000_pecuario_venta_subproductos_guano.sql
(specs/pecuario_venta_subproductos_guano.md no existe en este repo —
solo referenciado por otros archivos, nunca comiteado; la migración trae
suficiente contexto en su propia cabecera para verificar sin ella).

La migración NO se aplica desde este archivo ni desde ningún script de este
repo -- ninguna migración SQL se aplica automáticamente contra la base real
(system prompt / docs/RYZOS_ORQUESTADOR_V3.1.md §4.1.4). Este archivo
verifica el contenido estático de la migración y del contrato Zod siempre,
y sus casos en vivo solo cuando la tabla ya existe (aplicada a mano en
Supabase Studio) -- `unittest.SkipTest` explícito en caso contrario, sin
fallar la suite.
"""

import os
import time
import unittest
from pathlib import Path

import httpx
import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase" / "migrations" / "20260923110000_pecuario_venta_subproductos_guano.sql"
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
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_VENTAS_SUBPRODUCTOS",
            headers=_service_headers(),
            params={"select": "id,producto,unidad", "limit": 1},
            timeout=15,
        )
    except Exception:
        return False
    return res.status_code == 200


class TestMigrationFileStatic(unittest.TestCase):
    """No requiere Supabase Live -- verifica el contenido de la migración
    en disco, siempre corre."""

    @classmethod
    def setUpClass(cls):
        if not MIGRATION_PATH.exists():
            raise AssertionError(f"No existe {MIGRATION_PATH}")
        cls.sql = MIGRATION_PATH.read_text(encoding="utf-8")

    def test_tabla_nueva_no_columna_sobre_ventas(self):
        self.assertIn('CREATE TABLE IF NOT EXISTS public."PECUARIO_VENTAS_SUBPRODUCTOS"', self.sql)
        self.assertNotIn('ALTER TABLE public."PECUARIO_VENTAS"', self.sql)

    def test_enums_nuevos_no_reutilizan_tipo_venta_cuy(self):
        self.assertIn("CREATE TYPE tipo_subproducto_pecuario AS ENUM ('guano')", self.sql)
        self.assertIn("CREATE TYPE unidad_venta_subproducto AS ENUM ('sacos', 'kg')", self.sql)
        # tipo_venta_cuy aparece en comentarios explicando por qué NO se
        # reutiliza -- lo que no debe existir es una columna declarada con
        # ese tipo dentro de esta tabla.
        self.assertIn("producto tipo_subproducto_pecuario", self.sql)
        self.assertNotIn("producto tipo_venta_cuy", self.sql)

    def test_checks_presentes(self):
        self.assertIn("chk_ventas_subproductos_cantidad_positiva", self.sql)
        self.assertIn("chk_ventas_subproductos_precio_no_negativo", self.sql)

    def test_fk_organizacion_y_galpon(self):
        self.assertIn("fk_pecuario_ventas_subproductos_org", self.sql)
        self.assertIn("fk_pecuario_ventas_subproductos_galpon", self.sql)

    def test_rls_habilitado(self):
        self.assertIn('ALTER TABLE public."PECUARIO_VENTAS_SUBPRODUCTOS" ENABLE ROW LEVEL SECURITY', self.sql)
        self.assertIn("auth_org_id()", self.sql)

    def test_no_toca_fn_dar_baja_animal_por_venta_ni_trigger_precio(self):
        # Ambos nombres aparecen en comentarios explicando que NO se
        # tocan -- lo que no debe aparecer es una (re)definición ni un
        # CREATE TRIGGER real.
        self.assertNotIn("CREATE OR REPLACE FUNCTION fn_dar_baja_animal_por_venta", self.sql)
        self.assertNotIn("CREATE FUNCTION fn_dar_baja_animal_por_venta", self.sql)
        self.assertNotIn("CREATE OR REPLACE FUNCTION fn_calcular_precio_total_venta", self.sql)
        self.assertNotIn("CREATE TRIGGER", self.sql)

    def test_preflight_exige_organizaciones_y_galpones(self):
        self.assertIn('to_regclass(\'public."ORGANIZACIONES"\')', self.sql)
        self.assertIn('to_regclass(\'public."PECUARIO_GALPONES"\')', self.sql)


class TestZodContract(unittest.TestCase):
    """Verifica lib/validations/pecuario.ts (ruta real)."""

    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parent.parent / "lib" / "validations" / "pecuario.ts"
        if not path.exists():
            raise AssertionError(f"No existe {path}")
        cls.ts = path.read_text(encoding="utf-8")

    def test_venta_subproducto_schema_exported(self):
        self.assertIn("export const VentaSubproductoSchema", self.ts)
        self.assertIn("export type VentaSubproductoInput", self.ts)

    def test_venta_subproducto_no_tiene_campos_de_venta_animal(self):
        # Acota al cuerpo de ESTE schema (hasta la siguiente definición de
        # schema, no hasta un type export lejano en el bloque de cola) --
        # ese bloque de cola crece con cada schema nuevo y cualquiera que
        # declare lote_id/animal_id (ej. TrasladoRegistroSchema, 2026-09-24)
        # queda entre ambos puntos sin ser el que se quiere probar acá.
        start = self.ts.index("export const VentaSubproductoSchema")
        end = self.ts.index("export const MortalidadFotoSchema")
        body = self.ts[start:end]
        for campo in ("animal_id", "lote_id", "precio_unitario", "base_precio", "precio_kg"):
            with self.subTest(campo=campo):
                self.assertNotIn(f"{campo}:", body)

    def test_venta_registro_schema_ya_no_acepta_guano(self):
        # Retirado 2026-09-23 -- el guano pasa por VentaSubproductoSchema.
        start = self.ts.index("export const VentaRegistroSchema")
        end = self.ts.index("export const ControlSanitarioSchema")
        body = self.ts[start:end]
        self.assertIn("tipo_salida: z.enum(['carne', 'pie_cria', 'reproductor_saca', 'pelado_beneficiado'])", body)


@NEEDS_SUPABASE
class TestVentaSubproductosLive(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not _migracion_aplicada():
            raise unittest.SkipTest(
                "PECUARIO_VENTAS_SUBPRODUCTOS no existe todavía -- migración "
                "20260923110000_pecuario_venta_subproductos_guano.sql no aplicada "
                "(aplicación manual pendiente, ver §4.1.4)."
            )
        cls.admin_token = _magic_link_access_token(ADMIN_EMAIL)

    def setUp(self):
        self.suffix = str(int(time.time() * 1000))
        self._cleanup = []  # list of (table, field, value), LIFO en tearDown

    def tearDown(self):
        for table, field, value in reversed(self._cleanup):
            httpx.delete(f"{SUPABASE_URL}/rest/v1/{table}", headers=_service_headers(), params={field: f"eq.{value}"}, timeout=30)

    def _crear_galpon(self, org=ORG_A):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_GALPONES",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": org, "codigo_galpon": f"TEST-GUANO-{self.suffix}"},
            timeout=30,
        )
        res.raise_for_status()
        galpon_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_GALPONES", "id", galpon_id))
        return galpon_id

    def test_venta_guano_valida_se_inserta_con_defaults(self):
        galpon_id = self._crear_galpon()
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_VENTAS_SUBPRODUCTOS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={
                "ID_Organizacion": ORG_A, "cantidad": 40, "unidad": "sacos",
                "precio_total": 80, "galpon_id": galpon_id, "comprador_nombre": "Vivero Don Pepe",
            },
            timeout=30,
        )
        self.assertEqual(res.status_code, 201, res.text)
        row = res.json()[0]
        self._cleanup.append(("PECUARIO_VENTAS_SUBPRODUCTOS", "id", row["id"]))
        self.assertEqual(row["producto"], "guano")
        self.assertNotIn("lote_id", row, "PECUARIO_VENTAS_SUBPRODUCTOS no debe tener animal_id/lote_id -- no es una venta de animal.")

    def test_cantidad_cero_falla_check(self):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_VENTAS_SUBPRODUCTOS",
            headers={**_service_headers(), "Content-Type": "application/json"},
            json={"ID_Organizacion": ORG_A, "cantidad": 0, "unidad": "kg"},
            timeout=30,
        )
        self.assertEqual(res.status_code, 400, res.text)

    def test_precio_negativo_falla_check(self):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_VENTAS_SUBPRODUCTOS",
            headers={**_service_headers(), "Content-Type": "application/json"},
            json={"ID_Organizacion": ORG_A, "cantidad": 10, "unidad": "kg", "precio_total": -5},
            timeout=30,
        )
        self.assertEqual(res.status_code, 400, res.text)

    def test_authenticated_session_can_write_own_org(self):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_VENTAS_SUBPRODUCTOS",
            headers={**_session_headers(self.admin_token), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": ORG_A, "cantidad": 5, "unidad": "kg"},
            timeout=30,
        )
        self.assertEqual(res.status_code, 201, res.text)
        self._cleanup.append(("PECUARIO_VENTAS_SUBPRODUCTOS", "id", res.json()[0]["id"]))

    def test_cross_org_read_isolation(self):
        seed = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_VENTAS_SUBPRODUCTOS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": ORG_B, "cantidad": 7, "unidad": "sacos"},
            timeout=30,
        )
        seed.raise_for_status()
        seeded_id = seed.json()[0]["id"]
        self._cleanup.append(("PECUARIO_VENTAS_SUBPRODUCTOS", "id", seeded_id))

        read = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_VENTAS_SUBPRODUCTOS",
            headers=_session_headers(self.admin_token),
            params={"id": f"eq.{seeded_id}"},
            timeout=30,
        )
        self.assertEqual(read.status_code, 200)
        self.assertEqual(read.json(), [], "Una sesión autenticada de ORG_A no debe ver ventas de subproductos de ORG_B.")

    def test_cross_org_insert_rejected(self):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_VENTAS_SUBPRODUCTOS",
            headers={**_session_headers(self.admin_token), "Content-Type": "application/json"},
            json={"ID_Organizacion": ORG_B, "cantidad": 3, "unidad": "kg"},
            timeout=30,
        )
        self.assertIn(
            res.status_code, (401, 403),
            "Una sesión autenticada de ORG_A no debe poder insertar una venta de subproducto con "
            f"ID_Organizacion de ORG_B. status={res.status_code} body={res.text}",
        )

    def test_no_hay_filas_historicas_con_tipo_salida_guano_en_pecuario_ventas(self):
        """Informativo, pedido explícitamente antes de aplicar -- confirma
        que retirar 'guano' del contrato Zod de VentaRegistroSchema no
        deja datos reales huérfanos."""
        res = httpx.head(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_VENTAS",
            headers={**_service_headers(), "Prefer": "count=exact"},
            params={"tipo_salida": "eq.guano"},
            timeout=30,
        )
        self.assertEqual(res.status_code, 200)
        content_range = res.headers.get("content-range", "*/0")
        total = int(content_range.split("/")[-1])
        self.assertEqual(total, 0, f"Hay {total} fila(s) históricas con tipo_salida='guano' -- revisar antes de asumir que es puramente vestigial.")


if __name__ == "__main__":
    unittest.main(verbosity=2)
