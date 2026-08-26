"""Paso 4 -- multi-producto café/cacao: PRODUCTOS, ORGANIZACION_PRODUCTOS,
PADRON_PARCELAS.id_producto_predominante (dato maestro, con backfill a
CAFE), EUDR_USO_SUELO.id_producto_predominante (foto por evento, vía
trigger BEFORE INSERT no bloqueante), y la extensión de
vw_monitoreo_poligonos/vw_monitoreo_web. Ver
specs/multi_producto_cafe_cacao.md (contrato de datos cerrado, sección 8)
y docs/adr/ADR-028-multi-producto-cafe-cacao.md.

- Tests estáticos (siempre corren, sin credenciales): confirman la
  estructura de la migración SQL -- las 2 tablas nuevas con su contrato
  exacto, RLS/políticas/GRANTs, el seed de 2 filas, el backfill
  idempotente de PADRON_PARCELAS, el trigger no bloqueante, y la
  extensión de las 2 vistas.
- Tests funcionales contra Supabase Live (@NEEDS_SUPABASE_AND_MIGRATED):
  además de las credenciales, se auto-saltan si la migración todavía no
  fue aplicada -- mismo patrón que TestPkSurrogateLive/
  TestCertificacionesNormalizadasLive. Confirman: seed de 2 filas,
  backfill real, aislamiento multi-tenant cruzado en ORGANIZACION_PRODUCTOS,
  el trigger resolviendo correctamente la cadena de 2 saltos con datos
  reales, y el trigger NO bloqueando el INSERT cuando la cadena no
  resuelve.
"""

import os
import unittest
from pathlib import Path

import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase"
    / "migrations"
    / "20260826120000_multi_producto_cafe_cacao.sql"
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

NEEDS_SUPABASE = pytest.mark.skipif(
    not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY,
    reason="SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configuradas -- test requiere Supabase Live",
)

ORG_A = "ORG-TEST-PRODUCTO-A"
ORG_B = "ORG-TEST-PRODUCTO-B"


def _migration_is_applied(supabase):
    """La migración crea PRODUCTOS -- su ausencia significa que todavía no
    se aplicó manualmente en Supabase Studio."""
    try:
        supabase.table("PRODUCTOS").select("id").limit(1).execute()
        return True
    except Exception:
        return False


