"""
Test de integración para la venta de cuy pelado (beneficiado) — precio por
kg o por animal, más Rendimiento de carcasa — sobre PECUARIO_VENTAS.

Ver supabase/migrations/20260923090000a_pecuario_venta_pelado_enum.sql +
supabase/migrations/20260923090000b_pecuario_venta_pelado_beneficiado.sql
y specs/pecuario_venta_pelado_beneficiado.md §6.5.

Partida en 2 archivos/2 Runs de Studio (corrección de Claude Cowork sobre
su propia redacción original de un solo archivo): Postgres no permite
usar (comparar/castear) un valor de enum recién agregado con
`ALTER TYPE ... ADD VALUE` dentro de la misma transacción en que se
agregó -- la redacción original agregaba 'pelado_beneficiado' Y lo usaba
en el mismo archivo (dentro de chk_ventas_base_precio_coherente), lo que
Studio ejecuta como una sola transacción implícita. La parte A agrega
solo el valor de enum; la parte B (que exige en su propio preflight que
la parte A ya haya corrido y confirmado) agrega columnas/CHECK/trigger.

La migración NO se aplica desde este archivo ni desde ningún script de este
repo -- ninguna migración SQL se aplica automáticamente contra la base real
(system prompt / docs/RYZOS_ORQUESTADOR_V3.1.md §4.1.4). Este archivo
verifica el contenido estático de ambas partes y del contrato Zod siempre,
y sus casos en vivo solo cuando las columnas nuevas ya existen (aplicadas a
mano en Supabase Studio, en 2 Runs separados) -- `unittest.SkipTest`
explícito en caso contrario, sin fallar la suite.
"""

import os
import time
import unittest
from pathlib import Path

import httpx
import pytest

PART_A_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase" / "migrations" / "20260923090000a_pecuario_venta_pelado_enum.sql"
)
PART_B_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase" / "migrations" / "20260923090000b_pecuario_venta_pelado_beneficiado.sql"
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
            f"{SUPABASE_URL}/rest/v1/PECUARIO_VENTAS",
            headers=_service_headers(),
            params={"select": "base_precio,precio_kg,rendimiento_carcasa_pct", "limit": 1},
            timeout=15,
        )
    except Exception:
        return False
    return res.status_code == 200


class TestMigrationPartAStatic(unittest.TestCase):
    """Parte A: solo agrega el valor de enum. No requiere Supabase Live."""

    @classmethod
    def setUpClass(cls):
        if not PART_A_PATH.exists():
            raise AssertionError(f"No existe {PART_A_PATH}")
        cls.sql = PART_A_PATH.read_text(encoding="utf-8")

    def test_enum_gana_pelado_beneficiado(self):
        self.assertIn("ALTER TYPE tipo_venta_cuy ADD VALUE IF NOT EXISTS 'pelado_beneficiado'", self.sql)

    def test_no_usa_el_valor_nuevo_en_el_mismo_archivo(self):
        # La razón de ser de la parte A: agregar el valor de enum SIN
        # usarlo (compararlo/castearlo) en el mismo Run -- eso es lo que
        # causaba "unsafe use of new value of enum type" en la redacción
        # original de un solo archivo.
        self.assertNotIn("= 'pelado_beneficiado'", self.sql)


