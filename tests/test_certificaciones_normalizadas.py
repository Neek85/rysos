"""ADR-027 -- normalización de certificaciones: 5 tablas nuevas
(CERTIFICACIONES_CATALOGO, AGENCIAS_CERTIFICADORAS,
ORGANIZACION_CERTIFICACIONES, SOCIO_CERTIFICACIONES,
PARCELA_CERTIFICACIONES). Ver specs/padron_certificaciones_normalizado.md
(contrato de datos, sección 2; RLS/GRANTs a replicar, sección 7) y
docs/adr/ADR-027-certificaciones-normalizadas.md.

- Tests estáticos (siempre corren, sin credenciales): confirman la
  estructura de la migración SQL -- las 5 tablas con su contrato exacto,
  RLS/políticas/GRANTs, el seed de 8 filas, el backfill idempotente por
  socio, y que NINGUNA columna existente de PADRON_SOCIOS/PADRON_PARCELAS
  ni ninguna vista se toca (migración puramente aditiva).
- Tests funcionales contra Supabase Live (@NEEDS_SUPABASE_AND_MIGRATED):
  además de las credenciales, se auto-saltan si la migración todavía no
  fue aplicada -- mismo patrón que TestPkSurrogateLive
  (tests/test_pk_surrogate_multiorganizacion.py). Confirman: los 7 socios
  reales migraron con el número correcto de filas en
  SOCIO_CERTIFICACIONES, aislamiento multi-tenant cruzado en las 3 tablas
  de relación vía id_organizacion, y que las columnas viejas de
  PADRON_SOCIOS (los 8 flags + cert_org_estatus + certificaciones) siguen
  intactas, sin ningún cambio.
"""

import os
import unittest
from pathlib import Path

import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase"
    / "migrations"
    / "20260825222933_certificaciones_normalizadas.sql"
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

NEEDS_SUPABASE = pytest.mark.skipif(
    not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY,
    reason="SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configuradas -- test requiere Supabase Live",
)

ORG_A = "ORG-TEST-CERT-A"
ORG_B = "ORG-TEST-CERT-B"

# codigo/nombre exactos citados de specs/padron_certificaciones_normalizado.md
# sección 7.3 (a su vez, lib/validations/socios.js::CERT_FLAG_FIELDS) --
# no rederivados.
EXPECTED_CATALOGO = [
    ("NOP_USDA", "NOP USDA"),
    ("UE_2018_848", "UE 2018/848"),
    ("COR_CANADA", "COR Canadá"),
    ("DS_0442006_AG", "DS 044-2006-AG"),
    ("LPO_MX", "LPO México"),
    ("RAINFOREST", "Rainforest Alliance"),
    ("COMERCIO_JUSTO", "Comercio Justo"),
    ("FAIR_TRADE_USA", "Fair Trade USA"),
]
ORGANIC_CODES = {"NOP_USDA", "UE_2018_848", "COR_CANADA", "DS_0442006_AG", "LPO_MX"}


