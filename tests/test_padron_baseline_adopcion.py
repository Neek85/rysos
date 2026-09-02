"""ADR-023 / specs/padron_baseline_adopcion.md — migración base que adopta
PADRON_SOCIOS/PADRON_PARCELAS al historial de migraciones.

- Tests estáticos (siempre corren, sin credenciales): confirman que la
  migración usa CREATE TABLE IF NOT EXISTS (no-op garantizado contra la
  base viva) y que incluye las columnas confirmadas en vivo, incluida la
  no documentada previamente (normas_internas_17).
- Tests funcionales contra Supabase Live (@NEEDS_SUPABASE, se saltan sin
  SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY), mismo patrón que
  tests/test_gis_core_sanitization.py: confirman que las columnas
  esperadas siguen existiendo en la instancia real, sin escribir nada.
"""

import os
import unittest
from pathlib import Path

import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase"
    / "migrations"
    / "20260825183000_baseline_padron_socios_parcelas.sql"
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

NEEDS_SUPABASE = pytest.mark.skipif(
    not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY,
    reason="SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configuradas — test requiere Supabase Live",
)

PADRON_SOCIOS_COLUMNS = (
    "ID_Socio",
    "ID_Organizacion",
    "socio_nombre_completo",
    "socio_dni",
    "cert_nop_usda",
    "ue_2018_848",
    "cor_canada",
    "cert_ds_0442006_ag",
    "cert_lpo_mx",
    "cert_rainforest",
    "cert_comercio_justo",
    "cert_fair_trade_usa",
    "cert_org_estatus",
    "certificaciones",
    "normas_internas_17",
    "activo",
)

PADRON_PARCELAS_COLUMNS = (
    "ID_Parcela_Fija",
    "ID_Organizacion",
    "ID_Socio",
    "parcela_codigo",
    "parcela_nombre",
    "hcp",
    "hcc",
    "ho",
    "hip",
    "hrp",
    "hbp",
    "otros_cultivo",
    "totalh",
    "geom",
    "activo",
)


class TestBaselineMigrationFileStatic(unittest.TestCase):
    """Verifica el contenido del archivo de migración sin necesidad de Postgres."""

    @classmethod
    def setUpClass(cls):
        if not MIGRATION_PATH.exists():
            raise AssertionError(f"No existe {MIGRATION_PATH}")
        cls.sql = MIGRATION_PATH.read_text(encoding="utf-8")

    def test_is_idempotent_create_table_if_not_exists(self):
        self.assertIn('CREATE TABLE IF NOT EXISTS public."PADRON_SOCIOS"', self.sql)
        self.assertIn('CREATE TABLE IF NOT EXISTS public."PADRON_PARCELAS"', self.sql)

    def test_wrapped_in_transaction(self):
        # El header de comentario va antes de BEGIN; (mismo estilo que el
        # resto de supabase/migrations/) — solo importa que BEGIN preceda
        # a ambos CREATE TABLE y que COMMIT cierre el archivo.
        begin_idx = self.sql.index("BEGIN;")
        first_create_idx = self.sql.index('CREATE TABLE IF NOT EXISTS public."PADRON_SOCIOS"')
        self.assertLess(begin_idx, first_create_idx, "BEGIN; debe preceder a los CREATE TABLE")
        self.assertRegex(self.sql.strip(), r"COMMIT;\s*$", "debe cerrar con COMMIT;")

    def test_primary_keys_are_simple_columns_not_compound(self):
        # La PK compuesta / id sintético nuevo es la tarea siguiente de la
        # secuencia (multi_organizacion_codigos_unicos.md), fuera de esta.
        self.assertIn('"ID_Socio" text PRIMARY KEY', self.sql)
        self.assertIn('"ID_Parcela_Fija" text PRIMARY KEY', self.sql)

    def test_padron_socios_has_all_confirmed_columns(self):
        socios_block = self.sql[
            self.sql.index('CREATE TABLE IF NOT EXISTS public."PADRON_SOCIOS"') : self.sql.index(
                'CREATE TABLE IF NOT EXISTS public."PADRON_PARCELAS"'
            )
        ]
        for column in PADRON_SOCIOS_COLUMNS:
            self.assertIn(
                column, socios_block, f"Columna confirmada en vivo {column} falta en la migración"
            )

    def test_padron_parcelas_has_all_confirmed_columns(self):
        parcelas_block = self.sql[
            self.sql.index('CREATE TABLE IF NOT EXISTS public."PADRON_PARCELAS"') :
        ]
        for column in PADRON_PARCELAS_COLUMNS:
            self.assertIn(
                column, parcelas_block, f"Columna confirmada en vivo {column} falta en la migración"
            )

    def test_hbp_y_otros_cultivo_son_text_no_numeric(self):
        # Discrepancia real confirmada en vivo (OpenAPI de PostgREST):
        # a diferencia de hcp/hcc/ho/hip/hrp (numeric), estas dos son text
        # en la instancia real — la migración debe reflejar eso, no lo que
        # asume lib/validations/socios.js (HECTARE_FIELDS, coerción numérica).
        self.assertRegex(self.sql, r"\bhbp text\b")
        self.assertRegex(self.sql, r"\botros_cultivo text\b")
        self.assertNotRegex(self.sql, r"\bhbp numeric\b")
        self.assertNotRegex(self.sql, r"\botros_cultivo numeric\b")

    def test_no_rls_no_extra_indexes_no_new_fk(self):
        # Contrato explícito de specs/padron_baseline_adopcion.md: esta
        # migración solo captura la forma de la tabla.
        self.assertNotIn("ENABLE ROW LEVEL SECURITY", self.sql)
        self.assertNotIn("CREATE POLICY", self.sql)
        self.assertNotIn("CREATE INDEX", self.sql)
        self.assertNotIn("REFERENCES public.\"ORGANIZACIONES\"", self.sql)


@NEEDS_SUPABASE
class TestBaselineColumnsLive(unittest.TestCase):
    """Confirma en vivo que las columnas esperadas siguen existiendo — solo
    lectura, no escribe ni modifica ninguna fila."""

    def setUp(self):
        from supabase import create_client

        self.supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    def test_padron_socios_columns_exist(self):
        res = self.supabase.table("PADRON_SOCIOS").select("*").limit(1).execute()
        self.assertTrue(res.data, "PADRON_SOCIOS no devolvió ninguna fila para inspeccionar columnas")
        row = res.data[0]
        for column in PADRON_SOCIOS_COLUMNS:
            self.assertIn(column, row, f"Columna esperada {column} ausente en la respuesta real")

    def test_padron_parcelas_columns_exist(self):
        res = self.supabase.table("PADRON_PARCELAS").select("*").limit(1).execute()
        self.assertTrue(res.data, "PADRON_PARCELAS no devolvió ninguna fila para inspeccionar columnas")
        row = res.data[0]
        for column in PADRON_PARCELAS_COLUMNS:
            self.assertIn(column, row, f"Columna esperada {column} ausente en la respuesta real")


if __name__ == "__main__":
    unittest.main()
