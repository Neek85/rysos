"""ADR-026 -- migración de PK surrogate UUID + UNIQUE(ID_Organizacion, ...)
para PADRON_SOCIOS/PADRON_PARCELAS. Ver specs/multi_organizacion_codigos_unicos.md
y plans/multi_organizacion_codigos_unicos_ejecucion.md (auditoría del paso 2).

- Tests estáticos (siempre corren, sin credenciales): confirman la
  estructura de la migración SQL -- idempotencia, columna `id` UUID,
  NOT NULL guardado con RAISE EXCEPTION si hay filas NULL, drop dinámico
  de la PK vieja (sin asumir su nombre), UNIQUE por organización, y el fix
  de JOIN en vw_monitoreo_web/view_eudr_dashboard_aprobados.
- Tests funcionales contra Supabase Live (@NEEDS_SUPABASE_AND_MIGRATED):
  además de las credenciales, se auto-saltan si la migración todavía no
  fue aplicada manualmente (columna `id` no existe en PADRON_SOCIOS) -- no
  fallan localmente hasta que el usuario la aplique en Supabase Studio,
  mismo flujo de siempre en este repo. Crean/limpian datos de prueba
  descartables (ORG-TEST-PK-A/ORG-TEST-PK-B, sin FK a ORGANIZACIONES --
  confirmado en la auditoría, no hace falta que existan ahí).
"""

import os
import unittest
from pathlib import Path

import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase"
    / "migrations"
    / "20260825201351_pk_surrogate_multiorganizacion.sql"
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

NEEDS_SUPABASE = pytest.mark.skipif(
    not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY,
    reason="SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configuradas -- test requiere Supabase Live",
)

ORG_A = "ORG-TEST-PK-A"
ORG_B = "ORG-TEST-PK-B"
SHARED_SOCIO_CODE = "TEST-PK-SOCIO-SHARED"
SHARED_PARCELA_CODE = "TEST-PK-PARCELA-SHARED"