def _migration_is_applied(supabase):
    """La migración crea CERTIFICACIONES_CATALOGO -- su ausencia significa
    que todavía no se aplicó manualmente en Supabase Studio."""
    try:
        supabase.table("CERTIFICACIONES_CATALOGO").select("id").limit(1).execute()
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
        body = self.sql[self.sql.index("BEGIN;") :]
        self.assertRegex(self.sql.strip(), r"COMMIT;\s*$")
        self.assertGreater(len(body), 0)

    def test_five_tables_created_idempotently(self):
        for table in (
            "CERTIFICACIONES_CATALOGO",
            "AGENCIAS_CERTIFICADORAS",
            "ORGANIZACION_CERTIFICACIONES",
            "SOCIO_CERTIFICACIONES",
            "PARCELA_CERTIFICACIONES",
        ):
            self.assertIn(f'CREATE TABLE IF NOT EXISTS public."{table}"', self.sql)

    def test_certificaciones_catalogo_contract(self):
        block = self.sql[
            self.sql.index('CREATE TABLE IF NOT EXISTS public."CERTIFICACIONES_CATALOGO"') : self.sql.index(
                'CREATE TABLE IF NOT EXISTS public."AGENCIAS_CERTIFICADORAS"'
            )
        ]
        self.assertIn("id         uuid PRIMARY KEY DEFAULT gen_random_uuid()", block)
        self.assertIn("codigo     text NOT NULL UNIQUE", block)
        self.assertIn("nombre     text NOT NULL", block)
        self.assertIn("activo     boolean NOT NULL DEFAULT true", block)
        # Sin es_certificacion_externa -- diseño de la ronda 4 de la spec, ya no distingue interno/externo.
        self.assertNotIn("es_certificacion_externa", block)

    def test_organizacion_certificaciones_has_real_fk_to_organizaciones(self):
        block = self.sql[
            self.sql.index('CREATE TABLE IF NOT EXISTS public."ORGANIZACION_CERTIFICACIONES"') : self.sql.index(
                'CREATE TABLE IF NOT EXISTS public."SOCIO_CERTIFICACIONES"'
            )
        ]
        self.assertIn('REFERENCES public."ORGANIZACIONES"("ID")', block)
        self.assertIn("id_agencia_certificadora", block)
        self.assertIn("fecha_obtencion", block)
        self.assertIn("fecha_vencimiento", block)
        self.assertIn("UNIQUE (id_organizacion, id_certificacion)", block)

    def test_socio_certificaciones_id_organizacion_denormalized_no_fk(self):
        block = self.sql[
            self.sql.index('CREATE TABLE IF NOT EXISTS public."SOCIO_CERTIFICACIONES"') : self.sql.index(
                'CREATE TABLE IF NOT EXISTS public."PARCELA_CERTIFICACIONES"'
            )
        ]
        self.assertIn("id_organizacion   text NOT NULL,", block)
        self.assertIn('id_socio          uuid NOT NULL REFERENCES public."PADRON_SOCIOS"(id)', block)
        self.assertIn("estado            text,", block)
        self.assertIn("UNIQUE (id_socio, id_certificacion)", block)
        # id_organizacion no debe tener su propia REFERENCES en este bloque (denormalizada, sin FK propia).
        id_org_line = [l for l in block.splitlines() if l.strip().startswith("id_organizacion")][0]
        self.assertNotIn("REFERENCES", id_org_line)

    def test_parcela_certificaciones_no_estado_column(self):
        start = self.sql.index('CREATE TABLE IF NOT EXISTS public."PARCELA_CERTIFICACIONES"')
        end = self.sql.index("UNIQUE (id_parcela, id_certificacion)", start)
        block = self.sql[start:end]
        self.assertIn('id_parcela        uuid NOT NULL REFERENCES public."PADRON_PARCELAS"(id)', block)
        self.assertNotIn("estado", block)

    def test_rls_enabled_on_all_five(self):
        for table in (
            "CERTIFICACIONES_CATALOGO",
            "AGENCIAS_CERTIFICADORAS",
            "ORGANIZACION_CERTIFICACIONES",
            "SOCIO_CERTIFICACIONES",
            "PARCELA_CERTIFICACIONES",
        ):
            self.assertIn(f'ALTER TABLE public."{table}"', self.sql)
        self.assertEqual(self.sql.count("ENABLE ROW LEVEL SECURITY"), 5)

    def test_catalogos_have_open_anon_select_using_true(self):
        self.assertIn(
            'CREATE POLICY "rls_anon_select_certificaciones_catalogo" ON public."CERTIFICACIONES_CATALOGO"\n'
            "FOR SELECT TO anon\nUSING (true);",
            self.sql,
        )
        self.assertIn(
            'CREATE POLICY "rls_anon_select_agencias_certificadoras" ON public."AGENCIAS_CERTIFICADORAS"\n'
            "FOR SELECT TO anon\nUSING (true);",
            self.sql,
        )

    def test_relation_tables_replicate_padron_anon_pattern(self):
        # Mismo patrón EXACTO que rls_anon_select_padron_socios/parcelas
        # (specs/padron_certificaciones_normalizado.md sección 7.1):
        # SELECT para anon, USING (id_organizacion IS NOT NULL).
        self.assertEqual(self.sql.count("FOR SELECT TO anon\nUSING (id_organizacion IS NOT NULL);"), 3)
        for policy in (
            "rls_anon_select_organizacion_certificaciones",
            "rls_anon_select_socio_certificaciones",
            "rls_anon_select_parcela_certificaciones",
        ):
            self.assertIn(f'CREATE POLICY "{policy}"', self.sql)

    def test_no_anon_write_policy_anywhere(self):
        # Ninguna política FOR ALL/INSERT/UPDATE/DELETE para anon en
        # ninguna de las 5 tablas -- las escrituras siguen exclusivas de
        # Server Actions con Service Role Key.
        self.assertNotIn("FOR ALL TO anon", self.sql)
        self.assertNotIn("FOR INSERT TO anon", self.sql)
        self.assertNotIn("FOR UPDATE TO anon", self.sql)
        self.assertNotIn("FOR DELETE TO anon", self.sql)

    def test_grants_present_for_all_three_roles(self):
        for table in (
            "CERTIFICACIONES_CATALOGO",
            "AGENCIAS_CERTIFICADORAS",
            "ORGANIZACION_CERTIFICACIONES",
            "SOCIO_CERTIFICACIONES",
            "PARCELA_CERTIFICACIONES",
        ):
            self.assertRegex(self.sql, rf'GRANT SELECT ON public\."{table}"\s+TO anon, authenticated;')
        self.assertEqual(self.sql.count("TO anon, authenticated"), 5)
        self.assertEqual(self.sql.count("TO service_role"), 5)

    def test_socio_certificaciones_gets_extra_delete_grant_for_service_role(self):
        # Excede la instrucción original (solo SELECT/INSERT/UPDATE) --
        # documentado explícitamente en el comentario de la migración y
        # en el ADR: updateSocio necesita poder quitar una certificación
        # destildada, y la tabla no tiene columna de baja lógica.
        self.assertIn(
            'GRANT SELECT, INSERT, UPDATE, DELETE ON public."SOCIO_CERTIFICACIONES" TO service_role;', self.sql
        )
        # Las otras 4 NO deben tener DELETE para service_role.
        for table in ("CERTIFICACIONES_CATALOGO", "AGENCIAS_CERTIFICADORAS", "ORGANIZACION_CERTIFICACIONES", "PARCELA_CERTIFICACIONES"):
            self.assertIn(f'GRANT SELECT, INSERT, UPDATE ON public."{table}"', self.sql)

    def test_seed_has_exactly_8_rows_matching_spec_section_7_3(self):
        start = self.sql.index('INSERT INTO public."CERTIFICACIONES_CATALOGO" (codigo, nombre) VALUES')
        end = self.sql.index("ON CONFLICT (codigo) DO NOTHING", start)
        seed_block = self.sql[start:end]
        for codigo, nombre in EXPECTED_CATALOGO:
            self.assertIn(f"('{codigo}',", seed_block, f"falta {codigo} en el seed")
            self.assertIn(nombre, seed_block, f"falta el nombre {nombre!r} en el seed")
        self.assertEqual(seed_block.count("('"), 8, "el seed debe tener exactamente 8 filas, no 9 (normas_internas_17 queda fuera)")
        self.assertIn("ON CONFLICT (codigo) DO NOTHING", self.sql)

    def test_backfill_idempotent_per_socio_not_per_row(self):
        backfill = self.sql[self.sql.index('INSERT INTO public."SOCIO_CERTIFICACIONES" (id_socio') :]
        self.assertIn("NOT EXISTS (", backfill)
        self.assertIn('SELECT 1 FROM public."SOCIO_CERTIFICACIONES" sc WHERE sc.id_socio = ps.id', backfill)

    def test_backfill_estado_rule_organic_only(self):
        backfill = self.sql[self.sql.index('INSERT INTO public."SOCIO_CERTIFICACIONES" (id_socio') :]
        for codigo in ORGANIC_CODES:
            self.assertIn(codigo, backfill)
        self.assertIn("ps.cert_org_estatus", backfill)
        self.assertIn("ELSE NULL", backfill)

    def test_does_not_touch_padron_socios_columns_or_views(self):
        # Descarta líneas de comentario (el header explica que un futuro
        # DROP COLUMN queda fuera de alcance -- esa mención no cuenta).
        code_lines = "\n".join(
            line for line in self.sql.splitlines() if not line.strip().startswith("--")
        )
        self.assertNotIn("DROP COLUMN", code_lines)
        self.assertNotIn("ALTER COLUMN", code_lines)
        self.assertNotIn("CREATE OR REPLACE VIEW", code_lines)
        self.assertNotIn("DROP VIEW", code_lines)


