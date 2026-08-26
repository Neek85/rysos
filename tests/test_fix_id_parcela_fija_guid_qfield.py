"""Fix del GUID de QField mal etiquetado como "ID_Parcela_Fija" en
vw_monitoreo_poligonos/vw_monitoreo_puntos (+ el trigger del paso 4 + el
LATERAL `mon` de vw_monitoreo_web, agregado el mismo día -- spec sección
5.1, confirmado por el usuario). Ver
specs/fix_id_parcela_fija_guid_qfield.md (diseño cerrado) y ADR-010.

- Tests estáticos (siempre corren, sin credenciales): verifican que la
  migración SQL trae las 4 piezas, con el MISMO `ORDER BY
  m.fecha_monitoreo DESC NULLS LAST, m.creado_en DESC` literal en las 4,
  y que el `CREATE OR REPLACE VIEW` de vw_monitoreo_web preserva las
  columnas/joins que 20260826120000_multi_producto_cafe_cacao.sql agregó
  (regresión contra el error real cometido durante el diseño: la
  auditoría original citó una versión más vieja de esa vista).
- Tests funcionales contra Supabase Live (@NEEDS_SUPABASE), mismo patrón
  que tests/test_multi_producto_cafe_cacao.py -- se saltan además si la
  migración 20260826140000 todavía no se aplicó manualmente en Supabase
  Studio (`_migration_is_applied`, chequeo no destructivo contra el
  duplicado real ya conocido de ORG-TEST-E2E).

NOTA sobre el bullet de "plots fantasma" del prompt original: pide correr
`buildTracesPayload()` -- esa función vive en lib/eudrDdsExporter.js (JS
puro, sin credenciales de Supabase ahí dentro) y este repo no tiene
Jest/Vitest/pytest-js; no hay forma de invocarla literalmente desde este
archivo pytest. `test_plots_fantasma_ya_no_se_cuentan_por_separado_regresion_dds`
replica su lógica exacta de agrupación (`groupByParcela`,
lib/eudrDdsExporter.js:91-100, y el filtro `approved`, líneas 255-257)
en Python, contra los datos reales de ORG-TEST-E2E vía vw_monitoreo_web
-- verifica el efecto del fix sobre la vista (lo que realmente causa el
bug), no la función JS en sí.
"""

import os
import re
import unittest
import uuid
from pathlib import Path

import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase"
    / "migrations"
    / "20260826140000_fix_id_parcela_fija_guid_qfield.sql"
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

NEEDS_SUPABASE = pytest.mark.skipif(
    not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY,
    reason="SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configuradas -- test requiere Supabase Live",
)

EXPECTED_ORDER_BY = "m.fecha_monitoreo DESC NULLS LAST, m.creado_en DESC"

# Duplicado real ya conocido y verificado en vivo (spec sección 1):
# qfield_relation_id compartido por 2 filas de EUDR_MONITOREO
# (COOP-JS-001, creado_en 2026-08-22T04:21:52 / COOP-JS-003, creado_en
# 2026-08-24T23:02:17), misma fecha_monitoreo (2026-07-06) -- el
# desempate por creado_en DESC debe elegir siempre COOP-JS-003.
KNOWN_DUP_GUID = "{4166dc2a-4cf0-452b-8eee-d5f68ce05e5c}"
KNOWN_DUP_EUDR_USO_SUELO_ID_ORIGEN = "18"
KNOWN_DUP_EUDR_INSTALACIONES_ID_ORIGEN = "27"
KNOWN_DUP_EXPECTED_PARENT = "COOP-JS-003"

ORG_TEST_E2E = "ORG-TEST-E2E"


def _migration_is_applied(supabase):
    """Chequeo no destructivo: si la migración ya se aplicó, la fila real
    y conocida de EUDR_USO_SUELO (id=18, ver KNOWN_DUP_GUID) debe resolver
    en vw_monitoreo_poligonos al código real de parcela (COOP-JS-003), no
    al GUID crudo."""
    try:
        rows = (
            supabase.table("vw_monitoreo_poligonos")
            .select('"ID_Parcela_Fija"')
            .eq("tabla_origen", "EUDR_USO_SUELO")
            .eq("id_origen", KNOWN_DUP_EUDR_USO_SUELO_ID_ORIGEN)
            .execute()
            .data
        )
    except Exception:
        return False
    if not rows:
        return False
    return rows[0].get("ID_Parcela_Fija") == KNOWN_DUP_EXPECTED_PARENT