class TestMigrationPartBStatic(unittest.TestCase):
    """Parte B: columnas, CHECK y trigger. No requiere Supabase Live."""

    @classmethod
    def setUpClass(cls):
        if not PART_B_PATH.exists():
            raise AssertionError(f"No existe {PART_B_PATH}")
        cls.sql = PART_B_PATH.read_text(encoding="utf-8")

    def test_columnas_nuevas_presentes(self):
        self.assertIn("base_precio base_precio_venta NOT NULL DEFAULT 'por_animal'", self.sql)
        self.assertIn("precio_kg NUMERIC(10,2)", self.sql)
        self.assertIn("peso_vivo_pre_beneficio_kg NUMERIC(8,2)", self.sql)

    def test_rendimiento_carcasa_generado(self):
        self.assertIn("rendimiento_carcasa_pct NUMERIC(5,1)", self.sql)
        self.assertIn("GENERATED ALWAYS AS", self.sql)
        self.assertIn("peso_total_kg / peso_vivo_pre_beneficio_kg", self.sql)

    def test_check_base_precio_coherente_presente(self):
        self.assertIn("chk_ventas_base_precio_coherente", self.sql)

    def test_trigger_extendido_no_reemplazado(self):
        self.assertIn("CREATE OR REPLACE FUNCTION fn_calcular_precio_total_venta()", self.sql)
        self.assertIn("NEW.base_precio = 'por_kg'", self.sql)
        # La rama existente (v4) debe seguir intacta -- ninguna venta por
        # animal ya cargada puede cambiar de resultado.
        self.assertIn("NEW.precio_total := ROUND(NEW.cantidad * NEW.precio_unitario, 2)", self.sql)

    def test_preflight_exige_pecuario_ventas_trigger_v4_y_parte_a(self):
        self.assertIn('to_regclass(\'public."PECUARIO_VENTAS"\')', self.sql)
        self.assertIn("fn_calcular_precio_total_venta", self.sql)
        # Debe exigir explícitamente que la parte A ya corrió (el valor de
        # enum ya existe) antes de intentar usarlo en el CHECK.
        self.assertIn("e.enumlabel = 'pelado_beneficiado'", self.sql)

    def test_no_toca_fn_dar_baja_animal_por_venta(self):
        # El nombre aparece en un comentario explicando que NO se toca --
        # lo que no debe aparecer es una (re)definición de la función.
        self.assertNotIn("CREATE OR REPLACE FUNCTION fn_dar_baja_animal_por_venta", self.sql)
        self.assertNotIn("CREATE FUNCTION fn_dar_baja_animal_por_venta", self.sql)


class TestVentaRegistroSchemaContract(unittest.TestCase):
    """Verifica que lib/validations/pecuario.ts (ruta real) tenga el
    contrato extendido con el mismo criterio que
    chk_ventas_base_precio_coherente -- incluida la rama que la redacción
    original de Cowork no cubría (por_animal exige precio_kg NULL)."""

    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parent.parent / "lib" / "validations" / "pecuario.ts"
        if not path.exists():
            raise AssertionError(f"No existe {path}")
        cls.ts = path.read_text(encoding="utf-8")
        start = cls.ts.index("export const VentaRegistroSchema")
        end = cls.ts.index("export const ControlSanitarioSchema")
        cls.schema_body = cls.ts[start:end]

    def test_tipo_salida_gana_pelado_beneficiado(self):
        self.assertIn("'pelado_beneficiado'", self.schema_body)

    def test_campos_nuevos_presentes(self):
        self.assertIn("base_precio:", self.schema_body)
        self.assertIn("precio_kg:", self.schema_body)
        self.assertIn("peso_vivo_pre_beneficio_kg:", self.schema_body)

    def test_refine_por_kg_solo_con_pelado_beneficiado(self):
        self.assertIn("data.tipo_salida === 'pelado_beneficiado'", self.schema_body)

    def test_refine_por_kg_exige_peso_y_precio(self):
        self.assertIn("data.peso_total_kg != null && data.precio_kg != null", self.schema_body)

    def test_refine_por_animal_exige_precio_kg_null(self):
        # Gap encontrado en la redacción original (2026-09-23): faltaba
        # esta rama del CHECK (precio_kg IS NULL cuando base_precio=
        # 'por_animal') -- agregado en esta misma tarea.
        self.assertIn("data.base_precio !== 'por_animal' || data.precio_kg == null", self.schema_body)


