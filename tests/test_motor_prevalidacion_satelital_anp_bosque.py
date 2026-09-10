"""Motor real de ANP + deforestación conectado a fn_validar_topologia_eudr
(supabase/migrations/20260909000000_anp_y_deforestacion_real.sql).
Ver specs/motor_prevalidacion_satelital_anp_bosque.md.

- Tests estáticos (siempre corren, sin credenciales): verifican que la
  migración trae las piezas reales (tablas, índices, RLS, las 2 funciones
  utilitarias, y que fn_validar_topologia_eudr parte de la versión REAL
  vigente -- agosto 22, con contenido_en_parcela_propia -- no de la de
  agosto 20 que asumía el prompt original, ver la spec).
- Tests funcionales contra Supabase Live (@NEEDS_SUPABASE, se saltan sin
  credenciales o si la migración todavía no se aplicó -- ninguna de las 2
  tablas nuevas existe hoy en la instancia real, confirmado en vivo antes
  de escribir esta migración).
"""

import os
import time
import unittest
from pathlib import Path

import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase"
    / "migrations"
    / "20260909000000_anp_y_deforestacion_real.sql"
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

NEEDS_SUPABASE = pytest.mark.skipif(
    not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY,
    reason="SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configuradas -- test requiere Supabase Live",
)

ORG = "ORG-TEST-ANP-BOSQUE"

# Parcela de prueba: cuadrado ~1.1km x 1.1km cerca de Amazonas, Perú, en una
# zona sin datos reales que pudiera interferir (coordenadas arbitrarias,
# lejos de cualquier organización real).
PLOT_WKT = (
    "SRID=4326;POLYGON((-75.1000 -6.1000, -75.1000 -6.0900, "
    "-75.0900 -6.0900, -75.0900 -6.1000, -75.1000 -6.1000))"
)
# ANP lejana -- no debe intersecar PLOT_WKT.
ANP_LEJANA_WKT = (
    "SRID=4326;MULTIPOLYGON(((-76.5000 -7.5000, -76.5000 -7.4900, "
    "-76.4900 -7.4900, -76.4900 -7.5000, -76.5000 -7.5000)))"
)
# Pérdida forestal lejana -- no debe intersecar PLOT_WKT (mismo criterio
# que ANP_LEJANA_WKT, coordenadas propias para no depender de que ambos
# tests corran juntos).
BOSQUE_LEJANO_WKT = (
    "SRID=4326;MULTIPOLYGON(((-76.7000 -7.7000, -76.7000 -7.6900, "
    "-76.6900 -7.6900, -76.6900 -7.7000, -76.7000 -7.7000)))"
)
# ANP que cubre la mitad oeste de PLOT_WKT -- intersección real, cualquier %.
ANP_SUPERPUESTA_WKT = (
    "SRID=4326;MULTIPOLYGON(((-75.1000 -6.1000, -75.1000 -6.0900, "
    "-75.0950 -6.0900, -75.0950 -6.1000, -75.1000 -6.1000)))"
)
# Pérdida forestal que cubre la mitad este de PLOT_WKT -- anio_perdida >= 2021.
BOSQUE_PERDIDO_WKT = (
    "SRID=4326;MULTIPOLYGON(((-75.0950 -6.1000, -75.0950 -6.0900, "
    "-75.0900 -6.0900, -75.0900 -6.1000, -75.0950 -6.1000)))"
)


def _migration_is_applied(supabase):
    """Chequeo no destructivo: si la migración ya se aplicó, la tabla
    EUDR_AREAS_PROTEGIDAS existe (SELECT vacío no lanza)."""
    try:
        supabase.table("EUDR_AREAS_PROTEGIDAS").select("id").limit(1).execute()
        supabase.table("EUDR_COBERTURA_BOSCOSA_2020").select("id").limit(1).execute()
        return True
    except Exception:
        return False