class TestMigrationFileStatic(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not MIGRATION_PATH.exists():
            raise AssertionError(f"No existe {MIGRATION_PATH}")
        cls.sql = MIGRATION_PATH.read_text(encoding="utf-8")

    def test_file_exists(self):
        self.assertTrue(MIGRATION_PATH.exists())

    def test_wrapped_in_transaction(self):
        self.assertRegex(self.sql, r"\bBEGIN;")
        self.assertRegex(self.sql, r"\bCOMMIT;")

    def test_no_drop_statements(self):
        """Additive-only: CREATE OR REPLACE VIEW/FUNCTION sin ningún DROP
        -- así los GRANT existentes se preservan automáticamente."""
        self.assertNotIn("DROP VIEW", self.sql.upper())
        self.assertNotIn("DROP FUNCTION", self.sql.upper())
        self.assertNotIn("DROP TRIGGER", self.sql.upper())

    def test_all_four_objects_present(self):
        self.assertIn("CREATE OR REPLACE VIEW public.vw_monitoreo_poligonos", self.sql)
        self.assertIn("CREATE OR REPLACE VIEW public.vw_monitoreo_puntos", self.sql)
        self.assertIn(
            "CREATE OR REPLACE FUNCTION public.fn_set_producto_predominante_uso_suelo",
            self.sql,
        )
        self.assertIn("CREATE OR REPLACE VIEW public.vw_monitoreo_web", self.sql)

    def test_lateral_join_added_to_both_views(self):
        self.assertEqual(self.sql.count("LEFT JOIN LATERAL"), 4, "esperadas 4 LATERAL: 2 vistas (resolved) + 2 ramas de vw_monitoreo_web (mon)")
        self.assertIn("m.qfield_relation_id = u.id_parcela", self.sql)
        self.assertIn("m.qfield_relation_id = i.id_parcela", self.sql)

    def test_same_order_by_literal_in_all_five_occurrences(self):
        """AC central de la spec: el mismo ORDER BY, mismo orden de
        columnas, en las 4 piezas -- 5 ocurrencias porque vw_monitoreo_web
        lo repite en sus 2 ramas (poligono/punto) del UNION ALL."""
        occurrences = self.sql.count(f"ORDER BY {EXPECTED_ORDER_BY}")
        self.assertEqual(
            occurrences, 5,
            f"esperadas 5 ocurrencias exactas de 'ORDER BY {EXPECTED_ORDER_BY}': "
            f"vw_monitoreo_poligonos, vw_monitoreo_puntos, el trigger, y las 2 ramas de vw_monitoreo_web",
        )

    def test_vw_monitoreo_web_mon_lateral_has_desempate_in_both_branches(self):
        web_block = self.sql.split("CREATE OR REPLACE VIEW public.vw_monitoreo_web")[1]
        self.assertEqual(
            web_block.count(f"ORDER BY {EXPECTED_ORDER_BY}"), 2,
            "el LATERAL mon debe llevar el desempate en las 2 ramas del UNION ALL (poligono y punto)",
        )

    def test_vw_monitoreo_web_preserves_multi_producto_columns_and_joins(self):
        """Regresión contra el error real cometido durante el diseño: la
        auditoría original de la spec citó
        20260819_vw_monitoreo_web_productor_nombre_parcela_fallback.sql,
        pero la versión vigente es
        20260826120000_multi_producto_cafe_cacao.sql (agrega estas 3
        columnas + condiciones AND ...ID_Organizacion en los JOIN). Si esta
        migración hubiera partido de la versión vieja, este test falla."""
        web_block = self.sql.split("CREATE OR REPLACE VIEW public.vw_monitoreo_web")[1]
        for column in ("id_producto_predominante", "producto_codigo", "producto_nombre"):
            self.assertIn(column, web_block, f"columna {column} (de multi-producto) se perdió")
        self.assertIn('LEFT JOIN public."PRODUCTOS" prod', web_block)
        self.assertEqual(
            web_block.count('AND src."ID_Organizacion" = pp."ID_Organizacion"'), 2,
            "el JOIN org-scoped contra PADRON_PARCELAS debe seguir en las 2 ramas",
        )

    def test_trigger_function_body_matches_expected(self):
        trigger_block = self.sql.split(
            "CREATE OR REPLACE FUNCTION public.fn_set_producto_predominante_uso_suelo"
        )[1].split("$$;")[0]
        self.assertIn("m.qfield_relation_id = NEW.id_parcela", trigger_block)
        self.assertIn(f"ORDER BY {EXPECTED_ORDER_BY}", trigger_block)
        self.assertNotIn("RAISE EXCEPTION", trigger_block.upper())


@NEEDS_SUPABASE
class TestFixIdParcelaFijaGuidQfieldLive(unittest.TestCase):
    """Se auto-salta si la migración 20260826140000 todavía no se aplicó
    manualmente en Supabase Studio."""

    ORG_A = "ORG-TEST-FIX-GUID-A"
    ORG_B = "ORG-TEST-FIX-GUID-B"

    @classmethod
    def setUpClass(cls):
        from supabase import create_client

        cls.supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
        if not _migration_is_applied(cls.supabase):
            raise unittest.SkipTest(
                "Migración 20260826140000_fix_id_parcela_fija_guid_qfield.sql todavía no "
                "aplicada en Supabase Studio -- se salta hasta que se aplique."
            )
        cafe = cls.supabase.table("PRODUCTOS").select("id").eq("codigo", "CAFE").single().execute().data
        cacao = cls.supabase.table("PRODUCTOS").select("id").eq("codigo", "CACAO").single().execute().data
        cls.id_cafe = cafe["id"]
        cls.id_cacao = cacao["id"]

    def _cleanup(self, orgs):
        for org in orgs:
            self.supabase.table("EUDR_USO_SUELO").delete().eq("ID_Organizacion", org).execute()
            self.supabase.table("EUDR_INSTALACIONES").delete().eq("ID_Organizacion", org).execute()
            self.supabase.table("EUDR_MONITOREO").delete().eq("ID_Organizacion", org).execute()
            self.supabase.table("PADRON_PARCELAS").delete().eq("ID_Organizacion", org).execute()
            self.supabase.table("ORGANIZACIONES").delete().eq("ID", org).execute()

    def setUp(self):
        self._cleanup([self.ORG_A, self.ORG_B])

    def tearDown(self):
        self._cleanup([self.ORG_A, self.ORG_B])

    # -- 1. Duplicado real ya conocido: las 2 vistas resuelven al mismo padre --
    def test_vistas_resuelven_al_mismo_padre_para_el_guid_duplicado_real_conocido(self):
        poligono = (
            self.supabase.table("vw_monitoreo_poligonos")
            .select('"ID_Parcela_Fija"')
            .eq("tabla_origen", "EUDR_USO_SUELO")
            .eq("id_origen", KNOWN_DUP_EUDR_USO_SUELO_ID_ORIGEN)
            .execute()
            .data
        )
        punto = (
            self.supabase.table("vw_monitoreo_puntos")
            .select('"ID_Parcela_Fija"')
            .eq("tabla_origen", "EUDR_INSTALACIONES")
            .eq("id_origen", KNOWN_DUP_EUDR_INSTALACIONES_ID_ORIGEN)
            .execute()
            .data
        )
        self.assertEqual(len(poligono), 1)
        self.assertEqual(len(punto), 1)
        self.assertEqual(poligono[0]["ID_Parcela_Fija"], KNOWN_DUP_EXPECTED_PARENT)
        self.assertEqual(punto[0]["ID_Parcela_Fija"], KNOWN_DUP_EXPECTED_PARENT)

    # -- 2. Duplicado nuevo y aislado: vistas Y trigger coinciden en el mismo padre --
    def test_trigger_y_vistas_coinciden_ante_un_duplicado_nuevo_con_producto_distinto(self):
        guid = f"{{{uuid.uuid4()}}}"
        self.supabase.table("ORGANIZACIONES").insert({"ID": self.ORG_A, "es_organizacion_prueba": True}).execute()
        self.supabase.table("PADRON_PARCELAS").insert(
            [
                {
                    "ID_Parcela_Fija": "TEST-FIX-GUID-VIEJA",
                    "ID_Organizacion": self.ORG_A,
                    "activo": True,
                    "id_producto_predominante": self.id_cacao,
                },
                {
                    "ID_Parcela_Fija": "TEST-FIX-GUID-NUEVA",
                    "ID_Organizacion": self.ORG_A,
                    "activo": True,
                    "id_producto_predominante": self.id_cafe,
                },
            ]
        ).execute()
        misma_fecha = "2026-07-06"
        # Insertadas en orden -- creado_en (poblado automáticamente) queda
        # estrictamente creciente aunque fecha_monitoreo empate.
        self.supabase.table("EUDR_MONITOREO").insert(
            {
                "ID_Organizacion": self.ORG_A,
                "ID_Parcela_Fija": "TEST-FIX-GUID-VIEJA",
                "qfield_relation_id": guid,
                "fecha_monitoreo": misma_fecha,
                "estado_revision": "PENDIENTE",
            }
        ).execute()
        self.supabase.table("EUDR_MONITOREO").insert(
            {
                "ID_Organizacion": self.ORG_A,
                "ID_Parcela_Fija": "TEST-FIX-GUID-NUEVA",
                "qfield_relation_id": guid,
                "fecha_monitoreo": misma_fecha,
                "estado_revision": "PENDIENTE",
            }
        ).execute()

        square_wkt = "SRID=4326;POLYGON((-75.0 4.0, -75.001 4.0, -75.001 4.001, -75.0 4.001, -75.0 4.0))"
        res_uso_suelo = (
            self.supabase.table("EUDR_USO_SUELO")
            .insert(
                {
                    "ID_Organizacion": self.ORG_A,
                    "id_parcela": guid,
                    "geom": square_wkt,
                    "tipo_uso": "TEST",
                    "estado_revision": "PENDIENTE",
                }
            )
            .execute()
        )
        row_uso_suelo = res_uso_suelo.data[0]

        vista_poligonos = (
            self.supabase.table("vw_monitoreo_poligonos")
            .select('"ID_Parcela_Fija"')
            .eq("tabla_origen", "EUDR_USO_SUELO")
            .eq("id_origen", str(row_uso_suelo["id"]))
            .execute()
            .data
        )
        self.assertEqual(len(vista_poligonos), 1)

        # Las 3 resoluciones deben apuntar al mismo padre (el de creado_en
        # más reciente, TEST-FIX-GUID-NUEVA / CAFE):
        # 1. trigger -> id_producto_predominante copiado de esa parcela
        self.assertEqual(row_uso_suelo["id_producto_predominante"], self.id_cafe)
        # 2. vw_monitoreo_poligonos -> "ID_Parcela_Fija" resuelto
        self.assertEqual(vista_poligonos[0]["ID_Parcela_Fija"], "TEST-FIX-GUID-NUEVA")

    # -- 3. Con una fila que sí resuelve, vw_monitoreo_web deja de exponer NULL --
    def test_vw_monitoreo_web_expone_parcela_codigo_no_nulo_cuando_resuelve(self):
        guid = f"{{{uuid.uuid4()}}}"
        self.supabase.table("ORGANIZACIONES").insert({"ID": self.ORG_A, "es_organizacion_prueba": True}).execute()
        self.supabase.table("PADRON_PARCELAS").insert(
            {
                "ID_Parcela_Fija": "TEST-FIX-GUID-RESUELVE",
                "ID_Organizacion": self.ORG_A,
                "parcela_codigo": "P-TEST-FIX-GUID",
                "parcela_nombre": "Finca de prueba",
                "totalh": 2.5,
                "activo": True,
            }
        ).execute()
        self.supabase.table("EUDR_MONITOREO").insert(
            {
                "ID_Organizacion": self.ORG_A,
                "ID_Parcela_Fija": "TEST-FIX-GUID-RESUELVE",
                "qfield_relation_id": guid,
                "estado_revision": "PENDIENTE",
            }
        ).execute()
        self.supabase.table("EUDR_USO_SUELO").insert(
            {
                "ID_Organizacion": self.ORG_A,
                "id_parcela": guid,
                "geom": "SRID=4326;POLYGON((-75.0 4.0, -75.001 4.0, -75.001 4.001, -75.0 4.001, -75.0 4.0))",
                "tipo_uso": "TEST",
                "estado_revision": "APROBADO",
            }
        ).execute()

        rows = (
            self.supabase.table("vw_monitoreo_web")
            .select("tabla_origen, parcela_codigo, parcela_nombre, area_ha")
            .eq("ID_Organizacion", self.ORG_A)
            .eq("tabla_origen", "EUDR_USO_SUELO")
            .execute()
            .data
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["parcela_codigo"], "P-TEST-FIX-GUID")
        self.assertEqual(rows[0]["parcela_nombre"], "Finca de prueba")
        self.assertEqual(float(rows[0]["area_ha"]), 2.5)

    # -- 4. GUID inventado: sigue devolviendo NULL, sin error --
    def test_guid_inventado_no_resuelve_devuelve_null_sin_error(self):
        self.supabase.table("ORGANIZACIONES").insert({"ID": self.ORG_A, "es_organizacion_prueba": True}).execute()
        res = (
            self.supabase.table("EUDR_USO_SUELO")
            .insert(
                {
                    "ID_Organizacion": self.ORG_A,
                    "id_parcela": "{99999999-9999-9999-9999-999999999999}",
                    "geom": "SRID=4326;POLYGON((-75.0 4.0, -75.001 4.0, -75.001 4.001, -75.0 4.001, -75.0 4.0))",
                    "tipo_uso": "TEST",
                    "estado_revision": "APROBADO",
                }
            )
            .execute()
        )
        row = res.data[0]
        self.assertIsNone(row["id_producto_predominante"])

        vista = (
            self.supabase.table("vw_monitoreo_poligonos")
            .select('"ID_Parcela_Fija"')
            .eq("tabla_origen", "EUDR_USO_SUELO")
            .eq("id_origen", str(row["id"]))
            .execute()
            .data
        )
        self.assertEqual(len(vista), 1)
        self.assertIsNone(vista[0]["ID_Parcela_Fija"])

        web = (
            self.supabase.table("vw_monitoreo_web")
            .select("parcela_codigo")
            .eq("ID_Organizacion", self.ORG_A)
            .eq("tabla_origen", "EUDR_USO_SUELO")
            .execute()
            .data
        )
        self.assertEqual(len(web), 1)
        self.assertIsNone(web[0]["parcela_codigo"])

    # -- 5. Aislamiento multi-tenant: el mismo GUID en 2 orgs nunca cruza --
    def test_aislamiento_multi_tenant_lateral_nunca_cruza_organizacion(self):
        guid_compartido = f"{{{uuid.uuid4()}}}"
        self.supabase.table("ORGANIZACIONES").insert(
            [
                {"ID": self.ORG_A, "es_organizacion_prueba": True},
                {"ID": self.ORG_B, "es_organizacion_prueba": True},
            ]
        ).execute()
        # Solo ORG_A tiene el EUDR_MONITOREO padre real para este GUID.
        self.supabase.table("EUDR_MONITOREO").insert(
            {
                "ID_Organizacion": self.ORG_A,
                "ID_Parcela_Fija": "TEST-FIX-GUID-SOLO-ORG-A",
                "qfield_relation_id": guid_compartido,
                "estado_revision": "PENDIENTE",
            }
        ).execute()
        # ORG_B usa el MISMO GUID por casualidad (colisión deliberada).
        res_b = (
            self.supabase.table("EUDR_USO_SUELO")
            .insert(
                {
                    "ID_Organizacion": self.ORG_B,
                    "id_parcela": guid_compartido,
                    "geom": "SRID=4326;POLYGON((-75.0 4.0, -75.001 4.0, -75.001 4.001, -75.0 4.001, -75.0 4.0))",
                    "tipo_uso": "TEST",
                    "estado_revision": "APROBADO",
                }
            )
            .execute()
        )
        row_b = res_b.data[0]

        # El trigger NO debe copiar ningún producto (no matchea org).
        self.assertIsNone(row_b["id_producto_predominante"])

        vista_b = (
            self.supabase.table("vw_monitoreo_poligonos")
            .select('"ID_Parcela_Fija"')
            .eq("tabla_origen", "EUDR_USO_SUELO")
            .eq("id_origen", str(row_b["id"]))
            .execute()
            .data
        )
        self.assertEqual(len(vista_b), 1)
        self.assertIsNone(
            vista_b[0]["ID_Parcela_Fija"],
            "el LATERAL nunca debe resolver un EUDR_MONITOREO de otra organización aunque el GUID coincida",
        )

    # -- 6. Regresión "plots fantasma" del exportador DDS (spec sección 6) --
    def test_plots_fantasma_ya_no_se_cuentan_por_separado_regresion_dds(self):
        """Replica groupByParcela (lib/eudrDdsExporter.js:91-100) y el
        filtro `approved` de buildTracesPayload (líneas 255-257) en Python,
        contra las filas reales APROBADO de ORG-TEST-E2E vía
        vw_monitoreo_web -- ver nota del docstring del módulo sobre por
        qué no se invoca la función JS literalmente desde pytest."""
        rows = (
            self.supabase.table("vw_monitoreo_web")
            .select('"ID_Parcela_Fija", parcela_codigo, estado_revision, tabla_origen')
            .eq("ID_Organizacion", ORG_TEST_E2E)
            .execute()
            .data
        )
        approved = [r for r in rows if r.get("estado_revision") == "APROBADO"]
        self.assertEqual(len(approved), 13, "snapshot real esperado: 5 EUDR_USO_SUELO + 5 EUDR_INSTALACIONES + 3 EUDR_MONITOREO APROBADO en ORG-TEST-E2E")

        groups = {}
        for record in approved:
            key = record.get("ID_Parcela_Fija") or record.get("parcela_codigo")
            if not key:
                continue
            groups.setdefault(key, []).append(record)

        # Antes del fix (GUID crudo sin resolver): 6 grupos (spec sección
        # 1) -- COOP-JS-004, COOP-JS-001 (de EUDR_MONITOREO) + 4 GUIDs
        # crudos distintos. Después del fix: los mismos GUIDs resuelven a
        # parcelas reales ya existentes -> 3 grupos (COOP-JS-001,
        # COOP-JS-003, COOP-JS-004).
        self.assertEqual(
            len(groups), 3,
            f"total_plots esperado 3 tras el fix, se obtuvieron {len(groups)}: {sorted(groups.keys())}",
        )
        self.assertEqual(set(groups.keys()), {"COOP-JS-001", "COOP-JS-003", "COOP-JS-004"})

    # -- 7. 4ta pieza: el LATERAL `mon` de vw_monitoreo_web (desempate por creado_en) --
    def test_vw_monitoreo_web_productor_no_regresiona_para_misma_parcela_con_2_visitas(self):
        """HALLAZGO EN VIVO durante la implementación (no estaba en la
        auditoría de la spec): `EUDR_MONITOREO` tiene un
        `UNIQUE("ID_Organizacion", "ID_Parcela_Fija", fecha_monitoreo)`
        real (`eudr_monitoreo_org_parcela_fecha_key`, confirmado
        empíricamente -- no aparece en ninguna migración, la tabla se creó
        fuera de este repo). Esto vuelve **imposible** que 2 filas de
        `EUDR_MONITOREO` de la MISMA parcela empaten en `fecha_monitoreo`
        (el caso que motivó agregar `creado_en DESC` al `LATERAL` `mon` en
        la sección 5.1 de la spec) -- a diferencia del empate real de las
        piezas 1/2/3, que es por `qfield_relation_id` compartido entre 2
        filas con `"ID_Parcela_Fija"` DISTINTO (sí permitido por este
        UNIQUE, confirmado en
        test_trigger_y_vistas_coinciden_ante_un_duplicado_nuevo_con_producto_distinto).
        Con el empate real inalcanzable, este test no puede reproducir un
        desempate genuino -- en su lugar confirma que el caso normal (2
        visitas de fechas distintas) sigue funcionando sin regresión: el
        `LATERAL` sigue eligiendo la visita de `fecha_monitoreo` más
        reciente, `creado_en` nunca entra en juego cuando no hay empate."""
        self.supabase.table("ORGANIZACIONES").insert({"ID": self.ORG_A, "es_organizacion_prueba": True}).execute()
        self.supabase.table("PADRON_PARCELAS").insert(
            {"ID_Parcela_Fija": "TEST-FIX-GUID-PRODUCTOR", "ID_Organizacion": self.ORG_A, "activo": True}
        ).execute()
        self.supabase.table("EUDR_MONITOREO").insert(
            {
                "ID_Organizacion": self.ORG_A,
                "ID_Parcela_Fija": "TEST-FIX-GUID-PRODUCTOR",
                "nuevo_productor_nombre": "Productor Visita Vieja",
                "fecha_monitoreo": "2026-01-01",
                "estado_revision": "PENDIENTE",
            }
        ).execute()
        self.supabase.table("EUDR_MONITOREO").insert(
            {
                "ID_Organizacion": self.ORG_A,
                "ID_Parcela_Fija": "TEST-FIX-GUID-PRODUCTOR",
                "nuevo_productor_nombre": "Productor Visita Nueva",
                "fecha_monitoreo": "2026-07-06",
                "estado_revision": "PENDIENTE",
            }
        ).execute()

        # Una 3ra fila EUDR_MONITOREO, esta sí con qfield_relation_id, para
        # que una fila de EUDR_USO_SUELO resuelva su "ID_Parcela_Fija"
        # (piezas 1/2/3) a la MISMA parcela ya usada arriba -- eso activa
        # el match del LATERAL `mon` por "ID_Parcela_Fija" (pieza 4). Su
        # propio productor queda NULL a propósito (sin ID_Socio/
        # nuevo_productor_nombre) para no interferir.
        guid = f"{{{uuid.uuid4()}}}"
        self.supabase.table("EUDR_MONITOREO").insert(
            {
                "ID_Organizacion": self.ORG_A,
                "ID_Parcela_Fija": "TEST-FIX-GUID-PRODUCTOR",
                "qfield_relation_id": guid,
                # ANTERIOR a "Visita Nueva" (2026-07-06) a propósito -- su
                # propio productor es NULL, y si esta fecha fuera la más
                # reciente el LATERAL `mon` la elegiría a ELLA (por
                # fecha_monitoreo DESC), devolviendo NULL en vez de
                # "Productor Visita Nueva" -- bug real de este fixture,
                # encontrado corriendo el test contra la instancia real
                # tras aplicar la migración (no un bug de la vista).
                "fecha_monitoreo": "2026-02-01",
                "estado_revision": "PENDIENTE",
            }
        ).execute()
        # Una fila de EUDR_USO_SUELO de esa misma parcela -- su `productor`
        # propio siempre es NULL, así que vw_monitoreo_web cae al LATERAL
        # `mon` para resolverlo.
        self.supabase.table("EUDR_USO_SUELO").insert(
            {
                "ID_Organizacion": self.ORG_A,
                "id_parcela": guid,
                "geom": "SRID=4326;POLYGON((-75.0 4.0, -75.001 4.0, -75.001 4.001, -75.0 4.001, -75.0 4.0))",
                "tipo_uso": "TEST",
                "estado_revision": "APROBADO",
            }
        ).execute()

        web_rows = (
            self.supabase.table("vw_monitoreo_web")
            .select("productor")
            .eq("ID_Organizacion", self.ORG_A)
            .eq("tabla_origen", "EUDR_USO_SUELO")
            .execute()
            .data
        )
        self.assertEqual(len(web_rows), 1)
        # fecha_monitoreo distinta (2026-07-06 > 2026-01-01) -- decide sola,
        # sin necesitar el desempate por creado_en.
        self.assertEqual(web_rows[0]["productor"], "Productor Visita Nueva")


if __name__ == "__main__":
    unittest.main(verbosity=2)
