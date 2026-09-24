"""
Test de integración para PECUARIO_COMPRAS (compras de insumos con costo/flete
+ gastos generales de la granja) y su trigger de entrada automática al
kardex de Insumos.

Ver supabase/migrations/20260922110000_pecuario_compras_gastos.sql y
specs/pecuario_compras_gastos.md §4.

La migración NO se aplica desde este archivo ni desde ningún script de este
repo -- ninguna migración SQL se aplica automáticamente contra la base real
(system prompt / docs/RYZOS_ORQUESTADOR_V3.1.md §4.1.4). Este archivo
verifica el contenido estático de la migración siempre, y sus casos en vivo
solo cuando PECUARIO_COMPRAS ya existe (aplicada a mano en Supabase Studio)
-- `unittest.SkipTest` explícito en caso contrario, sin fallar la suite.
"""

import os
import time
import unittest
from pathlib import Path

import httpx
import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase" / "migrations" / "20260922110000_pecuario_compras_gastos.sql"
)
FLETE_FIX_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase" / "migrations" / "20260922120000_fix_pecuario_compras_flete_default.sql"
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
            f"{SUPABASE_URL}/rest/v1/PECUARIO_COMPRAS",
            headers=_service_headers(),
            params={"select": "id,monto_total", "limit": 1},
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

    def test_tabla_y_columnas_generadas(self):
        self.assertIn('CREATE TABLE IF NOT EXISTS public."PECUARIO_COMPRAS"', self.sql)
        self.assertIn("GENERATED ALWAYS AS", self.sql)
        self.assertIn("COALESCE(costo_insumo, 0) + COALESCE(flete, 0)", self.sql)

    def test_check_rama_por_concepto_presente(self):
        self.assertIn("chk_compras_rama_por_concepto", self.sql)

    def test_trigger_entrada_automatica_presente(self):
        self.assertIn("fn_compra_genera_entrada_insumo", self.sql)
        self.assertIn("'entrada'", self.sql)
        self.assertIn("AFTER INSERT ON public.\"PECUARIO_COMPRAS\"", self.sql)

    def test_rls_habilitado(self):
        self.assertIn('ALTER TABLE public."PECUARIO_COMPRAS" ENABLE ROW LEVEL SECURITY', self.sql)
        self.assertIn("auth_org_id()", self.sql)

    def test_preflight_exige_dependencias_v2(self):
        self.assertIn('to_regclass(\'public."PECUARIO_INSUMOS"\')', self.sql)
        self.assertIn('to_regclass(\'public."PECUARIO_GALPONES"\')', self.sql)


class TestFleteDefaultFixStatic(unittest.TestCase):
    """Fix descubierto en vivo (2026-09-23): flete NUMERIC(10,2) DEFAULT 0
    conflictaba con chk_compras_rama_por_concepto para concepto=
    'servicio_otro' (que exige flete IS NULL) -- cualquier INSERT que
    omitiera la clave "flete" recibía 0 por el DEFAULT de la columna, no
    NULL, y violaba el CHECK. Ver
    20260922120000_fix_pecuario_compras_flete_default.sql."""

    @classmethod
    def setUpClass(cls):
        if not FLETE_FIX_PATH.exists():
            raise AssertionError(f"No existe {FLETE_FIX_PATH}")
        cls.sql = FLETE_FIX_PATH.read_text(encoding="utf-8")

    def test_drops_default_on_flete(self):
        self.assertIn('ALTER TABLE public."PECUARIO_COMPRAS" ALTER COLUMN flete DROP DEFAULT', self.sql)