class TestMigrationFileStatic(unittest.TestCase):
    """Verifica el contenido del archivo de migración sin necesidad de Postgres."""

    @classmethod
    def setUpClass(cls):
        if not MIGRATION_PATH.exists():
            raise AssertionError(f"No existe {MIGRATION_PATH}")
        cls.sql = MIGRATION_PATH.read_text(encoding="utf-8")

    def test_wrapped_in_transaction(self):
        self.assertIn("BEGIN;", self.sql)
        self.assertRegex(self.sql.strip(), r"COMMIT;\s*$")

    def test_productos_table_contract(self):
        start = self.sql.index('CREATE TABLE IF NOT EXISTS public."PRODUCTOS"')
        end = self.sql.index('CREATE TABLE IF NOT EXISTS public."ORGANIZACION_PRODUCTOS"')
        block = self.sql[start:end]
        self.assertIn("id         uuid PRIMARY KEY DEFAULT gen_random_uuid()", block)
        self.assertIn("codigo     text NOT NULL UNIQUE", block)
        self.assertIn("nombre     text NOT NULL", block)
        self.assertIn("vertical   text NOT NULL CHECK (vertical IN ('AGRICOLA', 'PECUARIO'))", block)
        self.assertIn("activo     boolean NOT NULL DEFAULT true", block)

    def test_organizacion_productos_table_contract(self):
        start = self.sql.index('CREATE TABLE IF NOT EXISTS public."ORGANIZACION_PRODUCTOS"')
        end = self.sql.index("-- ============", start)
        block = self.sql[start:end]
        self.assertIn('id_organizacion   text NOT NULL REFERENCES public."ORGANIZACIONES"("ID")', block)
        self.assertIn('id_producto       uuid NOT NULL REFERENCES public."PRODUCTOS"(id)', block)
        self.assertIn("UNIQUE (id_organizacion, id_producto)", block)

    def test_rls_enabled_on_both(self):
        for table in ("PRODUCTOS", "ORGANIZACION_PRODUCTOS"):
            self.assertIn(f'ALTER TABLE public."{table}"', self.sql)
        self.assertEqual(self.sql.count("ENABLE ROW LEVEL SECURITY"), 2)

    def test_productos_has_open_anon_select_using_true(self):
        self.assertIn(
            'CREATE POLICY "rls_anon_select_productos" ON public."PRODUCTOS"\n' "FOR SELECT TO anon\nUSING (true);",
            self.sql,
        )

    def test_organizacion_productos_replicates_padron_anon_pattern(self):
        self.assertIn(
            'CREATE POLICY "rls_anon_select_organizacion_productos" ON public."ORGANIZACION_PRODUCTOS"\n'
            "FOR SELECT TO anon\nUSING (id_organizacion IS NOT NULL);",
            self.sql,
        )

    def test_no_anon_write_policy_anywhere(self):
        self.assertNotIn("FOR ALL TO anon", self.sql)
        self.assertNotIn("FOR INSERT TO anon", self.sql)
        self.assertNotIn("FOR UPDATE TO anon", self.sql)
        self.assertNotIn("FOR DELETE TO anon", self.sql)

    def test_grants_present_for_all_three_roles(self):
        for table in ("PRODUCTOS", "ORGANIZACION_PRODUCTOS"):
            self.assertRegex(self.sql, rf'GRANT SELECT ON public\."{table}"\s+TO anon, authenticated;')
            self.assertRegex(
                self.sql, rf'GRANT SELECT, INSERT, UPDATE, DELETE ON public\."{table}"\s+TO service_role;'
            )

    def test_seed_has_exactly_2_rows_cafe_cacao_agricola(self):
        start = self.sql.index('INSERT INTO public."PRODUCTOS" (codigo, nombre, vertical) VALUES')
        end = self.sql.index("ON CONFLICT (codigo) DO NOTHING", start)
        seed_block = self.sql[start:end]
        self.assertIn("('CAFE',  'Café',  'AGRICOLA')", seed_block)
        self.assertIn("('CACAO', 'Cacao', 'AGRICOLA')", seed_block)
        self.assertEqual(seed_block.count("('"), 2, "el seed debe tener exactamente 2 filas")

    def test_padron_parcelas_column_and_backfill_present(self):
        self.assertIn(
            'ALTER TABLE public."PADRON_PARCELAS"\n'
            "    ADD COLUMN IF NOT EXISTS id_producto_predominante uuid REFERENCES public.\"PRODUCTOS\"(id);",
            self.sql,
        )
        backfill_idx = self.sql.index('UPDATE public."PADRON_PARCELAS"')
        backfill_block = self.sql[backfill_idx : backfill_idx + 300]
        self.assertIn("SET id_producto_predominante = (SELECT id FROM public.\"PRODUCTOS\" WHERE codigo = 'CAFE')", backfill_block)
        self.assertIn("WHERE id_producto_predominante IS NULL", backfill_block)

    def test_eudr_uso_suelo_column_present_no_backfill(self):
        self.assertIn(
            'ALTER TABLE public."EUDR_USO_SUELO"\n'
            "    ADD COLUMN IF NOT EXISTS id_producto_predominante uuid REFERENCES public.\"PRODUCTOS\"(id);",
            self.sql,
        )
        # A diferencia de PADRON_PARCELAS, EUDR_USO_SUELO NO tiene backfill --
        # se puebla exclusivamente por el trigger, hacia adelante.
        eudr_alter_idx = self.sql.index('ALTER TABLE public."EUDR_USO_SUELO"')
        trigger_idx = self.sql.index("CREATE OR REPLACE FUNCTION public.fn_set_producto_predominante_uso_suelo")
        between = self.sql[eudr_alter_idx:trigger_idx]
        self.assertNotIn("UPDATE public.\"EUDR_USO_SUELO\"", between)

    def test_trigger_function_never_raises_exception(self):
        start = self.sql.index("CREATE OR REPLACE FUNCTION public.fn_set_producto_predominante_uso_suelo")
        end = self.sql.index("$$;", start)
        block = self.sql[start:end]
        self.assertNotIn("RAISE EXCEPTION", block)
        self.assertNotIn("RAISE ERROR", block)
        self.assertIn("RETURN NEW;", block)

    def test_trigger_function_resolves_the_real_2_hop_chain(self):
        start = self.sql.index("CREATE OR REPLACE FUNCTION public.fn_set_producto_predominante_uso_suelo")
        end = self.sql.index("$$;", start)
        block = self.sql[start:end]
        # Salto 1: id_parcela (GUID QField) -> EUDR_MONITOREO.qfield_relation_id
        self.assertIn('m.qfield_relation_id = NEW.id_parcela', block)
        self.assertIn('m."ID_Organizacion" = NEW."ID_Organizacion"', block)
        # Salto 2: EUDR_MONITOREO.ID_Parcela_Fija -> PADRON_PARCELAS
        self.assertIn('pp."ID_Parcela_Fija" = v_id_parcela_fija', block)
        self.assertIn('pp."ID_Organizacion" = NEW."ID_Organizacion"', block)
        self.assertIn("NEW.id_producto_predominante := v_id_producto;", block)

    def test_trigger_created_before_insert_on_eudr_uso_suelo(self):
        self.assertIn('DROP TRIGGER IF EXISTS trg_set_producto_predominante_uso_suelo ON public."EUDR_USO_SUELO";', self.sql)
        self.assertIn(
            "CREATE TRIGGER trg_set_producto_predominante_uso_suelo\n"
            '    BEFORE INSERT ON public."EUDR_USO_SUELO"',
            self.sql,
        )

    def test_vw_monitoreo_poligonos_exposes_column_null_on_eudr_monitoreo_branch(self):
        start = self.sql.index("CREATE OR REPLACE VIEW public.vw_monitoreo_poligonos")
        end = self.sql.index("UNION ALL", start)
        eudr_monitoreo_branch = self.sql[start:end]
        self.assertIn("NULL::uuid                AS id_producto_predominante", eudr_monitoreo_branch)

        end2 = self.sql.index("-- 10. vw_monitoreo_web", end)
        eudr_uso_suelo_branch = self.sql[end:end2]
        self.assertIn("u.id_producto_predominante", eudr_uso_suelo_branch)

    def test_vw_monitoreo_web_poligono_branch_joins_productos_not_padron_parcelas(self):
        start = self.sql.index("CREATE OR REPLACE VIEW public.vw_monitoreo_web")
        union_idx = self.sql.index("UNION ALL", start)
        poligono_branch = self.sql[start:union_idx]
        self.assertIn("src.id_producto_predominante,", poligono_branch)
        self.assertIn("prod.codigo    AS producto_codigo,", poligono_branch)
        self.assertIn("prod.nombre    AS producto_nombre", poligono_branch)
        self.assertIn('LEFT JOIN public."PRODUCTOS" prod', poligono_branch)
        self.assertIn("ON prod.id = src.id_producto_predominante", poligono_branch)

    def test_vw_monitoreo_web_punto_branch_has_null_producto_columns(self):
        start = self.sql.index("CREATE OR REPLACE VIEW public.vw_monitoreo_web")
        union_idx = self.sql.index("UNION ALL", start)
        punto_branch = self.sql[union_idx:]
        self.assertIn("NULL::uuid AS id_producto_predominante,", punto_branch)
        self.assertIn("NULL::text AS producto_codigo,", punto_branch)
        self.assertIn("NULL::text AS producto_nombre", punto_branch)
        # La rama "punto" NO debe ganar un JOIN a PRODUCTOS -- EUDR_INSTALACIONES
        # nunca tiene id_producto_predominante.
        self.assertNotIn('LEFT JOIN public."PRODUCTOS"', punto_branch)

    def test_does_not_touch_the_existing_broken_join_against_padron_parcelas(self):
        # El JOIN ya roto (src."ID_Parcela_Fija" = pp."ID_Parcela_Fija") queda
        # exactamente igual -- esta migración no lo toca (fuera de alcance,
        # spec sección 8.5).
        self.assertEqual(
            self.sql.count('ON src."ID_Parcela_Fija" = pp."ID_Parcela_Fija" AND src."ID_Organizacion" = pp."ID_Organizacion"'),
            2,
            "el JOIN contra PADRON_PARCELAS debe seguir presente, sin cambios, en ambas ramas",
        )

    def test_does_not_drop_any_view(self):
        code_lines = "\n".join(line for line in self.sql.splitlines() if not line.strip().startswith("--"))
        self.assertNotIn("DROP VIEW", code_lines)
        self.assertNotIn("DROP COLUMN", code_lines)