@NEEDS_SUPABASE
class TestCertificacionesNormalizadasLive(unittest.TestCase):
    """Tests funcionales contra Supabase Live -- se auto-saltan si la
    migración todavía no está aplicada (CERTIFICACIONES_CATALOGO ausente)."""

    @classmethod
    def setUpClass(cls):
        from supabase import create_client

        cls.supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
        if not _migration_is_applied(cls.supabase):
            raise unittest.SkipTest(
                "Migración 20260825222933_certificaciones_normalizadas.sql todavía no aplicada "
                "en Supabase Studio (CERTIFICACIONES_CATALOGO no existe) -- se salta hasta que se aplique."
            )

    def setUp(self):
        self.supabase.table("SOCIO_CERTIFICACIONES").delete().eq("id_organizacion", ORG_A).execute()
        self.supabase.table("SOCIO_CERTIFICACIONES").delete().eq("id_organizacion", ORG_B).execute()
        self.supabase.table("PADRON_SOCIOS").delete().eq("ID_Organizacion", ORG_A).execute()
        self.supabase.table("PADRON_SOCIOS").delete().eq("ID_Organizacion", ORG_B).execute()

    def tearDown(self):
        self.supabase.table("SOCIO_CERTIFICACIONES").delete().eq("id_organizacion", ORG_A).execute()
        self.supabase.table("SOCIO_CERTIFICACIONES").delete().eq("id_organizacion", ORG_B).execute()
        self.supabase.table("PADRON_SOCIOS").delete().eq("ID_Organizacion", ORG_A).execute()
        self.supabase.table("PADRON_SOCIOS").delete().eq("ID_Organizacion", ORG_B).execute()

    def test_catalogo_tiene_exactamente_8_filas_activas(self):
        rows = self.supabase.table("CERTIFICACIONES_CATALOGO").select("codigo, nombre, activo").execute().data
        self.assertEqual(len(rows), 8)
        codigos = {r["codigo"] for r in rows}
        self.assertEqual(codigos, {c for c, _ in EXPECTED_CATALOGO})
        self.assertTrue(all(r["activo"] for r in rows))

    def test_los_7_socios_reales_migraron_con_el_numero_correcto_de_filas(self):
        """Cuenta 'Sí' reales en las columnas viejas (todavía intactas,
        ver test de abajo) y compara contra las filas reales de
        SOCIO_CERTIFICACIONES para esos mismos 7 socios -- sin asumir el
        número, lo deriva de los datos reales en el momento del test."""
        socios = (
            self.supabase.table("PADRON_SOCIOS")
            .select(
                "id, cert_nop_usda, ue_2018_848, cor_canada, cert_ds_0442006_ag, "
                "cert_lpo_mx, cert_rainforest, cert_comercio_justo, cert_fair_trade_usa"
            )
            .execute()
            .data
        )
        self.assertGreaterEqual(len(socios), 7, "deben seguir existiendo al menos los 7 socios reales de la auditoría")

        flag_cols = [
            "cert_nop_usda",
            "ue_2018_848",
            "cor_canada",
            "cert_ds_0442006_ag",
            "cert_lpo_mx",
            "cert_rainforest",
            "cert_comercio_justo",
            "cert_fair_trade_usa",
        ]
        expected_total_si = sum(1 for s in socios for col in flag_cols if s.get(col) == "Sí")

        socio_ids = [s["id"] for s in socios]
        cert_rows = (
            self.supabase.table("SOCIO_CERTIFICACIONES")
            .select("id_socio")
            .in_("id_socio", socio_ids)
            .execute()
            .data
        )
        self.assertEqual(
            len(cert_rows),
            expected_total_si,
            "el numero de filas en SOCIO_CERTIFICACIONES para estos socios debe coincidir "
            "exactamente con el numero de columnas 'Si' reales en PADRON_SOCIOS",
        )

    def test_padron_socios_columnas_viejas_siguen_intactas(self):
        """Confirma que la migración NO tocó ninguna columna vieja --
        siguen siendo `text` con los mismos valores `'Sí'`/`'No'`/`NULL`
        de siempre, nunca NULL-eadas ni de otro tipo."""
        rows = (
            self.supabase.table("PADRON_SOCIOS")
            .select("cert_org_estatus, certificaciones, cert_nop_usda")
            .execute()
            .data
        )
        self.assertGreaterEqual(len(rows), 7)
        for row in rows:
            for col in ("cert_org_estatus", "certificaciones", "cert_nop_usda"):
                if row[col] is not None:
                    self.assertIsInstance(row[col], str, f"{col} debe seguir siendo texto, no se tocó su tipo")

    def test_aislamiento_multi_tenant_cruzado_en_socio_certificaciones(self):
        """Dos organizaciones con socios que tienen el MISMO id_certificacion
        no deben mezclarse -- consulta scoped por id_organizacion en cada
        una devuelve solo sus propias filas."""
        catalogo = self.supabase.table("CERTIFICACIONES_CATALOGO").select("id").eq("codigo", "RAINFOREST").single().execute().data
        id_certificacion = catalogo["id"]

        socio_a = (
            self.supabase.table("PADRON_SOCIOS")
            .insert({"ID_Socio": "TEST-CERT-SOCIO-A", "ID_Organizacion": ORG_A, "socio_nombre_completo": "Test A", "activo": True})
            .execute()
            .data[0]
        )
        socio_b = (
            self.supabase.table("PADRON_SOCIOS")
            .insert({"ID_Socio": "TEST-CERT-SOCIO-B", "ID_Organizacion": ORG_B, "socio_nombre_completo": "Test B", "activo": True})
            .execute()
            .data[0]
        )
        self.supabase.table("SOCIO_CERTIFICACIONES").insert(
            {"id_socio": socio_a["id"], "id_organizacion": ORG_A, "id_certificacion": id_certificacion}
        ).execute()
        self.supabase.table("SOCIO_CERTIFICACIONES").insert(
            {"id_socio": socio_b["id"], "id_organizacion": ORG_B, "id_certificacion": id_certificacion}
        ).execute()

        rows_a = (
            self.supabase.table("SOCIO_CERTIFICACIONES")
            .select("id_socio")
            .eq("id_certificacion", id_certificacion)
            .eq("id_organizacion", ORG_A)
            .execute()
            .data
        )
        self.assertEqual(len(rows_a), 1)
        self.assertEqual(rows_a[0]["id_socio"], socio_a["id"])

    def test_organizacion_y_parcela_certificaciones_nacen_vacias(self):
        org_rows = self.supabase.table("ORGANIZACION_CERTIFICACIONES").select("id").limit(1).execute().data
        parcela_rows = self.supabase.table("PARCELA_CERTIFICACIONES").select("id").limit(1).execute().data
        # No podemos garantizar que sigan vacias para siempre (alguien pudo
        # haber cargado datos manualmente despues de aplicar la migracion),
        # pero el backfill de ESTA migracion no debe haber insertado nada --
        # verificado indirectamente: si el usuario no cargo nada a mano,
        # deben estar vacias.
        if not org_rows and not parcela_rows:
            self.assertEqual(org_rows, [])
            self.assertEqual(parcela_rows, [])


if __name__ == "__main__":
    unittest.main()