class TestCompraSchemaContract(unittest.TestCase):
    """Verifica que lib/validations/pecuario.ts (ruta real, no
    lib/validators/) tenga el contrato CompraSchema con el mismo criterio
    XOR que el CHECK de la base."""

    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parent.parent / "lib" / "validations" / "pecuario.ts"
        if not path.exists():
            raise AssertionError(f"No existe {path}")
        cls.ts = path.read_text(encoding="utf-8")

    def test_wrong_path_does_not_exist(self):
        wrong_path = Path(__file__).resolve().parent.parent / "lib" / "validators" / "pecuario.ts"
        self.assertFalse(
            wrong_path.exists(),
            "lib/validators/pecuario.ts no debería existir -- la ruta real del "
            "contrato Zod de Pecuario es lib/validations/pecuario.ts.",
        )

    def test_compra_schema_exported(self):
        self.assertIn("export const CompraSchema", self.ts)
        self.assertIn("export type CompraInput", self.ts)

    def test_monto_total_no_se_envia_desde_cliente(self):
        # monto_total es GENERATED en la base -- nunca debe ser un campo
        # escribible del schema (evita mandarlo "desincronizado" del cálculo real).
        # Acota al cuerpo de ESTE schema (hasta la siguiente definición de
        # schema, no hasta su propio type export en el bloque de cola) --
        # ese bloque crece con cada schema nuevo, y cualquier otro definido
        # entre CompraSchema y su type export (varios ya, a partir de
        # 2026-09-23) quedaría dentro del slice sin ser lo que se prueba
        # acá (mismo hallazgo que rompió test_pecuario_venta_subproductos_guano.py
        # con TrasladoRegistroSchema).
        schema_start = self.ts.index("export const CompraSchema")
        schema_end = self.ts.index("export const VentaSubproductoSchema")
        schema_body = self.ts[schema_start:schema_end]
        self.assertNotIn("monto_total:", schema_body)