@NEEDS_SUPABASE
class TestVentaPeladoLive(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not _migracion_aplicada():
            raise unittest.SkipTest(
                "PECUARIO_VENTAS no tiene todavía las columnas de esta migración -- "
                "20260923090000_pecuario_venta_pelado_beneficiado.sql no aplicada "
                "(aplicación manual pendiente, ver §4.1.4)."
            )
        cls.admin_token = _magic_link_access_token(ADMIN_EMAIL)

    def setUp(self):
        self.suffix = str(int(time.time() * 1000))
        self._cleanup = []  # list of (table, field, value), LIFO en tearDown

    def tearDown(self):
        for table, field, value in reversed(self._cleanup):
            httpx.delete(f"{SUPABASE_URL}/rest/v1/{table}", headers=_service_headers(), params={field: f"eq.{value}"}, timeout=30)

    def _crear_lote(self, org=ORG_A):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_LOTES",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": org, "codigo_lote": f"TEST-VENTAPELADO-{self.suffix}"},
            timeout=30,
        )
        res.raise_for_status()
        lote_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_LOTES", "id", lote_id))
        return lote_id

    def test_venta_pelado_por_kg_calcula_total_y_rendimiento(self):
        lote_id = self._crear_lote()
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_VENTAS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={
                "ID_Organizacion": ORG_A, "lote_id": lote_id, "tipo_salida": "pelado_beneficiado",
                "cantidad": 1, "base_precio": "por_kg", "peso_total_kg": 9, "precio_kg": 22,
                "peso_vivo_pre_beneficio_kg": 15,
            },
            timeout=30,
        )
        self.assertEqual(res.status_code, 201, res.text)
        venta = res.json()[0]
        self._cleanup.append(("PECUARIO_VENTAS", "id", venta["id"]))
        self.assertEqual(float(venta["precio_total"]), 198.00)
        self.assertEqual(float(venta["rendimiento_carcasa_pct"]), 60.0)

    def test_venta_carne_por_animal_sin_regresion(self):
        """Regresión explícita de la spec §6.5: una venta por animal como
        las de siempre (v4) no debe cambiar de resultado."""
        lote_id = self._crear_lote()
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_VENTAS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={
                "ID_Organizacion": ORG_A, "lote_id": lote_id, "tipo_salida": "carne",
                "cantidad": 12, "precio_unitario": 18,
            },
            timeout=30,
        )
        self.assertEqual(res.status_code, 201, res.text)
        venta = res.json()[0]
        self._cleanup.append(("PECUARIO_VENTAS", "id", venta["id"]))
        self.assertEqual(float(venta["precio_total"]), 216.00)
        self.assertEqual(venta["base_precio"], "por_animal")
        self.assertIsNone(venta["rendimiento_carcasa_pct"])

    def test_por_kg_con_tipo_salida_distinto_falla_check(self):
        lote_id = self._crear_lote()
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_VENTAS",
            headers={**_service_headers(), "Content-Type": "application/json"},
            json={
                "ID_Organizacion": ORG_A, "lote_id": lote_id, "tipo_salida": "carne",
                "cantidad": 5, "base_precio": "por_kg", "precio_kg": 20, "peso_total_kg": 10,
            },
            timeout=30,
        )
        self.assertEqual(res.status_code, 400, res.text)

    def test_por_kg_sin_precio_kg_falla_check(self):
        lote_id = self._crear_lote()
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_VENTAS",
            headers={**_service_headers(), "Content-Type": "application/json"},
            json={
                "ID_Organizacion": ORG_A, "lote_id": lote_id, "tipo_salida": "pelado_beneficiado",
                "cantidad": 1, "base_precio": "por_kg", "peso_total_kg": 9,
            },
            timeout=30,
        )
        self.assertEqual(res.status_code, 400, res.text)

    def test_por_kg_sin_peso_total_falla_check(self):
        lote_id = self._crear_lote()
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_VENTAS",
            headers={**_service_headers(), "Content-Type": "application/json"},
            json={
                "ID_Organizacion": ORG_A, "lote_id": lote_id, "tipo_salida": "pelado_beneficiado",
                "cantidad": 1, "base_precio": "por_kg", "precio_kg": 22,
            },
            timeout=30,
        )
        self.assertEqual(res.status_code, 400, res.text)

    def test_cross_org_read_isolation_con_columnas_nuevas(self):
        """Revalidación pedida explícitamente por la spec §6.5: la RLS de
        v1 sigue aplicando con las columnas nuevas de esta migración."""
        lote_b = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_LOTES",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": ORG_B, "codigo_lote": f"TEST-VENTAPELADO-CROSSORG-{self.suffix}"},
            timeout=30,
        )
        lote_b.raise_for_status()
        lote_b_id = lote_b.json()[0]["id"]
        self._cleanup.append(("PECUARIO_LOTES", "id", lote_b_id))

        seed = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_VENTAS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={
                "ID_Organizacion": ORG_B, "lote_id": lote_b_id, "tipo_salida": "pelado_beneficiado",
                "cantidad": 1, "base_precio": "por_kg", "peso_total_kg": 9, "precio_kg": 22,
            },
            timeout=30,
        )
        seed.raise_for_status()
        seeded_id = seed.json()[0]["id"]
        self._cleanup.append(("PECUARIO_VENTAS", "id", seeded_id))

        read = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_VENTAS",
            headers=_session_headers(self.admin_token),
            params={"id": f"eq.{seeded_id}"},
            timeout=30,
        )
        self.assertEqual(read.status_code, 200)
        self.assertEqual(
            read.json(), [],
            "Una sesión autenticada de ORG_A no debe ver, con las columnas nuevas de esta "
            "migración, ninguna venta sembrada en ORG_B.",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
