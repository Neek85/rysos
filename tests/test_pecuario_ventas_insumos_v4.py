"""
Test de integración para v4 del módulo Pecuario Cuyes (ajustes de venta por
animal + taxonomía de insumos).

Ver supabase/migrations/20260911180000_pecuario_ventas_insumos_ajustes.sql,
specs/pecuario_identificacion_individual.md sección "Actualización
2026-09-11 (tarde) — ajustes de campo v4".

CONTEXTO IMPORTANTE (verificado en esta tarea): no existe ningún Server
Action ni componente de formulario web que consuma PECUARIO_VENTAS/
PECUARIO_INSUMOS en este repo (grep exhaustivo sobre lib/actions/,
app/dashboard/, components/ -- cero resultados fuera de migraciones/specs/
docs/tests). El módulo Pecuario es una app móvil (Expo/React Native) que
todavía no se scaffoldeó en este repo -- no hay código cliente que
"adaptar" al esquema v4 todavía, solo el contrato Zod
(lib/validations/pecuario.ts, ya actualizado) y la base real. Este archivo
verifica el contrato + la base, que es lo que sí existe.

Se omiten automáticamente (pytest.skip) cuando las credenciales no están
disponibles, y con un skip explícito si v4 no está aplicada.
"""

import os
import time
import unittest
from pathlib import Path

import httpx
import pytest

V4_MIGRATION_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase" / "migrations" / "20260911180000_pecuario_ventas_insumos_ajustes.sql"
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

NEEDS_SUPABASE = pytest.mark.skipif(
    not SUPABASE_URL or not SUPABASE_ANON_KEY or not SUPABASE_SERVICE_ROLE_KEY,
    reason="SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY no configuradas — test requiere Supabase Live",
)

ORG_A = "ORG-TEST-DEMO"


def _service_headers():
    return {"apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"}


def _v4_applied():
    try:
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_VENTAS",
            headers=_service_headers(),
            params={"select": "precio_unitario", "limit": 1},
            timeout=15,
        )
    except Exception:
        return False
    return res.status_code == 200


