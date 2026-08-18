"""
Tests estáticos para la auditoría RLS Multi-Tenant (Zero-Trust donde aplica).
Ver specs/rls_multi_tenant_audit.md.

No requieren Supabase Live — verifican el contenido de
supabase/migrations/20260818_rls_multi_tenant_fortification.sql y su
consistencia con el resto del historial de migraciones.
"""

import re
import unittest
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "supabase" / "migrations"
FORTIFICATION_PATH = MIGRATIONS_DIR / "20260818_rls_multi_tenant_fortification.sql"

FORTIFIED_TABLES = (
    "ORGANIZACIONES",
    "EUDR_MONITOREO",
    "EUDR_USO_SUELO",
    "EUDR_INSTALACIONES",
)

# Documentado como riesgo aceptado por diseño (anon key sin Auth real) —
# deliberadamente fuera del alcance de esta migración. Ver spec.
ANON_DEPENDENT_TABLES = (
    "INSPECCIONES",
    "CAP_DATOS_SOCIO",
    "CAP_MIC",
    "CAP_CONSERVACION",
    "CAP_BIENESTAR",
    "CAP_RIESGOS",
    "CAP_GESTION",
    "PADRON_SOCIOS",
    "PADRON_PARCELAS",
)

ALL_AUDITED_TABLES = FORTIFIED_TABLES + ANON_DEPENDENT_TABLES


def _read_all_migrations() -> str:
    return "\n".join(
        p.read_text(encoding="utf-8") for p in sorted(MIGRATIONS_DIR.glob("*.sql"))
    )