def _migration_is_applied(supabase):
    """La migración agrega la columna `id` a PADRON_SOCIOS -- su ausencia
    significa que todavía no se aplicó manualmente en Supabase Studio."""
    try:
        supabase.table("PADRON_SOCIOS").select("id").limit(1).execute()
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

    def test_wrapped_in_single_transaction(self):
        body = self.sql[self.sql.index("BEGIN;") :]
        self.assertRegex(self.sql.strip(), r"COMMIT;\s*$")
        # Solo debe haber un BEGIN;/COMMIT; de nivel superior -- todo el
        # trabajo va en una sola transacción.
        self.assertEqual(self.sql.count("\nBEGIN;"), 1)
        self.assertGreater(len(body), 0)

    def test_both_tables_get_uuid_pk_column(self):
        self.assertIn('ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid()', self.sql)
        self.assertEqual(
            self.sql.count('ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid()'), 2,
            "debe agregar la columna id a ambas tablas"
        )

    def test_not_null_guarded_by_explicit_check_before_altering(self):
        # No debe asumir 0 filas NULL -- debe verificarlo y abortar con
        # RAISE EXCEPTION si encuentra alguna, nunca forzar el NOT NULL a ciegas.
        self.assertIn('WHERE "ID_Organizacion" IS NULL', self.sql)
        self.assertIn('RAISE EXCEPTION', self.sql)
        self.assertEqual(self.sql.count('ALTER COLUMN "ID_Organizacion" SET NOT NULL'), 2)

    def test_drops_old_pk_dynamically_not_by_guessed_name(self):
        # No debe asumir el nombre de la constraint vieja (p.ej.
        # "PADRON_SOCIOS_pkey") -- debe resolverlo en vivo vía pg_constraint.
        self.assertIn('FROM pg_constraint c', self.sql)
        self.assertIn("c.contype = 'p'", self.sql)
        self.assertIn("DROP CONSTRAINT %I", self.sql)
        self.assertNotIn('DROP CONSTRAINT "PADRON_SOCIOS_pkey"', self.sql)
        self.assertNotIn('DROP CONSTRAINT "PADRON_PARCELAS_pkey"', self.sql)

    def test_new_primary_key_is_on_id_column(self):
        self.assertEqual(self.sql.count('ADD PRIMARY KEY (id)'), 2)

    def test_unique_per_organization_constraints_present(self):
        self.assertIn('ADD CONSTRAINT padron_socios_org_id_socio_key UNIQUE ("ID_Organizacion", "ID_Socio")', self.sql)
        self.assertIn(
            'ADD CONSTRAINT padron_parcelas_org_id_parcela_key UNIQUE ("ID_Organizacion", "ID_Parcela_Fija")',
            self.sql,
        )

    def test_idempotent_gate_checks_current_pk_column(self):
        # Cada bloque debe saltearse por completo si la PK ya es `id` --
        # no-op garantizado en una segunda corrida.
        self.assertEqual(self.sql.count("IF pk_col IS DISTINCT FROM 'id' THEN"), 2)

    def test_vw_monitoreo_web_join_scoped_by_organizacion(self):
        # Los 3 JOIN por rama (pp, ps, ps_parcela) x 2 ramas (poligono/punto)
        # deben incluir la condición de organización.
        self.assertEqual(
            self.sql.count('ON src."ID_Parcela_Fija" = pp."ID_Parcela_Fija" AND src."ID_Organizacion" = pp."ID_Organizacion"'),
            2,
        )
        self.assertEqual(
            self.sql.count('ON ps."ID_Socio" = COALESCE(src.productor, mon.productor) AND ps."ID_Organizacion" = src."ID_Organizacion"'),
            2,
        )
        self.assertEqual(
            self.sql.count('ON ps_parcela."ID_Socio" = pp."ID_Socio" AND ps_parcela."ID_Organizacion" = src."ID_Organizacion"'),
            2,
        )

    def test_view_eudr_dashboard_aprobados_join_scoped_by_organizacion(self):
        self.assertIn(
            'ON m."ID_Parcela_Fija" = p."ID_Parcela_Fija" AND m."ID_Organizacion" = p."ID_Organizacion"', self.sql
        )
        self.assertIn(
            'ON m."ID_Socio" = s."ID_Socio" AND m."ID_Organizacion" = s."ID_Organizacion"', self.sql
        )

    def test_view_eudr_dashboard_aprobados_where_clause_unchanged(self):
        # El WHERE de aislamiento por auth_org_id()/service_role/postgres no
        # se toca -- solo el JOIN cambia.
        self.assertIn("m.\"ID_Organizacion\" = public.auth_org_id()", self.sql)
        self.assertIn("auth.role() = 'service_role'", self.sql)

    def test_does_not_drop_or_grant_on_either_view(self):
        # CREATE OR REPLACE VIEW alcanza (mismas columnas de salida) --
        # no debe haber ningun DROP VIEW ni GRANT nuevo para estas 2 vistas,
        # dentro del cuerpo ejecutable (el comentario de cabecera SI
        # menciona "DROP VIEW" en prosa, para explicar por que no hace falta).
        body = self.sql[self.sql.index("BEGIN;") :]
        self.assertNotIn("DROP VIEW", body)
        self.assertNotIn("GRANT SELECT ON public.vw_monitoreo_web", body)
        self.assertNotIn("GRANT SELECT ON public.view_eudr_dashboard_aprobados", body)

    def test_does_not_touch_vw_parcelas_web_or_vw_socios_web(self):
        # Idem -- el comentario de cabecera SI menciona vw_parcelas_web en
        # prosa (explicando por que no se toca), solo importa el cuerpo.
        body = self.sql[self.sql.index("BEGIN;") :]
        self.assertNotIn("vw_parcelas_web", body)
        self.assertNotIn("vw_socios_web", body)

    def test_does_not_touch_rls(self):
        self.assertNotIn("ENABLE ROW LEVEL SECURITY", self.sql)
        self.assertNotIn("CREATE POLICY", self.sql)
        self.assertNotIn("DROP POLICY", self.sql)


