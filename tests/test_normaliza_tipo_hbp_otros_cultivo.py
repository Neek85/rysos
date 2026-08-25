"""ADR-024 — normaliza PADRON_PARCELAS.hbp/otros_cultivo de text a numeric.

Solo tests estáticos: la migración altera datos reales (`ALTER COLUMN ...
TYPE`), y como toda migración de este repo, la aplicación real la hace el
usuario manualmente en Supabase Studio — no hay un test funcional contra
Supabase Live acá (a diferencia de tests/test_padron_baseline_adopcion.py,
cuya migración es CREATE TABLE IF NOT EXISTS, un no-op inofensivo de
re-ejecutar). Confirmar el tipo post-aplicación es un paso manual descrito
en el ADR, no una aserción automatizada en este entorno.
"""

import unittest
from pathlib import Path

MIGRATION_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase"
    / "migrations"
    / "20260825142426_normaliza_tipo_hbp_otros_cultivo.sql"
)


class TestNormalizaTipoHbpOtrosCultivoMigration(unittest.TestCase):
    """Verifica el contenido del archivo de migración sin necesidad de Postgres."""

    @classmethod
    def setUpClass(cls):
        if not MIGRATION_PATH.exists():
            raise AssertionError(f"No existe {MIGRATION_PATH}")
        cls.sql = MIGRATION_PATH.read_text(encoding="utf-8")

    def test_wrapped_in_transaction(self):
        self.assertTrue(self.sql.strip().startswith("--") or "BEGIN;" in self.sql)
        begin_idx = self.sql.index("BEGIN;")
        first_alter_idx = self.sql.index("ALTER COLUMN hbp")
        self.assertLess(begin_idx, first_alter_idx, "BEGIN; debe preceder a los ALTER COLUMN")
        self.assertRegex(self.sql.strip(), r"COMMIT;\s*$", "debe cerrar con COMMIT;")

    def test_alters_both_columns_to_numeric(self):
        self.assertRegex(self.sql, r"ALTER COLUMN hbp TYPE numeric")
        self.assertRegex(self.sql, r"ALTER COLUMN otros_cultivo TYPE numeric")

    def test_using_clause_handles_empty_and_whitespace_strings(self):
        # NULLIF(TRIM(x), '') evita que un string vacío/solo-espacios
        # tumbe la migración con un error de cast — convierte a NULL.
        self.assertRegex(self.sql, r"NULLIF\(TRIM\(hbp\), ''\)::numeric")
        self.assertRegex(self.sql, r"NULLIF\(TRIM\(otros_cultivo\), ''\)::numeric")

    def test_idempotent_type_check_before_each_alter(self):
        # Cada ALTER COLUMN debe estar guardado por un chequeo contra
        # information_schema.columns, para que una segunda corrida sea
        # no-op si la columna ya es numeric.
        occurrences = self.sql.count("information_schema.columns")
        self.assertGreaterEqual(occurrences, 2, "debe haber un chequeo de tipo por cada columna alterada")
        self.assertIn("column_name = 'hbp'", self.sql)
        self.assertIn("column_name = 'otros_cultivo'", self.sql)

    def test_touches_only_padron_parcelas(self):
        self.assertIn('ALTER TABLE public."PADRON_PARCELAS"', self.sql)
        self.assertNotIn("PADRON_SOCIOS", self.sql)
        self.assertNotIn("EUDR_", self.sql)

    def test_does_not_touch_other_columns(self):
        for column in ("hcp", "hcc", "ho", "hip", "hrp", "totalh", "geom"):
            self.assertNotIn(f"ALTER COLUMN {column}", self.sql)


if __name__ == "__main__":
    unittest.main()