class TestFortificationMigrationStatic(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not FORTIFICATION_PATH.exists():
            raise AssertionError(f"No existe {FORTIFICATION_PATH}")
        cls.sql = FORTIFICATION_PATH.read_text(encoding="utf-8")
        cls.all_migrations_sql = _read_all_migrations()

    def test_wrapped_in_transaction_and_idempotent(self):
        self.assertRegex(self.sql, r"\bBEGIN;")
        self.assertRegex(self.sql, r"\bCOMMIT;")
        self.assertIn("DROP POLICY IF EXISTS", self.sql)
        self.assertIn("ENABLE ROW LEVEL SECURITY", self.sql)

    def test_reuses_existing_auth_org_id_no_new_helper(self):
        """Decisión confirmada: reusar public.auth_org_id(), no crear
        fn_get_user_org_id() ni ninguna función helper nueva."""
        self.assertIn("public.auth_org_id()", self.sql)
        self.assertNotIn("fn_get_user_org_id", self.sql)
        self.assertNotIn("CREATE OR REPLACE FUNCTION public.auth_org_id", self.sql)
        self.assertNotIn("CREATE FUNCTION public.auth_org_id", self.sql)

    def test_all_fortified_tables_have_rls_enabled(self):
        for table in FORTIFIED_TABLES:
            self.assertIn(f'ALTER TABLE public."{table}"', self.sql)
            self.assertRegex(
                self.sql,
                rf'ALTER TABLE public\."{table}"\s+ENABLE ROW LEVEL SECURITY',
            )

    def test_all_fortified_tables_have_select_policy_scoped_to_org(self):
        for table in FORTIFIED_TABLES:
            pattern = (
                rf'CREATE POLICY "rls_select_\w+" ON public\."{table}"\n'
                rf"FOR SELECT TO authenticated"
            )
            self.assertRegex(self.sql, pattern, f"Falta política SELECT para {table}")

    def test_organizaciones_has_no_write_policy(self):
        """AC2: asimetría deliberada preservada — ORGANIZACIONES nunca
        recibe INSERT/UPDATE/DELETE vía RLS."""
        self.assertIn('CREATE POLICY "rls_select_organizaciones" ON public."ORGANIZACIONES"', self.sql)
        self.assertNotRegex(
            self.sql,
            r'ON public\."ORGANIZACIONES"\s*\nFOR (ALL|INSERT|UPDATE|DELETE)',
        )

    def test_eudr_tables_have_write_policy_including_delete(self):
        """Decisión confirmada: mantener DELETE habilitado (FOR ALL) en las
        3 tablas EUDR_*, consistente con Tarea 9.1."""
        for table in ("EUDR_MONITOREO", "EUDR_USO_SUELO", "EUDR_INSTALACIONES"):
            pattern = (
                rf'CREATE POLICY "rls_write_\w+" ON public\."{table}"\n'
                rf"FOR ALL TO authenticated"
            )
            self.assertRegex(self.sql, pattern, f"Falta política de escritura FOR ALL para {table}")

    def test_no_policy_references_id_organizacion_on_cap_tables(self):
        """AC4: las 6 tablas CAP_* no tienen columna ID_Organizacion propia —
        ninguna política nueva debe referenciarlas con ese filtro."""
        cap_tables = (
            "CAP_DATOS_SOCIO",
            "CAP_MIC",
            "CAP_CONSERVACION",
            "CAP_BIENESTAR",
            "CAP_RIESGOS",
            "CAP_GESTION",
        )
        for table in cap_tables:
            self.assertNotIn(f'"{table}"', self.sql)

    def test_anon_dependent_tables_untouched(self):
        """Decisión confirmada: no tocar políticas de INSPECCIONES/CAP_*/
        lectura anon de PADRON_* en esta migración."""
        for table in ("INSPECCIONES",):
            self.assertNotIn(f'ALTER TABLE public."{table}"', self.sql)
        self.assertNotIn("rls_anon_all_inspecciones", self.sql)
        self.assertNotIn("rls_anon_select_padron_socios", self.sql)
        self.assertNotIn("rls_anon_select_padron_parcelas", self.sql)

    def test_view_eudr_dashboard_aprobados_pii_fix(self):
        """AC3: la vista corregida no expone socio_dni/socio_nombre_completo
        y sí filtra por ID_Organizacion."""
        self.assertIn("DROP VIEW IF EXISTS public.view_eudr_dashboard_aprobados", self.sql)
        self.assertIn("CREATE VIEW public.view_eudr_dashboard_aprobados", self.sql)
        view_match = re.search(
            r"CREATE VIEW public\.view_eudr_dashboard_aprobados AS(.*?)GRANT SELECT",
            self.sql,
            re.DOTALL,
        )
        self.assertIsNotNone(view_match, "No se encontró el cuerpo de la vista corregida")
        view_body = view_match.group(1)
        self.assertNotIn("socio_dni", view_body)
        self.assertNotIn("socio_nombre_completo", view_body)
        self.assertIn('m."ID_Organizacion" = public.auth_org_id()', view_body)

    def test_no_livestock_tables_referenced(self):
        """No existen tablas 'pecuarias' en el proyecto — confirmado por
        auditoría; no deben aparecer como TABLA/POLÍTICA en la migración
        (se excluye el comentario de cabecera, que menciona el término
        deliberadamente al explicar por qué se excluyen)."""
        executable_sql = "\n".join(
            line for line in self.sql.splitlines() if not line.strip().startswith("--")
        )
        for term in ("pecuaria", "ganado", "livestock"):
            self.assertNotIn(term, executable_sql.lower())


class TestSchemaWideRlsCoverage(unittest.TestCase):
    """Verifica, contra el historial COMPLETO de migraciones (no solo el
    archivo nuevo), que toda tabla auditada tiene RLS habilitado en algún
    punto — la fortificación de hoy re-aserta 4 de ellas; las otras 9 ya lo
    tenían desde 20260815_fase1_security_storage.sql /
    20260818_fix_inspecciones_rls.sql."""

    @classmethod
    def setUpClass(cls):
        cls.all_migrations_sql = _read_all_migrations()

    def test_every_audited_table_has_rls_enabled_somewhere(self):
        for table in ALL_AUDITED_TABLES:
            pattern = rf'ALTER TABLE public\."{table}"\s+ENABLE ROW LEVEL SECURITY'
            self.assertRegex(
                self.all_migrations_sql,
                pattern,
                f"{table} nunca tiene ENABLE ROW LEVEL SECURITY en ningún migration file",
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