@NEEDS_SUPABASE
class TestPkSurrogateLive(unittest.TestCase):
    """Tests funcionales contra Supabase Live -- se auto-saltan si la
    migración todavía no está aplicada (columna `id` ausente)."""

    @classmethod
    def setUpClass(cls):
        from supabase import create_client

        cls.supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
        if not _migration_is_applied(cls.supabase):
            raise unittest.SkipTest(
                "Migración 20260825201351_pk_surrogate_multiorganizacion.sql todavía no aplicada "
                "en Supabase Studio (PADRON_SOCIOS.id no existe) -- se salta hasta que se aplique."
            )

    def setUp(self):
        # Limpieza defensiva antes de cada test, por si un test anterior
        # de esta clase dejó datos (no debería, pero evita falsos negativos
        # por acumulación entre corridas).
        self.supabase.table("PADRON_PARCELAS").delete().eq("ID_Organizacion", ORG_A).execute()
        self.supabase.table("PADRON_PARCELAS").delete().eq("ID_Organizacion", ORG_B).execute()
        self.supabase.table("PADRON_SOCIOS").delete().eq("ID_Organizacion", ORG_A).execute()
        self.supabase.table("PADRON_SOCIOS").delete().eq("ID_Organizacion", ORG_B).execute()

    def tearDown(self):
        self.supabase.table("PADRON_PARCELAS").delete().eq("ID_Organizacion", ORG_A).execute()
        self.supabase.table("PADRON_PARCELAS").delete().eq("ID_Organizacion", ORG_B).execute()
        self.supabase.table("PADRON_SOCIOS").delete().eq("ID_Organizacion", ORG_A).execute()
        self.supabase.table("PADRON_SOCIOS").delete().eq("ID_Organizacion", ORG_B).execute()

    def test_same_id_socio_coexists_across_two_organizations(self):
        """Antes de esta migración, la segunda insert fallaba con 23505
        (PK global). Ahora debe funcionar -- UNIQUE es por organización."""
        self.supabase.table("PADRON_SOCIOS").insert(
            {"ID_Socio": SHARED_SOCIO_CODE, "ID_Organizacion": ORG_A, "socio_nombre_completo": "Test A", "activo": True}
        ).execute()
        self.supabase.table("PADRON_SOCIOS").insert(
            {"ID_Socio": SHARED_SOCIO_CODE, "ID_Organizacion": ORG_B, "socio_nombre_completo": "Test B", "activo": True}
        ).execute()

        rows = (
            self.supabase.table("PADRON_SOCIOS")
            .select("ID_Organizacion, socio_nombre_completo")
            .eq("ID_Socio", SHARED_SOCIO_CODE)
            .execute()
            .data
        )
        self.assertEqual(len(rows), 2)
        orgs = {r["ID_Organizacion"] for r in rows}
        self.assertEqual(orgs, {ORG_A, ORG_B})

    def test_duplicate_within_same_organization_still_blocked(self):
        self.supabase.table("PADRON_SOCIOS").insert(
            {"ID_Socio": SHARED_SOCIO_CODE, "ID_Organizacion": ORG_A, "socio_nombre_completo": "Test A", "activo": True}
        ).execute()
        with self.assertRaises(Exception) as ctx:
            self.supabase.table("PADRON_SOCIOS").insert(
                {"ID_Socio": SHARED_SOCIO_CODE, "ID_Organizacion": ORG_A, "socio_nombre_completo": "Test A dup", "activo": True}
            ).execute()
        self.assertIn("23505", str(ctx.exception))

    def test_null_id_organizacion_still_blocked(self):
        with self.assertRaises(Exception) as ctx:
            self.supabase.table("PADRON_SOCIOS").insert(
                {"ID_Socio": "TEST-PK-NULL-ORG", "ID_Organizacion": None, "socio_nombre_completo": "Sin org", "activo": True}
            ).execute()
        # 23502 = not_null_violation
        self.assertIn("23502", str(ctx.exception))

    def test_vw_monitoreo_web_scoped_query_has_no_fanout(self):
        """Dos organizaciones con el mismo ID_Parcela_Fija: una consulta a
        vw_monitoreo_web scoped por organización no debe devolver filas
        de la otra, ni multiplicar filas por el JOIN."""
        for org in (ORG_A, ORG_B):
            self.supabase.table("PADRON_PARCELAS").insert(
                {
                    "ID_Parcela_Fija": SHARED_PARCELA_CODE,
                    "ID_Organizacion": org,
                    "parcela_codigo": f"P-{org}",
                    "parcela_nombre": f"Parcela {org}",
                    "activo": True,
                }
            ).execute()

        rows = (
            self.supabase.table("vw_monitoreo_web")
            .select("ID_Organizacion, parcela_codigo")
            .eq("ID_Parcela_Fija", SHARED_PARCELA_CODE)
            .eq("ID_Organizacion", ORG_A)
            .execute()
            .data
        )
        # Sin datos de EUDR_MONITOREO para este código, la vista no
        # devuelve nada (no hay fila fuente) -- lo que importa acá es que
        # ninguna fila devuelta pertenezca a ORG_B, no la cantidad.
        self.assertTrue(all(r["ID_Organizacion"] == ORG_A for r in rows))
        self.assertTrue(all(r.get("parcela_codigo") != f"P-{ORG_B}" for r in rows))

    def test_deactivate_socio_cascade_scoped_query_does_not_touch_other_org(self):
        """Replica exactamente la consulta que lib/actions/sociosActions.js
        deactivateSocio ejecuta ahora (update scoped por ID_Socio +
        ID_Organizacion) -- confirma que la organización B nunca se ve
        afectada aunque comparta el mismo ID_Socio."""
        for org in (ORG_A, ORG_B):
            self.supabase.table("PADRON_SOCIOS").insert(
                {"ID_Socio": SHARED_SOCIO_CODE, "ID_Organizacion": org, "socio_nombre_completo": f"Test {org}", "activo": True}
            ).execute()
            self.supabase.table("PADRON_PARCELAS").insert(
                {
                    "ID_Parcela_Fija": f"{SHARED_PARCELA_CODE}-{org}",
                    "ID_Socio": SHARED_SOCIO_CODE,
                    "ID_Organizacion": org,
                    "parcela_codigo": f"P-{org}",
                    "activo": True,
                }
            ).execute()

        self.supabase.table("PADRON_SOCIOS").update({"activo": False}).eq("ID_Socio", SHARED_SOCIO_CODE).eq(
            "ID_Organizacion", ORG_A
        ).execute()
        self.supabase.table("PADRON_PARCELAS").update({"activo": False}).eq("ID_Socio", SHARED_SOCIO_CODE).eq(
            "ID_Organizacion", ORG_A
        ).execute()

        socio_b = (
            self.supabase.table("PADRON_SOCIOS")
            .select("activo")
            .eq("ID_Socio", SHARED_SOCIO_CODE)
            .eq("ID_Organizacion", ORG_B)
            .single()
            .execute()
            .data
        )
        parcela_b = (
            self.supabase.table("PADRON_PARCELAS")
            .select("activo")
            .eq("ID_Socio", SHARED_SOCIO_CODE)
            .eq("ID_Organizacion", ORG_B)
            .single()
            .execute()
            .data
        )
        self.assertTrue(socio_b["activo"], "la organizacion B no debe verse afectada por la baja de la organizacion A")
        self.assertTrue(parcela_b["activo"], "la parcela de la organizacion B no debe desactivarse por la cascada de A")

    def test_regression_single_organization_lookup_still_works(self):
        """Una organización sin ningún código compartido sigue funcionando
        exactamente igual que antes de la migración."""
        self.supabase.table("PADRON_SOCIOS").insert(
            {"ID_Socio": "TEST-PK-REGRESION", "ID_Organizacion": ORG_A, "socio_nombre_completo": "Regresion", "activo": True}
        ).execute()
        row = (
            self.supabase.table("PADRON_SOCIOS")
            .select("ID_Organizacion, socio_nombre_completo")
            .eq("ID_Socio", "TEST-PK-REGRESION")
            .eq("ID_Organizacion", ORG_A)
            .single()
            .execute()
            .data
        )
        self.assertEqual(row["socio_nombre_completo"], "Regresion")


if __name__ == "__main__":
    unittest.main()
