"""
Tests para la migración de sanitización del GIS Core (Tarea GIS Core Reengineering).

Dos grupos:
- Tests estáticos (siempre corren, sin credenciales): verifican que el archivo
  de migración contiene los patrones de idempotencia y las decisiones de
  diseño esperadas (área informativa, no bloqueante).
- Tests funcionales contra Supabase Live (@NEEDS_SUPABASE, se saltan sin
  SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY), mismo patrón que
  tests/test_fase1_sdd.py.
"""

import os
import re
import unittest
from pathlib import Path

import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase"
    / "migrations"
    / "20260818_gis_core_sanitization.sql"
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

NEEDS_SUPABASE = pytest.mark.skipif(
    not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY,
    reason="SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configuradas — test requiere Supabase Live",
)

TABLES = ("EUDR_MONITOREO", "EUDR_USO_SUELO", "EUDR_INSTALACIONES")


class TestMigrationFileStatic(unittest.TestCase):
    """Verifica el contenido del archivo de migración sin necesidad de Postgres."""

    @classmethod
    def setUpClass(cls):
        cls.assertTrue_ = unittest.TestCase.assertTrue
        if not MIGRATION_PATH.exists():
            raise AssertionError(f"No existe {MIGRATION_PATH}")
        cls.sql = MIGRATION_PATH.read_text(encoding="utf-8")

    def test_file_exists(self):
        self.assertTrue(MIGRATION_PATH.exists())

    def test_wrapped_in_transaction(self):
        self.assertRegex(self.sql, r"\bBEGIN;")
        self.assertRegex(self.sql, r"\bCOMMIT;")

    def test_sanitize_function_present(self):
        self.assertIn("fn_sanitize_geometry", self.sql)
        self.assertIn("CREATE OR REPLACE FUNCTION public.fn_sanitize_geometry", self.sql)

    def test_area_function_present(self):
        self.assertIn("fn_calcular_area_ha", self.sql)
        self.assertIn("CREATE OR REPLACE FUNCTION public.fn_calcular_area_ha", self.sql)

    def test_no_hard_rejection_on_area(self):
        """Decisión de diseño confirmada: el área < 4ha NUNCA bloquea el INSERT/UPDATE.

        Solo se inspecciona SQL ejecutable (se descartan comentarios `--`,
        que mencionan RAISE EXCEPTION deliberadamente al explicar la decisión
        de diseño de NO usarlo).
        """
        executable_lines = [
            line for line in self.sql.splitlines() if not line.strip().startswith("--")
        ]
        executable_sql = "\n".join(executable_lines)
        self.assertNotIn("RAISE EXCEPTION", executable_sql.upper())

    def test_area_flag_is_boolean_not_blocking(self):
        self.assertIn("requiere_revision_area", self.sql)
        self.assertIn("< 4.0", self.sql)

    def test_gist_index_per_table(self):
        for table in TABLES:
            pattern = rf'CREATE INDEX IF NOT EXISTS \w+\s+ON public\."{table}" USING GIST'
            self.assertRegex(
                self.sql, pattern, f"Falta índice GiST para {table}"
            )

    def test_org_index_per_table(self):
        for table in TABLES:
            pattern = rf'CREATE INDEX IF NOT EXISTS \w+\s+ON public\."{table}" \("ID_Organizacion"\)'
            self.assertRegex(
                self.sql, pattern, f"Falta índice ID_Organizacion para {table}"
            )

    def test_trigger_per_table(self):
        for table in TABLES:
            self.assertIn(f'ON public."{table}"', self.sql)
        self.assertIn("trg_gis_sanitize_eudr_monitoreo", self.sql)
        self.assertIn("trg_gis_sanitize_eudr_uso_suelo", self.sql)
        self.assertIn("trg_gis_sanitize_eudr_instalaciones", self.sql)

    def test_idempotency_patterns(self):
        self.assertIn("ADD COLUMN IF NOT EXISTS", self.sql)
        self.assertIn("CREATE INDEX IF NOT EXISTS", self.sql)
        self.assertRegex(self.sql, r"DROP TRIGGER IF EXISTS \w+ ON public\.")
        self.assertRegex(self.sql, r"CREATE OR REPLACE FUNCTION")

    def test_new_columns_added_to_all_three_tables(self):
        for table in TABLES:
            table_block_match = re.search(
                rf'ALTER TABLE public\."{table}"(.*?);', self.sql, re.DOTALL
            )
            self.assertIsNotNone(table_block_match, f"No hay ALTER TABLE para {table}")
            block = table_block_match.group(1)
            self.assertIn("area_calculada_ha", block)
            self.assertIn("requiere_revision_area", block)


