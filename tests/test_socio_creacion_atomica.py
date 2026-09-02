"""Mejoras importador padrón masivo (ronda 9) -- alta atómica de socio +
certificaciones vía RPC. Ver specs/mejoras_importador_padron_masivo.md
sección 12.1 y
supabase/migrations/20260901120000_socio_creacion_atomica.sql.

Mismo patrón que tests/test_certificaciones_normalizadas.py::TestMigrationFileStatic
(y su precedente directo, fn_guardar_inspeccion_completa): tests
estáticos sobre el TEXTO de la migración -- no requieren conexión a
Postgres, siempre corren. La corrección en tiempo de ejecución (INSERT
real a PADRON_SOCIOS + SOCIO_CERTIFICACIONES dentro de una sola
transacción) solo se puede confirmar una vez que la migración se aplique
manualmente en Supabase Studio (sin conexión Postgres directa desde este
entorno, ver CLAUDE.md) y se pruebe una importación real.
"""

import unittest
from pathlib import Path

MIGRATION_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase"
    / "migrations"
    / "20260901120000_socio_creacion_atomica.sql"
)

# Columnas de PADRON_SOCIOS transcriptas de socioPayload()
# (lib/actions/sociosActions.js) -- confirmadas contra el código real
# antes de escribir la migración, no reinventadas.
SOCIO_PAYLOAD_COLUMNS = [
    "codigo_finca",
    "socio_nombre_completo",
    "socio_dni",
    "socio_genero",
    "socio_fecha_nacimiento",
    "celular_socio",
    "conyuge_nombre",
    "conyuge_dni",
    "socio_departamento",
    "socio_provincia",
    "socio_distrito",
    "localidad",
    "socio_fecha_ingreso",
]


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

    def test_function_signature(self):
        self.assertIn(
            "CREATE OR REPLACE FUNCTION public.fn_crear_socio_con_certificaciones(",
            self.sql,
        )
        for param in ("p_id_socio text", "p_organizacion text", "p_socio jsonb", "p_certificaciones jsonb"):
            self.assertIn(param, self.sql)
        self.assertIn("RETURNS jsonb", self.sql)
        self.assertIn("LANGUAGE plpgsql", self.sql)

    def test_no_security_definer(self):
        # Mismo criterio que fn_guardar_inspeccion_completa: corre con el
        # rol del llamador (Service Role Key ya bypasea privilegios sin
        # necesidad de escalar con SECURITY DEFINER). Se busca solo en el
        # PREÁMBULO real de la función (entre la firma y "AS $$"), no en
        # todo el archivo -- el comentario que documenta esta misma
        # decisión, más abajo, menciona la frase "SECURITY DEFINER" en
        # prosa, y no debe generar un falso positivo acá.
        start = self.sql.index("CREATE OR REPLACE FUNCTION public.fn_crear_socio_con_certificaciones(")
        end = self.sql.index("AS $$", start)
        preamble = self.sql[start:end]
        self.assertNotIn("SECURITY DEFINER", preamble)

    def test_no_grant_statement(self):
        # Mismo criterio que fn_sanitize_geometry (supabase/migrations/
        # 20260818_gis_core_sanitization.sql, ya llamada hoy vía Service
        # Role Key desde createParcela sin ningún GRANT) -- service_role
        # bypasea el modelo de privilegios de función, no hace falta.
        self.assertNotIn("GRANT EXECUTE", self.sql)

    def test_organizacion_guard(self):
        self.assertIn("IF p_organizacion IS NULL OR p_organizacion = '' THEN", self.sql)
        self.assertIn("RAISE EXCEPTION 'No se pudo determinar la organización activa.';", self.sql)

    def test_id_socio_guard(self):
        self.assertIn("IF p_id_socio IS NULL OR p_id_socio = '' THEN", self.sql)

    def test_uses_jsonb_populate_record_for_socio_payload(self):
        self.assertIn(
            'jsonb_populate_record(NULL::public."PADRON_SOCIOS", p_socio)',
            self.sql,
        )

    def test_insert_padron_socios_lists_exact_columns_from_socio_payload(self):
        start = self.sql.index('INSERT INTO public."PADRON_SOCIOS"')
        end = self.sql.index(";", self.sql.index("RETURNING id INTO v_socio_id", start))
        block = self.sql[start:end]
        self.assertIn('"ID_Socio"', block)
        self.assertIn('"ID_Organizacion"', block)
        for column in SOCIO_PAYLOAD_COLUMNS:
            self.assertIn(column, block, f"falta la columna {column} (de socioPayload) en el INSERT")
        # Ninguna columna congelada de ADR-027 (certificaciones/cert_org_estatus/
        # los 8 flags) debe aparecer -- socioPayload() tampoco las escribe.
        for legacy in (
            "cert_nop_usda",
            "ue_2018_848",
            "cor_canada",
            "cert_ds_0442006_ag",
            "cert_lpo_mx",
            "cert_rainforest",
            "cert_comercio_justo",
            "cert_fair_trade_usa",
            "cert_org_estatus",
        ):
            self.assertNotIn(legacy, block)

    def test_returning_id_into_socio_uuid(self):
        self.assertIn("RETURNING id INTO v_socio_id", self.sql)

    def test_no_delete_statement(self):
        # A diferencia de syncSocioCertificaciones (JS, DELETE+INSERT
        # porque también cubre edición) y de fn_guardar_inspeccion_completa
        # (DELETE+INSERT en sus 7 tablas, mismo motivo), esta función es
        # SOLO para alta nueva -- nunca hay filas previas en
        # SOCIO_CERTIFICACIONES para un ID_Socio que se está insertando
        # por primera vez, así que no debe haber ningún DELETE.
        self.assertNotIn("DELETE FROM", self.sql)

    def test_certificaciones_loop_uses_jsonb_to_recordset(self):
        self.assertIn(
            "FOR r_cert IN SELECT * FROM jsonb_to_recordset(p_certificaciones) AS x(codigo text, estado text)",
            self.sql,
        )

    def test_insert_socio_certificaciones_resolves_catalogo_codigo_to_id_inside_transaction(self):
        start = self.sql.index('INSERT INTO public."SOCIO_CERTIFICACIONES"')
        end = self.sql.index("END LOOP;", start)
        block = self.sql[start:end]
        self.assertIn("id_socio", block)
        self.assertIn("id_organizacion", block)
        self.assertIn("id_certificacion", block)
        self.assertIn("estado", block)
        self.assertIn('FROM public."CERTIFICACIONES_CATALOGO" cat', block)
        self.assertIn("WHERE cat.codigo = r_cert.codigo AND cat.activo = true", block)

    def test_returns_id_and_id_socio(self):
        self.assertIn("RETURN jsonb_build_object('id', v_socio_id, 'id_socio', p_id_socio);", self.sql)


if __name__ == "__main__":
    unittest.main()