@NEEDS_SUPABASE
class TestPecuarioComprasLive(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not _migracion_aplicada():
            raise unittest.SkipTest(
                "PECUARIO_COMPRAS no existe todavía -- migración "
                "20260922110000_pecuario_compras_gastos.sql no aplicada "
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
            json={"ID_Organizacion": org, "codigo_galpon": f"TEST-COMPRAS-{self.suffix}"},
            timeout=30,
        )
        res.raise_for_status()
        galpon_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_GALPONES", "id", galpon_id))
        return galpon_id

    def _crear_insumo(self, org=ORG_A):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_INSUMOS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": org, "nombre": f"TEST-COMPRAS-INSUMO-{self.suffix}", "categoria": "alimento", "unidad_medida": "kg"},
            timeout=30,
        )
        res.raise_for_status()
        insumo_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_INSUMOS", "id", insumo_id))
        return insumo_id

    def _movimientos_de_insumo(self, insumo_id):
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_INSUMOS_MOVIMIENTOS",
            headers=_service_headers(),
            params={"insumo_id": f"eq.{insumo_id}"},
            timeout=30,
        )
        res.raise_for_status()
        return res.json()

    def test_compra_insumo_calcula_monto_total_y_genera_movimiento(self):
        galpon_id = self._crear_galpon()
        insumo_id = self._crear_insumo()

        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_COMPRAS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={
                "ID_Organizacion": ORG_A, "concepto": "insumo",
                "insumo_id": insumo_id, "cantidad": 75, "galpon_id": galpon_id,
                "costo_insumo": 150, "flete": 10,
            },
            timeout=30,
        )
        self.assertEqual(res.status_code, 201, res.text)
        compra = res.json()[0]
        self._cleanup.append(("PECUARIO_COMPRAS", "id", compra["id"]))
        self.assertEqual(float(compra["monto_total"]), 160.00, "monto_total debe ser costo_insumo + flete")

        movimientos = self._movimientos_de_insumo(insumo_id)
        entradas = [m for m in movimientos if m["tipo_movimiento"] == "entrada" and float(m["cantidad"]) == 75.0]
        self.assertEqual(len(entradas), 1, "La compra de un insumo debe generar exactamente un movimiento de entrada")
        self._cleanup.append(("PECUARIO_INSUMOS_MOVIMIENTOS", "id", entradas[0]["id"]))

    def test_compra_servicio_otro_no_genera_movimiento(self):
        antes = len(self._movimientos_de_insumo("00000000-0000-0000-0000-000000000000"))  # sanity: helper funciona con 0 filas

        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_COMPRAS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={
                "ID_Organizacion": ORG_A, "concepto": "servicio_otro",
                "categoria_gasto": "combustible", "descripcion": f"TEST-COMPRAS-SERVICIO-{self.suffix}",
                "monto_servicio": 85.50,
            },
            timeout=30,
        )
        self.assertEqual(res.status_code, 201, res.text)
        compra = res.json()[0]
        self._cleanup.append(("PECUARIO_COMPRAS", "id", compra["id"]))
        self.assertEqual(float(compra["monto_total"]), 85.50, "monto_total debe ser monto_servicio para servicio_otro")
        self.assertIsNone(compra["insumo_id"])
        self.assertEqual(antes, 0)

        # No debe existir ningún movimiento generado a partir de esta compra
        # (no hay insumo_id: el trigger solo actúa cuando concepto='insumo').
        mov = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_INSUMOS_MOVIMIENTOS",
            headers=_service_headers(),
            params={"observaciones": f"like.*{compra['id']}*"},
            timeout=30,
        )
        mov.raise_for_status()
        self.assertEqual(mov.json(), [])

    def test_insert_mezclando_ramas_falla_por_check(self):
        galpon_id = self._crear_galpon()
        insumo_id = self._crear_insumo()

        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_COMPRAS",
            headers={**_service_headers(), "Content-Type": "application/json"},
            json={
                "ID_Organizacion": ORG_A, "concepto": "insumo",
                "insumo_id": insumo_id, "cantidad": 10, "galpon_id": galpon_id, "costo_insumo": 50,
                # Campos de la rama servicio_otro mezclados a propósito:
                "categoria_gasto": "combustible", "descripcion": "no debería aceptarse",
            },
            timeout=30,
        )
        self.assertEqual(res.status_code, 400, res.text)

    def test_authenticated_session_can_write_own_org(self):
        galpon_id = self._crear_galpon()
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_COMPRAS",
            headers={**_session_headers(self.admin_token), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={
                "ID_Organizacion": ORG_A, "concepto": "servicio_otro",
                "categoria_gasto": "mantenimiento_reparaciones", "descripcion": f"TEST-SESSION-{self.suffix}",
                "monto_servicio": 42.00,
            },
            timeout=30,
        )
        self.assertEqual(res.status_code, 201, res.text)
        self._cleanup.append(("PECUARIO_COMPRAS", "id", res.json()[0]["id"]))

    def test_cross_org_read_isolation(self):
        seed = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_COMPRAS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={
                "ID_Organizacion": ORG_B, "concepto": "servicio_otro",
                "categoria_gasto": "otro", "descripcion": f"TEST-CROSSORG-{self.suffix}", "monto_servicio": 1.00,
            },
            timeout=30,
        )
        seed.raise_for_status()
        seeded_id = seed.json()[0]["id"]
        self._cleanup.append(("PECUARIO_COMPRAS", "id", seeded_id))

        read = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_COMPRAS",
            headers=_session_headers(self.admin_token),
            params={"id": f"eq.{seeded_id}"},
            timeout=30,
        )
        self.assertEqual(read.status_code, 200)
        self.assertEqual(read.json(), [], "Una sesión autenticada de ORG_A no debe ver compras de ORG_B.")

    def test_cross_org_insert_rejected(self):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_COMPRAS",
            headers={**_session_headers(self.admin_token), "Content-Type": "application/json"},
            json={
                "ID_Organizacion": ORG_B, "concepto": "servicio_otro",
                "categoria_gasto": "otro", "descripcion": f"TEST-CROSSORG-INSERT-{self.suffix}", "monto_servicio": 1.00,
            },
            timeout=30,
        )
        self.assertIn(
            res.status_code, (401, 403),
            "Una sesión autenticada de ORG_A no debe poder insertar una compra con ID_Organizacion de ORG_B "
            f"(WITH CHECK de la policy RLS debe rechazarlo). status={res.status_code} body={res.text}",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