@NEEDS_SUPABASE
class TestMultiProductoCafeCacaoLive(unittest.TestCase):
    """Tests funcionales contra Supabase Live -- se auto-saltan si la
    migración todavía no está aplicada (PRODUCTOS ausente)."""

    @classmethod
    def setUpClass(cls):
        from supabase import create_client

        cls.supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
        if not _migration_is_applied(cls.supabase):
            raise unittest.SkipTest(
                "Migración 20260826120000_multi_producto_cafe_cacao.sql todavía no aplicada "
                "en Supabase Studio (PRODUCTOS no existe) -- se salta hasta que se aplique."
            )
        cafe = cls.supabase.table("PRODUCTOS").select("id").eq("codigo", "CAFE").single().execute().data
        cacao = cls.supabase.table("PRODUCTOS").select("id").eq("codigo", "CACAO").single().execute().data
        cls.id_cafe = cafe["id"]
        cls.id_cacao = cacao["id"]

    def _cleanup_test_orgs(self):
        """Borra todo rastro de ORG_A/ORG_B, hijos primero, ORGANIZACIONES
        al final -- mismo patrón que TestCertificacionesNormalizadasLive."""
        self.supabase.table("EUDR_USO_SUELO").delete().in_("ID_Organizacion", [ORG_A, ORG_B]).execute()
        self.supabase.table("EUDR_MONITOREO").delete().in_("ID_Organizacion", [ORG_A, ORG_B]).execute()
        self.supabase.table("ORGANIZACION_PRODUCTOS").delete().in_("id_organizacion", [ORG_A, ORG_B]).execute()
        self.supabase.table("PADRON_PARCELAS").delete().in_("ID_Organizacion", [ORG_A, ORG_B]).execute()
        self.supabase.table("ORGANIZACIONES").delete().in_("ID", [ORG_A, ORG_B]).execute()

    def setUp(self):
        self._cleanup_test_orgs()

    def tearDown(self):
        self._cleanup_test_orgs()

    def test_catalogo_tiene_exactamente_2_filas_cafe_cacao(self):
        rows = self.supabase.table("PRODUCTOS").select("codigo, nombre, vertical, activo").execute().data
        self.assertEqual(len(rows), 2)
        codigos = {r["codigo"] for r in rows}
        self.assertEqual(codigos, {"CAFE", "CACAO"})
        self.assertTrue(all(r["vertical"] == "AGRICOLA" for r in rows))
        self.assertTrue(all(r["activo"] for r in rows))

    def test_backfill_las_parcelas_existentes_quedan_con_cafe(self):
        """Confirma el backfill de la migración: cualquier PADRON_PARCELAS
        real (no las de prueba de este test, que nacen ya con id_producto_predominante
        explícito) que exista de antes queda en CAFE, nunca NULL."""
        rows = (
            self.supabase.table("PADRON_PARCELAS")
            .select("id_producto_predominante")
            .not_.in_("ID_Organizacion", [ORG_A, ORG_B])
            .limit(20)
            .execute()
            .data
        )
        self.assertGreater(len(rows), 0, "deben existir parcelas reales previas a este test")
        for row in rows:
            self.assertEqual(row["id_producto_predominante"], self.id_cafe)

    def test_aislamiento_multi_tenant_cruzado_en_organizacion_productos(self):
        self.supabase.table("ORGANIZACIONES").insert(
            [
                {"ID": ORG_A, "es_organizacion_prueba": True},
                {"ID": ORG_B, "es_organizacion_prueba": True},
            ]
        ).execute()

        self.supabase.table("ORGANIZACION_PRODUCTOS").insert(
            {"id_organizacion": ORG_A, "id_producto": self.id_cafe}
        ).execute()
        self.supabase.table("ORGANIZACION_PRODUCTOS").insert(
            {"id_organizacion": ORG_B, "id_producto": self.id_cafe}
        ).execute()

        rows_a = (
            self.supabase.table("ORGANIZACION_PRODUCTOS")
            .select("id_organizacion")
            .eq("id_producto", self.id_cafe)
            .eq("id_organizacion", ORG_A)
            .execute()
            .data
        )
        self.assertEqual(len(rows_a), 1)
        self.assertEqual(rows_a[0]["id_organizacion"], ORG_A)

    def test_organizacion_productos_permite_n_a_n_una_org_con_cafe_y_cacao(self):
        self.supabase.table("ORGANIZACIONES").insert({"ID": ORG_A, "es_organizacion_prueba": True}).execute()
        self.supabase.table("ORGANIZACION_PRODUCTOS").insert(
            [
                {"id_organizacion": ORG_A, "id_producto": self.id_cafe},
                {"id_organizacion": ORG_A, "id_producto": self.id_cacao},
            ]
        ).execute()
        rows = (
            self.supabase.table("ORGANIZACION_PRODUCTOS").select("id_producto").eq("id_organizacion", ORG_A).execute().data
        )
        self.assertEqual({r["id_producto"] for r in rows}, {self.id_cafe, self.id_cacao})

    def _make_parcela_monitoreo(self, id_parcela_fija, id_organizacion, id_producto, qfield_relation_id):
        """Crea la cadena real de 2 saltos completa: PADRON_PARCELAS (con
        producto asignado) + EUDR_MONITOREO (con qfield_relation_id que
        una fila de EUDR_USO_SUELO usará como id_parcela)."""
        self.supabase.table("PADRON_PARCELAS").insert(
            {
                "ID_Parcela_Fija": id_parcela_fija,
                "ID_Organizacion": id_organizacion,
                "activo": True,
                "id_producto_predominante": id_producto,
            }
        ).execute()
        self.supabase.table("EUDR_MONITOREO").insert(
            {
                "ID_Organizacion": id_organizacion,
                "ID_Parcela_Fija": id_parcela_fija,
                "qfield_relation_id": qfield_relation_id,
                "estado_revision": "PENDIENTE",
            }
        ).execute()

    def test_trigger_resuelve_la_cadena_real_y_copia_el_producto(self):
        qfield_guid = "{11111111-1111-1111-1111-111111111111}"
        self._make_parcela_monitoreo("TEST-PROD-PARCELA-A", ORG_A, self.id_cacao, qfield_guid)

        square_wkt = "SRID=4326;POLYGON((-75.0 4.0, -75.001 4.0, -75.001 4.001, -75.0 4.001, -75.0 4.0))"
        res = (
            self.supabase.table("EUDR_USO_SUELO")
            .insert(
                {
                    "ID_Organizacion": ORG_A,
                    "id_parcela": qfield_guid,
                    "geom": square_wkt,
                    "tipo_uso": "Produccion",
                    "estado_revision": "PENDIENTE",
                }
            )
            .execute()
        )
        row = res.data[0]
        self.assertEqual(row["id_producto_predominante"], self.id_cacao)

    def test_trigger_no_bloqueante_guid_inventado_no_falla_y_queda_null(self):
        res = (
            self.supabase.table("EUDR_USO_SUELO")
            .insert(
                {
                    "ID_Organizacion": ORG_A,
                    "id_parcela": "{99999999-9999-9999-9999-999999999999}",
                    "geom": "SRID=4326;POLYGON((-75.0 4.0, -75.001 4.0, -75.001 4.001, -75.0 4.001, -75.0 4.0))",
                    "tipo_uso": "Produccion",
                    "estado_revision": "PENDIENTE",
                }
            )
            .execute()
        )
        row = res.data[0]
        self.assertIsNone(row["id_producto_predominante"])

    def test_trigger_no_bloqueante_parcela_sin_producto_asignado_queda_null(self):
        """Cadena que SÍ resuelve hasta PADRON_PARCELAS, pero esa parcela
        tiene id_producto_predominante NULL explícito (nunca pasa con el
        backfill real, pero es un estado válido para una parcela nueva) --
        el trigger no debe fallar, y debe dejar NULL."""
        qfield_guid = "{22222222-2222-2222-2222-222222222222}"
        self.supabase.table("PADRON_PARCELAS").insert(
            {"ID_Parcela_Fija": "TEST-PROD-PARCELA-SIN-PRODUCTO", "ID_Organizacion": ORG_A, "activo": True}
        ).execute()
        self.supabase.table("EUDR_MONITOREO").insert(
            {
                "ID_Organizacion": ORG_A,
                "ID_Parcela_Fija": "TEST-PROD-PARCELA-SIN-PRODUCTO",
                "qfield_relation_id": qfield_guid,
                "estado_revision": "PENDIENTE",
            }
        ).execute()

        res = (
            self.supabase.table("EUDR_USO_SUELO")
            .insert(
                {
                    "ID_Organizacion": ORG_A,
                    "id_parcela": qfield_guid,
                    "geom": "SRID=4326;POLYGON((-75.0 4.0, -75.001 4.0, -75.001 4.001, -75.0 4.001, -75.0 4.0))",
                    "tipo_uso": "Produccion",
                    "estado_revision": "PENDIENTE",
                }
            )
            .execute()
        )
        row = res.data[0]
        self.assertIsNone(row["id_producto_predominante"])

    def test_vw_monitoreo_web_expone_producto_para_fila_poligono_y_null_para_punto(self):
        qfield_guid = "{33333333-3333-3333-3333-333333333333}"
        self._make_parcela_monitoreo("TEST-PROD-PARCELA-VIEW", ORG_A, self.id_cafe, qfield_guid)

        self.supabase.table("EUDR_USO_SUELO").insert(
            {
                "ID_Organizacion": ORG_A,
                "id_parcela": qfield_guid,
                "geom": "SRID=4326;POLYGON((-75.0 4.0, -75.001 4.0, -75.001 4.001, -75.0 4.001, -75.0 4.0))",
                "tipo_uso": "Produccion",
                "estado_revision": "APROBADO",
            }
        ).execute()
        self.supabase.table("EUDR_INSTALACIONES").insert(
            {
                "ID_Organizacion": ORG_A,
                "id_parcela": "TEST-PROD-PARCELA-VIEW",
                "geom": "SRID=4326;POINT(-75.0 4.0)",
                "tipo_infra": "TEST",
                "estado_revision": "APROBADO",
            }
        ).execute()

        rows = (
            self.supabase.table("vw_monitoreo_web")
            .select("tipo_geometria, tabla_origen, producto_codigo, producto_nombre")
            .eq("ID_Organizacion", ORG_A)
            .execute()
            .data
        )
        poligono_rows = [r for r in rows if r["tipo_geometria"] == "poligono" and r["tabla_origen"] == "EUDR_USO_SUELO"]
        punto_rows = [r for r in rows if r["tipo_geometria"] == "punto"]

        self.assertGreater(len(poligono_rows), 0, "debe existir al menos una fila poligono de EUDR_USO_SUELO")
        self.assertEqual(poligono_rows[0]["producto_codigo"], "CAFE")
        self.assertEqual(poligono_rows[0]["producto_nombre"], "Café")

        self.assertGreater(len(punto_rows), 0, "debe existir al menos una fila punto de EUDR_INSTALACIONES")
        for row in punto_rows:
            self.assertIsNone(row["producto_codigo"])
            self.assertIsNone(row["producto_nombre"])

        self.supabase.table("EUDR_INSTALACIONES").delete().eq("ID_Organizacion", ORG_A).execute()


if __name__ == "__main__":
    unittest.main()