class TestViewIntegrationFlags(unittest.TestCase):
    """Cierra el hallazgo de ADR-001 (gap cerrado por
    supabase/migrations/20260818_fix_views_eudr_flags.sql, ver addendum en el
    ADR): vw_monitoreo_poligonos/puntos/web ahora exponen
    area_calculada_ha/requiere_revision_area en cada rama del UNION ALL.

    Las migraciones históricas (20260816_fase2_vistas_qc.sql,
    20260817_refine_vw_monitoreo_web.sql) legítimamente NO tienen estas
    columnas — son anteriores a la sanitización — y no se reescriben; la
    versión vigente de las 3 vistas es la de 20260818_fix_views_eudr_flags.sql
    (DROP + CREATE completo), que es lo que este test verifica.
    """

    FIX_MIGRATION = (
        Path(__file__).resolve().parent.parent
        / "supabase"
        / "migrations"
        / "20260818_fix_views_eudr_flags.sql"
    )

    VIEW_NAMES = (
        "vw_monitoreo_poligonos",
        "vw_monitoreo_puntos",
        "vw_monitoreo_web",
    )

    @classmethod
    def setUpClass(cls):
        if not cls.FIX_MIGRATION.exists():
            raise AssertionError(f"No existe {cls.FIX_MIGRATION}")
        cls.sql = cls.FIX_MIGRATION.read_text(encoding="utf-8")

    def test_fix_migration_exists_and_is_idempotent(self):
        self.assertRegex(self.sql, r"\bBEGIN;")
        self.assertRegex(self.sql, r"\bCOMMIT;")
        self.assertIn("DROP VIEW IF EXISTS public.vw_monitoreo_web CASCADE", self.sql)
        self.assertIn("DROP VIEW IF EXISTS public.vw_monitoreo_poligonos", self.sql)
        self.assertIn("DROP VIEW IF EXISTS public.vw_monitoreo_puntos", self.sql)

    def test_all_three_views_recreated(self):
        for view in self.VIEW_NAMES:
            self.assertIn(f"CREATE VIEW public.{view}", self.sql)
            self.assertIn(f"GRANT SELECT ON public.{view} TO authenticated", self.sql)

    def test_area_flags_present_in_each_view_block(self):
        """AC1/AC2 de specs/fix_views_eudr_flags.md: cada uno de los 3
        CREATE VIEW contiene ambas columnas en las 2 ramas de su UNION ALL
        (se cuenta >= 2 ocurrencias por vista, una por rama)."""
        blocks = re.split(r"CREATE VIEW public\.", self.sql)[1:]
        self.assertEqual(len(blocks), 3, "Se esperaban 3 bloques CREATE VIEW")
        for block in blocks:
            view_name = block.split()[0].strip()
            self.assertGreaterEqual(
                block.count("area_calculada_ha"),
                2,
                f"{view_name}: area_calculada_ha debe aparecer en ambas ramas del UNION ALL",
            )
            self.assertGreaterEqual(
                block.count("requiere_revision_area"),
                2,
                f"{view_name}: requiere_revision_area debe aparecer en ambas ramas del UNION ALL",
            )

    def test_no_existing_columns_removed(self):
        """AC3: ninguna columna preexistente de vw_monitoreo_web se pierde
        respecto a 20260817_refine_vw_monitoreo_web.sql."""
        previous_path = (
            Path(__file__).resolve().parent.parent
            / "supabase"
            / "migrations"
            / "20260817_refine_vw_monitoreo_web.sql"
        )
        previous_sql = previous_path.read_text(encoding="utf-8")
        preexisting_columns = [
            "tipo_geometria",
            "tabla_origen",
            "registro_id",
            "ID_Organizacion",
            "ID_Parcela_Fija",
            "parcela_codigo",
            "parcela_nombre",
            "area_ha",
            "productor",
            "clasificacion",
            "evidencia_foto",
            "estado_revision",
            "fecha_monitoreo",
            "observaciones",
            "cumple_eudr",
            "geom_geojson",
        ]
        for column in preexisting_columns:
            self.assertIn(column, previous_sql, f"Verificación inconsistente: {column} no está ni en la migración previa")
            self.assertIn(column, self.sql, f"Columna preexistente {column} se perdió en la nueva migración de vistas")