class TestMigrationFileStatic(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not MIGRATION_PATH.exists():
            raise AssertionError(f"No existe {MIGRATION_PATH}")
        cls.sql = MIGRATION_PATH.read_text(encoding="utf-8")

    def test_crea_eudr_areas_protegidas_no_multitenant(self):
        self.assertIn('CREATE TABLE IF NOT EXISTS public."EUDR_AREAS_PROTEGIDAS"', self.sql)
        self.assertNotIn('"ID_Organizacion" text', self.sql.split('EUDR_AREAS_PROTEGIDAS"')[1][:600])

    def test_indice_gist_areas_protegidas(self):
        self.assertIn("idx_gist_eudr_areas_protegidas_geom", self.sql)
        self.assertIn("USING GIST (geom)", self.sql)

    def test_rls_select_solo_authenticated(self):
        self.assertIn('FOR SELECT\n    TO authenticated', self.sql)

    def test_recrea_eudr_cobertura_boscosa_2020_por_si_la_migracion_de_agosto_no_se_aplico(self):
        # Corrección de premisa (ver la spec): esta tabla NO existe en la
        # instancia real hoy -- la migración de agosto nunca se aplicó.
        self.assertIn('CREATE TABLE IF NOT EXISTS public."EUDR_COBERTURA_BOSCOSA_2020"', self.sql)

    def test_funciones_utilitarias_definidas(self):
        self.assertIn("CREATE OR REPLACE FUNCTION public.fn_evaluar_deforestacion_eudr(p_geom geometry)", self.sql)
        self.assertIn("CREATE OR REPLACE FUNCTION public.fn_evaluar_anp_eudr(p_geom geometry)", self.sql)

    def test_fn_validar_topologia_eudr_parte_de_la_version_real_vigente(self):
        """Corrección de premisa clave: debe preservar
        contenido_en_parcela_propia (agosto 22, la versión REAL vigente
        hoy, confirmada invocando la RPC en vivo) -- no la de agosto 20
        que asumía el prompt original, que la habría regresionado."""
        self.assertIn("v_contenedor_exclusivo", self.sql)
        self.assertIn("'contenido_en_parcela_propia', v_contenedor_exclusivo IS NOT NULL", self.sql)

    def test_fn_validar_topologia_eudr_agrega_anp_y_deforestacion_reales(self):
        self.assertIn("v_deforestacion := public.fn_evaluar_deforestacion_eudr(v_geom);", self.sql)
        self.assertIn("v_anp := public.fn_evaluar_anp_eudr(v_geom);", self.sql)
        self.assertIn("'deforestacion', v_deforestacion,", self.sql)
        self.assertIn("'anp', v_anp", self.sql)


@NEEDS_SUPABASE
class TestMotorPrevalidacionSatelitalLive(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from supabase import create_client

        cls.supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
        if not _migration_is_applied(cls.supabase):
            raise unittest.SkipTest(
                "Migración 20260909000000_anp_y_deforestacion_real.sql todavía no aplicada "
                "en la instancia real (EUDR_AREAS_PROTEGIDAS/EUDR_COBERTURA_BOSCOSA_2020 no existen)."
            )

    def setUp(self):
        self.suffix = str(int(time.time() * 1000))
        self._cleanup()

    def tearDown(self):
        self._cleanup()

    def _cleanup(self):
        self.supabase.table("EUDR_MONITOREO").delete().eq("ID_Organizacion", ORG).execute()
        self.supabase.table("ORGANIZACIONES").delete().eq("ID", ORG).execute()
        self.supabase.table("EUDR_AREAS_PROTEGIDAS").delete().eq("fuente", "TEST-ANP-BOSQUE").execute()
        self.supabase.table("EUDR_COBERTURA_BOSCOSA_2020").delete().eq("fuente", "TEST-ANP-BOSQUE").execute()

    def _crear_monitoreo(self, geom_wkt):
        self.supabase.table("ORGANIZACIONES").insert({"ID": ORG, "es_organizacion_prueba": True}).execute()
        res = (
            self.supabase.table("EUDR_MONITOREO")
            .insert({"ID_Organizacion": ORG, "estado_revision": "PENDIENTE", "geom_inspeccion": geom_wkt})
            .execute()
        )
        return res.data[0]["id_monitoreo"]

    def test_ambas_tablas_vacias_anp_y_deforestacion_siguen_disponible_false(self):
        """No-regresión (mismo AC que specs/eudr_forest_cover_2020_schema.md):
        con ambas tablas vacías, el resultado es idéntico al de siempre."""
        id_monitoreo = self._crear_monitoreo(PLOT_WKT)
        res = self.supabase.rpc(
            "fn_validar_topologia_eudr", {"p_tabla_origen": "EUDR_MONITOREO", "p_registro_id": id_monitoreo}
        ).execute()
        result = res.data
        self.assertFalse(result["anp"]["disponible"])
        self.assertFalse(result["deforestacion"]["disponible"])

    def test_poligono_sin_interseccion_con_ninguna_capa(self):
        # Ambas tablas con datos reales (para que 'disponible' sea true en
        # las 2), pero ninguno interseca PLOT_WKT -- fix de un bug real de
        # este test (no del motor): la primera versión solo insertaba en
        # EUDR_AREAS_PROTEGIDAS, así que deforestacion.disponible salía
        # false legítimamente (esa tabla seguía vacía para este caso) --
        # confirmado corriendo en vivo contra la migración ya aplicada.
        self.supabase.table("EUDR_AREAS_PROTEGIDAS").insert(
            {"geom": ANP_LEJANA_WKT, "nombre": "TEST ANP Lejana", "fuente": "TEST-ANP-BOSQUE"}
        ).execute()
        self.supabase.table("EUDR_COBERTURA_BOSCOSA_2020").insert(
            {"geom": BOSQUE_LEJANO_WKT, "anio_perdida": 2022, "fuente": "TEST-ANP-BOSQUE"}
        ).execute()
        id_monitoreo = self._crear_monitoreo(PLOT_WKT)
        res = self.supabase.rpc(
            "fn_validar_topologia_eudr", {"p_tabla_origen": "EUDR_MONITOREO", "p_registro_id": id_monitoreo}
        ).execute()
        result = res.data
        self.assertTrue(result["anp"]["disponible"])
        self.assertFalse(result["anp"]["alerta_anp"])
        self.assertTrue(result["deforestacion"]["disponible"])
        self.assertEqual(result["deforestacion"]["ha_deforestadas"], 0)

    def test_poligono_con_superposicion_real_de_anp_cualquier_porcentaje(self):
        self.supabase.table("EUDR_AREAS_PROTEGIDAS").insert(
            {"geom": ANP_SUPERPUESTA_WKT, "nombre": "TEST ANP Superpuesta", "fuente": "TEST-ANP-BOSQUE"}
        ).execute()
        id_monitoreo = self._crear_monitoreo(PLOT_WKT)
        res = self.supabase.rpc(
            "fn_validar_topologia_eudr", {"p_tabla_origen": "EUDR_MONITOREO", "p_registro_id": id_monitoreo}
        ).execute()
        result = res.data
        self.assertTrue(result["anp"]["alerta_anp"])
        self.assertEqual(result["anp"]["distancia_minima_km"], 0)
        self.assertEqual(len(result["anp"]["intersecciones"]), 1)
        self.assertEqual(result["anp"]["intersecciones"][0]["nombre"], "TEST ANP Superpuesta")

    def test_poligono_con_evento_de_perdida_boscosa_2021_o_posterior_hectareas_exactas(self):
        self.supabase.table("EUDR_COBERTURA_BOSCOSA_2020").insert(
            {"geom": BOSQUE_PERDIDO_WKT, "anio_perdida": 2022, "fuente": "TEST-ANP-BOSQUE"}
        ).execute()
        id_monitoreo = self._crear_monitoreo(PLOT_WKT)
        res = self.supabase.rpc(
            "fn_validar_topologia_eudr", {"p_tabla_origen": "EUDR_MONITOREO", "p_registro_id": id_monitoreo}
        ).execute()
        result = res.data
        deforestacion = result["deforestacion"]
        self.assertTrue(deforestacion["disponible"])
        self.assertEqual(deforestacion["anio_evento_max"], 2022)
        # El evento cubre ~la mitad este del cuadrado -- ha_deforestadas
        # debe ser positivo y del orden de la mitad del área del cuadrado
        # (area_ha del registro), sin exigir coincidencia exacta con un
        # cálculo geodésico aparte (evita un test frágil por redondeo).
        self.assertGreater(deforestacion["ha_deforestadas"], 0)
        self.assertGreater(deforestacion["pct_solapamiento"], 30)
        self.assertLess(deforestacion["pct_solapamiento"], 70)

    def test_evento_anterior_a_2021_no_cuenta_para_el_cruce(self):
        """anio_perdida < 2021 (antes de la línea de corte EUDR) no debe
        sumar a ha_deforestadas -- mismo criterio ya usado por la versión
        anterior de fn_validar_topologia_eudr (anio_perdida > 2020)."""
        self.supabase.table("EUDR_COBERTURA_BOSCOSA_2020").insert(
            {"geom": BOSQUE_PERDIDO_WKT, "anio_perdida": 2019, "fuente": "TEST-ANP-BOSQUE"}
        ).execute()
        id_monitoreo = self._crear_monitoreo(PLOT_WKT)
        res = self.supabase.rpc(
            "fn_validar_topologia_eudr", {"p_tabla_origen": "EUDR_MONITOREO", "p_registro_id": id_monitoreo}
        ).execute()
        deforestacion = res.data["deforestacion"]
        self.assertTrue(deforestacion["disponible"])
        self.assertEqual(deforestacion["ha_deforestadas"], 0)
        self.assertIsNone(deforestacion["anio_evento_max"])
