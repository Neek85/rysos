"""ADR-024 — normaliza PADRON_PARCELAS.hbp/otros_cultivo de text a numeric.

Solo tests estáticos: la migración altera datos reales (`ALTER COLUMN ...
TYPE`) y recrea una vista (`vw_parcelas_web`), y como toda migración de
este repo, la aplicación real la hace el usuario manualmente en Supabase
Studio — no hay un test funcional contra Supabase Live acá (a diferencia
de tests/test_padron_baseline_adopcion.py, cuya migración es CREATE TABLE
IF NOT EXISTS, un no-op inofensivo de re-ejecutar). Confirmar el tipo
post-aplicación es un paso manual descrito en el ADR, no una aserción
automatizada en este entorno.

Segunda versión (2026-08-25b): el primer intento (sin DROP/CREATE VIEW)
falló en Supabase Studio porque vw_parcelas_web depende de hbp — la
migración ahora envuelve DROP VIEW → ALTER COLUMN → CREATE VIEW → GRANT
en un único chequeo de idempotencia (no dos chequeos independientes como
la primera versión), con la definición exacta capturada en vivo
(pg_get_viewdef) por el usuario en Supabase Studio SQL Editor.
"""

import unittest
from pathlib import Path

MIGRATION_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase"
    / "migrations"
    / "20260825142426_normaliza_tipo_hbp_otros_cultivo.sql"
)

VIEW_COLUMNS = (
    "ID_Parcela_Fija",
    "ID_Organizacion",
    "ID_Socio",
    "socio_dni",
    "socio_nombre_completo",
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
    "creado_en",
    "actualizado_en",
    "creado_por",
)


class TestNormalizaTipoHbpOtrosCultivoMigration(unittest.TestCase):
    """Verifica el contenido del archivo de migración sin necesidad de Postgres."""

    @classmethod
    def setUpClass(cls):
        if not MIGRATION_PATH.exists():
            raise AssertionError(f"No existe {MIGRATION_PATH}")
        cls.sql = MIGRATION_PATH.read_text(encoding="utf-8")

    def test_wrapped_in_transaction(self):
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

    def test_single_idempotent_check_gates_the_whole_block(self):
        # A diferencia de la primera version (un chequeo por columna), esta
        # envuelve DROP VIEW + ambos ALTER COLUMN + CREATE VIEW + GRANTs en
        # un unico chequeo de tipo -- una segunda corrida debe ser no-op
        # completo (no recrea la vista ni reaplica GRANTs de mas).
        # El header de comentario también menciona la frase en prosa -- solo
        # cuenta lo que aparece después de BEGIN; (el cuerpo ejecutable).
        body = self.sql[self.sql.index("BEGIN;") :]
        self.assertEqual(
            body.count("information_schema.columns"),
            1,
            "debe haber un unico chequeo de idempotencia gateando todo el bloque",
        )
        self.assertIn("column_name = 'hbp'", self.sql)
        # Todos los índices se miden dentro de `body` (después de BEGIN;)
        # para no confundir el orden real con menciones en el comentario
        # de cabecera, que describe el mismo flujo en prosa.
        check_idx = body.index("information_schema.columns")
        drop_idx = body.index("DROP VIEW")
        alter_idx = body.index("ALTER COLUMN hbp")
        create_idx = body.index("CREATE VIEW public.vw_parcelas_web")
        grant_idx = body.index("GRANT")
        self.assertLess(check_idx, drop_idx)
        self.assertLess(drop_idx, alter_idx)
        self.assertLess(alter_idx, create_idx)
        self.assertLess(create_idx, grant_idx)

    def test_drops_and_recreates_dependent_view(self):
        self.assertIn("DROP VIEW IF EXISTS public.vw_parcelas_web", self.sql)
        self.assertIn("CREATE VIEW public.vw_parcelas_web", self.sql)
        self.assertIn("security_invoker = true", self.sql)

    def test_recreated_view_selects_exact_confirmed_columns(self):
        create_block = self.sql[
            self.sql.index("CREATE VIEW public.vw_parcelas_web") : self.sql.index('FROM "PADRON_PARCELAS"')
        ]
        for column in VIEW_COLUMNS:
            self.assertIn(column, create_block, f"columna {column} confirmada en vivo falta en el CREATE VIEW")

    def test_grants_reapplied_to_all_three_roles(self):
        for role in ("anon", "authenticated", "service_role"):
            self.assertIn(f"ON public.vw_parcelas_web TO {role}", self.sql)
        # GRANTs completos confirmados en vivo (no solo SELECT) -- ver
        # ADR-024 para el hallazgo de seguridad que queda fuera de alcance.
        for privilege in ("DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"):
            self.assertIn(privilege, self.sql)

    def test_touches_only_padron_parcelas_and_its_view(self):
        self.assertIn('ALTER TABLE public."PADRON_PARCELAS"', self.sql)
        self.assertNotIn("PADRON_SOCIOS", self.sql)
        self.assertNotIn("EUDR_", self.sql)
        self.assertNotIn("vw_socios_web", self.sql)

    def test_does_not_touch_other_columns(self):
        for column in ("hcp", "hcc", "ho", "hip", "hrp", "totalh", "geom"):
            self.assertNotIn(f"ALTER COLUMN {column}", self.sql)


if __name__ == "__main__":
    unittest.main()