@NEEDS_SUPABASE
class TestGisSanitizationLive(unittest.TestCase):
    """AC1-AC5 de specs/gis_core_reengineering.md contra Supabase real."""

    def setUp(self):
        from supabase import create_client

        self.supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    def test_small_polygon_is_flagged_not_rejected(self):
        """AC3: un polígono < 4ha se inserta sin excepción y queda flaggeado."""
        small_square_wkt = (
            "SRID=4326;POLYGON((-75.0 4.0, -75.0001 4.0, "
            "-75.0001 4.0001, -75.0 4.0001, -75.0 4.0))"
        )
        # FK real EUDR_USO_SUELO.ID_Organizacion -> ORGANIZACIONES("ID")
        # (supabase/migrations/20260821_225310_fk_id_organizacion_eudr.sql,
        # posterior a este test) -- sin esta fila el INSERT de abajo falla
        # con 23503.
        self.supabase.table("ORGANIZACIONES").insert(
            {"ID": "TEST-GIS-SANITIZATION", "es_organizacion_prueba": True}
        ).execute()
        res = (
            self.supabase.table("EUDR_USO_SUELO")
            .insert(
                {
                    "ID_Organizacion": "TEST-GIS-SANITIZATION",
                    "geom": small_square_wkt,
                    "tipo_uso": "TEST",
                    "estado_revision": "PENDIENTE",
                }
            )
            .execute()
        )
        row = res.data[0]
        self.assertIsNotNone(row.get("area_calculada_ha"))
        self.assertLess(float(row["area_calculada_ha"]), 4.0)
        self.assertTrue(row.get("requiere_revision_area"))
        # NUNCA por `fid` -- es el feature id nativo del GeoPackage, sin
        # DEFAULT en esta tabla: un INSERT manual (no vía ETL/QField) como
        # este lo deja NULL. `.eq("fid", None)` serializa literal a
        # `fid=eq.None` (postgrest-py base_request_builder.py:302, f-string
        # sin guardia para None) -- Postgres rechaza esa comparación de
        # bigint con 22P02 ("invalid input syntax for type bigint: \"None\"").
        # `id` sí es la PK real de la tabla (docs/schema_live.md) y siempre
        # viene poblada.
        self.supabase.table("EUDR_USO_SUELO").delete().eq(
            "id", row["id"]
        ).execute()
        self.supabase.table("ORGANIZACIONES").delete().eq("ID", "TEST-GIS-SANITIZATION").execute()

    def test_point_geometry_has_null_area(self):
        """AC4: un punto no tiene área — area_calculada_ha y el flag quedan NULL."""
        point_wkt = "SRID=4326;POINT(-75.0 4.0)"
        # Mismo motivo que en test_small_polygon_is_flagged_not_rejected
        # arriba -- EUDR_INSTALACIONES.ID_Organizacion tiene la misma FK real.
        self.supabase.table("ORGANIZACIONES").insert(
            {"ID": "TEST-GIS-SANITIZATION", "es_organizacion_prueba": True}
        ).execute()
        res = (
            self.supabase.table("EUDR_INSTALACIONES")
            .insert(
                {
                    "ID_Organizacion": "TEST-GIS-SANITIZATION",
                    "geom": point_wkt,
                    "tipo_infra": "TEST",
                    "estado_revision": "PENDIENTE",
                }
            )
            .execute()
        )
        row = res.data[0]
        self.assertIsNone(row.get("area_calculada_ha"))
        self.assertIsNone(row.get("requiere_revision_area"))
        # Mismo motivo que en test_small_polygon_is_flagged_not_rejected
        # arriba -- borrar por `id` (PK real), nunca por `fid` (NULL en un
        # INSERT manual, `.eq("fid", None)` rompe con 22P02).
        self.supabase.table("EUDR_INSTALACIONES").delete().eq(
            "id", row["id"]
        ).execute()
        self.supabase.table("ORGANIZACIONES").delete().eq("ID", "TEST-GIS-SANITIZATION").execute()

    # AC5 (índice GiST presente) no tiene test Live: el proyecto no expone
    # ninguna función RPC para correr SQL arbitrario (pg_indexes) desde
    # supabase-py — verificarlo manualmente en Supabase Studio tras aplicar
    # la migración. TestMigrationFileStatic.test_gist_index_per_table ya
    # certifica que la migración SQL crea los 3 índices.


if __name__ == "__main__":
    unittest.main(verbosity=2)