class TestV4MigrationFileStatic(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not V4_MIGRATION_PATH.exists():
            raise AssertionError(f"No existe {V4_MIGRATION_PATH}")
        cls.sql = V4_MIGRATION_PATH.read_text(encoding="utf-8")

    def test_precio_unitario_column_and_trigger_present(self):
        self.assertIn("precio_unitario NUMERIC(10,2)", self.sql)
        self.assertIn("fn_calcular_precio_total_venta", self.sql)
        self.assertIn("NEW.precio_total := ROUND(NEW.cantidad * NEW.precio_unitario, 2)", self.sql)

    def test_categoria_insumo_extended(self):
        self.assertIn("ADD VALUE IF NOT EXISTS 'medicamento'", self.sql)
        self.assertIn("ADD VALUE IF NOT EXISTS 'vitamina'", self.sql)
        self.assertIn("RENAME VALUE 'cama' TO 'material'", self.sql)

    def test_unidad_medida_insumo_enum_created(self):
        self.assertIn("CREATE TYPE unidad_medida_insumo AS ENUM", self.sql)
        for unidad in ("kg", "g", "litro", "ml", "unidad", "saco_50kg", "saco_40kg"):
            with self.subTest(unidad=unidad):
                self.assertIn(f"'{unidad}'", self.sql)

    def test_idempotent_no_no_such_table_assumptions(self):
        # No debe asumir tablas creadas por fuera de v1/v2 -- solo exige que existan.
        self.assertIn("RAISE EXCEPTION", self.sql)


class TestPecuarioValidationsHasNoV4Gaps(unittest.TestCase):
    """Confirma que no hay código cliente (Server Actions, componentes web)
    que siga usando los valores viejos ('cama', unidad_medida como texto
    libre) -- porque no existe ningún código cliente para este módulo
    todavía en este repo. Ver el docstring del módulo."""

    def test_no_lib_actions_file_for_pecuario_yet(self):
        actions_dir = Path(__file__).resolve().parent.parent / "lib" / "actions"
        pecuario_actions = list(actions_dir.glob("*pecuario*"))
        self.assertEqual(
            pecuario_actions, [],
            "Si esto falla, alguien ya creó un Server Action de Pecuario -- "
            "revisar que use los enums nuevos de InsumoSchema/VentaRegistroSchema "
            "(categoria/unidad_medida/precio_unitario) en vez de valores sueltos.",
        )

    def test_no_dashboard_screens_for_pecuario_yet(self):
        dashboard_dir = Path(__file__).resolve().parent.parent / "app" / "dashboard"
        matches = [p for p in dashboard_dir.rglob("*") if "pecuario" in p.name.lower() or "granja" in p.name.lower() or "cuy" in p.name.lower()]
        self.assertEqual(
            matches, [],
            "Si esto falla, alguien ya creó una pantalla web de Pecuario -- "
            "revisar que sus pickers usen InsumoSchema.categoria/unidad_medida "
            "(enums) como fuente de verdad, no strings sueltos como 'cama'.",
        )


@NEEDS_SUPABASE
class TestV4Live(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not _v4_applied():
            raise unittest.SkipTest("v4 (20260911180000_pecuario_ventas_insumos_ajustes.sql) no está aplicada todavía.")

    def setUp(self):
        self.suffix = str(int(time.time() * 1000))
        self._cleanup = []  # list of (table, field, value)
        self._reproductores = []

    def tearDown(self):
        for table, field, value in reversed(self._cleanup):
            httpx.delete(f"{SUPABASE_URL}/rest/v1/{table}", headers=_service_headers(), params={field: f"eq.{value}"}, timeout=30)
        for rid in self._reproductores:
            httpx.delete(f"{SUPABASE_URL}/rest/v1/PECUARIO_REPRODUCTORES", headers=_service_headers(), params={"id": f"eq.{rid}"}, timeout=30)

    def _crear_reproductor(self):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_REPRODUCTORES",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": ORG_A, "codigo_arete": f"TEST-V4-{self.suffix}", "sexo": "macho"},
            timeout=30,
        )
        res.raise_for_status()
        rid = res.json()[0]["id"]
        self._reproductores.append(rid)
        return rid

    def test_trigger_recalcula_precio_total_desde_precio_unitario(self):
        """El pedido explícito: el trigger recalcula precio_total cuando se
        envía precio_unitario -- incluso si el cliente manda un
        precio_total deliberadamente incorrecto, la base gana."""
        animal = self._crear_reproductor()
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_VENTAS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={
                "ID_Organizacion": ORG_A, "animal_id": animal, "fecha_venta": "2026-03-15",
                "cantidad": 3, "precio_unitario": 10.50, "precio_total": 999.99,
            },
            timeout=30,
        )
        self.assertEqual(res.status_code, 201, res.text)
        row = res.json()[0]
        self._cleanup.append(("PECUARIO_VENTAS", "id", row["id"]))
        self.assertEqual(float(row["precio_total"]), 31.50, "trg_calcular_precio_total_venta debe recalcular 3 * 10.50, ignorando el precio_total enviado")

    def test_sin_precio_unitario_precio_total_se_respeta(self):
        """Contraste: si no se informa precio_unitario, precio_total queda
        tal cual se envía (ej. venta de lote con precio pactado directo)."""
        animal = self._crear_reproductor()
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_VENTAS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": ORG_A, "animal_id": animal, "fecha_venta": "2026-03-15", "cantidad": 1, "precio_total": 18.00},
            timeout=30,
        )
        self.assertEqual(res.status_code, 201, res.text)
        row = res.json()[0]
        self._cleanup.append(("PECUARIO_VENTAS", "id", row["id"]))
        self.assertIsNone(row["precio_unitario"])
        self.assertEqual(float(row["precio_total"]), 18.00)

    def test_categoria_insumo_acepta_medicamento_y_vitamina(self):
        for categoria in ("medicamento", "vitamina", "material"):
            with self.subTest(categoria=categoria):
                res = httpx.post(
                    f"{SUPABASE_URL}/rest/v1/PECUARIO_INSUMOS",
                    headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
                    json={"ID_Organizacion": ORG_A, "nombre": f"TEST-V4-{categoria}-{self.suffix}", "categoria": categoria, "unidad_medida": "ml"},
                    timeout=30,
                )
                self.assertEqual(res.status_code, 201, res.text)
                self._cleanup.append(("PECUARIO_INSUMOS", "id", res.json()[0]["id"]))

    def test_categoria_insumo_ya_no_acepta_cama(self):
        """'cama' fue renombrada a 'material' -- ya no es un valor válido del enum."""
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_INSUMOS",
            headers={**_service_headers(), "Content-Type": "application/json"},
            json={"ID_Organizacion": ORG_A, "nombre": f"TEST-V4-cama-{self.suffix}", "categoria": "cama", "unidad_medida": "kg"},
            timeout=30,
        )
        self.assertEqual(res.status_code, 400, res.text)

    def test_unidad_medida_es_enum_no_texto_libre(self):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_INSUMOS",
            headers={**_service_headers(), "Content-Type": "application/json"},
            json={"ID_Organizacion": ORG_A, "nombre": f"TEST-V4-badunit-{self.suffix}", "unidad_medida": "kilogramos-sueltos"},
            timeout=30,
        )
        self.assertEqual(res.status_code, 400, res.text)

    def test_vw_pecuario_insumos_stock_incluye_insumo_recien_creado(self):
        insumo = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_INSUMOS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": ORG_A, "nombre": f"TEST-V4-STOCK-{self.suffix}", "categoria": "alimento", "unidad_medida": "saco_50kg"},
            timeout=30,
        )
        insumo.raise_for_status()
        insumo_id = insumo.json()[0]["id"]
        self._cleanup.append(("PECUARIO_INSUMOS", "id", insumo_id))

        mov = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_INSUMOS_MOVIMIENTOS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": ORG_A, "insumo_id": insumo_id, "tipo_movimiento": "entrada", "cantidad": 5, "observaciones": "Stock inicial al registrar insumo"},
            timeout=30,
        )
        mov.raise_for_status()
        self._cleanup.append(("PECUARIO_INSUMOS_MOVIMIENTOS", "id", mov.json()[0]["id"]))

        stock = httpx.get(
            f"{SUPABASE_URL}/rest/v1/vw_pecuario_insumos_stock",
            headers=_service_headers(),
            params={"insumo_id": f"eq.{insumo_id}"},
            timeout=30,
        )
        stock.raise_for_status()
        rows = stock.json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(float(rows[0]["stock_actual"]), 5.0)
        self.assertEqual(rows[0]["unidad_medida"], "saco_50kg")


if __name__ == "__main__":
    unittest.main(verbosity=2)
