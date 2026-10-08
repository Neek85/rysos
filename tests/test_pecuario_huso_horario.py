"""
Huso horario operativo (America/Lima) en las vistas Pecuario -- Migración 1 de 2.
Verifica supabase/migrations/20261008100000_huso_horario_lima_vistas_pecuario.sql
(redactada por Cowork; la aplica Neyser a mano en Supabase Studio).

Bloques
  a. ESTÁTICOS (sin base): forma del archivo de migración y de la reversa.
  b. FUNCIONES (requieren la migración aplicada): fn_fecha_operativa / fn_hoy_operativo
     vía rpc con anon y con authenticated. Si no existen -> skip
     "migración 20261008100000 no aplicada".
  c. LECTURA: las 8 vistas se leen sin error de permisos con anon y con authenticated;
     aislamiento por organización con sesiones reales.
  d. SIEMBRA en GRANJA-TEST (organización con es_organizacion_prueba=true; NUNCA en
     GRANJA-VALENCIA): partos, lotes, ventas y mortalidad en los bordes del mes y de los
     56 días, calculados con la fecha de Lima. d0 valida la siembra y la limpieza sin
     necesitar la migración; d1 verifica los valores de las vistas (requiere la migración).

IMPORTANTE (cobertura): d. solo DISCRIMINA el error antiguo (CURRENT_DATE en UTC) entre las
19:00 y las 24:00 de Lima, cuando la fecha UTC ya es "mañana". Fuera de esa ventana UTC y Lima
coinciden y d. pasa con cualquiera de las dos implementaciones; lo que cubre el caso a
cualquier hora es a. (el SQL ya no usa CURRENT_DATE) + b. (las funciones convierten bien el
instante 04:30Z y 05:00Z). El test imprime las fechas UTC y Lima y si la corrida cae en esa
ventana.

Solo escrituras: siembra y limpieza (service_role) en GRANJA-TEST con prefijo TEST-HUSO-;
la limpieza se verifica en tearDown. Las lecturas "de usuario" usan sesión real (magic link).
"""
import os
import re
import time
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest

ROOT = Path(__file__).resolve().parent.parent
MIGRATION = ROOT / "supabase" / "migrations" / "20261008100000_huso_horario_lima_vistas_pecuario.sql"
ROLLBACK = ROOT / "supabase" / "rollbacks" / "20261008100000_huso_horario_lima_rollback.sql"

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

NEEDS_SUPABASE = pytest.mark.skipif(
    not SUPABASE_URL or not SUPABASE_ANON_KEY or not SUPABASE_SERVICE_ROLE_KEY,
    reason="SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY no configuradas — test requiere Supabase Live",
)

MSG_NO_APLICADA = "migración 20261008100000 no aplicada"

LIMA = ZoneInfo("America/Lima")
ORG = "GRANJA-TEST"
ORG_OTRA = "ORG-TEST-DEMO"
ADMIN_EMAIL = "dneyser5+test@gmail.com"          # admin de GRANJA-TEST
OTRA_ADMIN_EMAIL = "admin-demo@ryzos-demo.test"  # admin de ORG-TEST-DEMO (otra organización de prueba)

VISTAS_8 = (
    "vw_pecuario_lotes_etapa",
    "vw_pecuario_reproduccion_mes",
    "vw_pecuario_intervalo_partos",
    "vw_pecuario_reemplazo_reproductoras_anual",
    "vw_pecuario_indicadores_sanitarios_mes",
    "vw_pecuario_incidencia_patologias",
    "vw_pecuario_pesos_promedio_mes",
    "vw_pecuario_ventas_mes",
)


def hoy_lima() -> date:
    return datetime.now(LIMA).date()


def _service_headers():
    return {"apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"}


def _session_headers(token):
    return {"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}"}


def _anon_headers():
    return {"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {SUPABASE_ANON_KEY}"}


def _magic_link_access_token(email: str) -> str:
    gen = httpx.post(
        f"{SUPABASE_URL}/auth/v1/admin/generate_link",
        headers=_service_headers(), json={"type": "magiclink", "email": email}, timeout=30,
    )
    gen.raise_for_status()
    body = gen.json()
    hashed = (body.get("properties") or {}).get("hashed_token") or body.get("hashed_token")
    verify = httpx.post(
        f"{SUPABASE_URL}/auth/v1/verify", headers={"apikey": SUPABASE_ANON_KEY},
        json={"type": "magiclink", "token_hash": hashed}, timeout=30,
    )
    verify.raise_for_status()
    return verify.json()["access_token"]


def _rpc(nombre, payload, headers):
    return httpx.post(
        f"{SUPABASE_URL}/rest/v1/rpc/{nombre}", headers={**headers, "Content-Type": "application/json"},
        json=payload, timeout=30,
    )


def _funciones_aplicadas() -> bool:
    res = _rpc("fn_hoy_operativo", {}, _service_headers())
    return res.status_code == 200


def _quitar_comentarios_y_literales(sql: str) -> str:
    """Quita comentarios `--` y literales '...' (los COMMENT ON mencionan CURRENT_DATE como texto)."""
    sin_comentarios = "\n".join(re.sub(r"--.*$", "", linea) for linea in sql.splitlines())
    return re.sub(r"'(?:[^']|'')*'", "''", sin_comentarios)


# =====================================================================
# a. ESTÁTICOS
# =====================================================================
class TestMigracionEstatica(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8")
        cls.codigo = _quitar_comentarios_y_literales(cls.sql)

    def test_a1_no_usa_current_date_ni_now_date(self):
        self.assertIsNone(re.search(r"\bCURRENT_DATE\b", self.codigo, re.I), "CURRENT_DATE (UTC) sigue en el SQL")
        self.assertIsNone(re.search(r"now\(\)\s*::\s*date", self.codigo, re.I), "now()::date (huso de sesión) en el SQL")

    def test_a2_exactamente_8_create_or_replace_view(self):
        self.assertEqual(len(re.findall(r"CREATE\s+OR\s+REPLACE\s+VIEW", self.codigo, re.I)), 8)
        for vista in VISTAS_8:
            with self.subTest(vista=vista):
                self.assertIn(f"CREATE OR REPLACE VIEW public.{vista} AS", self.codigo)

    def test_a3_funciones_sql_stable_sin_definer_ni_set(self):
        bloques = re.findall(r"CREATE OR REPLACE FUNCTION public\.(\w+)\(.*?\$\$.*?\$\$;", self.codigo, re.S)
        self.assertEqual(sorted(bloques), ["fn_fecha_operativa", "fn_hoy_operativo"])
        for nombre in bloques:
            m = re.search(rf"CREATE OR REPLACE FUNCTION public\.{nombre}\(.*?\$\$;", self.codigo, re.S)
            texto = m.group(0)
            with self.subTest(funcion=nombre):
                self.assertRegex(texto, r"LANGUAGE\s+sql")
                self.assertRegex(texto, r"\bSTABLE\b")
                self.assertNotRegex(texto, r"SECURITY\s+DEFINER")
                self.assertNotRegex(texto, r"\bSET\b")
        self.assertIn("RETURNS date", self.codigo)

    def test_a4_sin_grant_ni_revoke_sobre_vistas(self):
        for linea in re.findall(r"^\s*(?:GRANT|REVOKE)\b[^;]*;", self.codigo, re.M | re.I):
            with self.subTest(sentencia=linea.strip()[:80]):
                self.assertRegex(linea, r"ON\s+FUNCTION", "GRANT/REVOKE solo sobre FUNCTION, nunca sobre vistas")
        self.assertIsNone(re.search(r"ON\s+(?:TABLE\s+)?public\.vw_", self.codigo, re.I))

    def test_a5_execute_solo_anon_authenticated_service_role(self):
        self.assertEqual(
            len(re.findall(r"GRANT EXECUTE ON FUNCTION public\.fn_\w+\([\w ]*\) TO anon, authenticated, service_role;", self.codigo)), 2,
        )
        self.assertEqual(len(re.findall(r"REVOKE ALL ON FUNCTION .*? FROM PUBLIC;", self.codigo)), 2)

    def test_a6_empieza_con_begin_y_termina_con_commit(self):
        sentencias = [s.strip() for s in self.codigo.split(";") if s.strip()]
        self.assertEqual(sentencias[0].upper(), "BEGIN")
        self.assertEqual(sentencias[-1].upper(), "COMMIT")

    def test_a7_ventas_mes_agrega_animales_vendidos_mes_al_final_sin_guano(self):
        m = re.search(r"CREATE OR REPLACE VIEW public\.vw_pecuario_ventas_mes AS(.*?);", self.codigo, re.S)
        cuerpo = m.group(1)
        self.assertRegex(cuerpo, r"AS animales_vendidos_mes\s+FROM")
        self.assertRegex(cuerpo, r"tipo_salida <> ''::tipo_venta_cuy")  # el literal 'guano' queda colapsado por el limpiador
        self.assertRegex(cuerpo, r"::integer AS animales_vendidos_mes")

    def test_a8_usa_las_funciones_de_fecha_operativa(self):
        self.assertGreaterEqual(self.codigo.count("public.fn_hoy_operativo()"), 14)
        self.assertIn("public.fn_fecha_operativa(\"PECUARIO_REPRODUCTORES\".created_at)", self.codigo)


class TestReversaEstatica(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = ROLLBACK.read_text(encoding="utf-8")
        cls.codigo = _quitar_comentarios_y_literales(cls.sql)

    def test_encabezado_y_8_vistas_en_orden_de_dependencias(self):
        self.assertIn("REVIERTE la Migracion 1", self.sql.splitlines()[1] + self.sql.splitlines()[2])
        orden = re.findall(r"CREATE OR REPLACE VIEW public\.(vw_pecuario_\w+) AS", self.codigo)
        self.assertEqual(len(orden), 8)
        self.assertEqual(orden[0], "vw_pecuario_lotes_etapa")
        self.assertLess(orden.index("vw_pecuario_lotes_etapa"), orden.index("vw_pecuario_pesos_promedio_mes"))
        self.assertLess(orden.index("vw_pecuario_lotes_etapa"), orden.index("vw_pecuario_indicadores_sanitarios_mes"))

    def test_no_toca_grants_y_drop_function_esta_comentado(self):
        self.assertIsNone(re.search(r"\b(GRANT|REVOKE)\b", self.codigo, re.I))
        self.assertIsNone(re.search(r"\bDROP\s+FUNCTION\b", self.codigo, re.I), "DROP FUNCTION debe estar comentado")
        self.assertIn("-- DROP FUNCTION IF EXISTS public.fn_hoy_operativo();", self.sql)
        self.assertIn("-- DROP FUNCTION IF EXISTS public.fn_fecha_operativa(timestamptz);", self.sql)

    def test_restaura_current_date_y_conserva_la_columna_nueva_de_ventas(self):
        self.assertGreaterEqual(len(re.findall(r"\bCURRENT_DATE\b", self.codigo)), 8)
        self.assertNotIn("fn_hoy_operativo", self.codigo)
        self.assertIn("AS animales_vendidos_mes", self.codigo)


# =====================================================================
# b./c./d. EN VIVO
# =====================================================================
@NEEDS_SUPABASE
class TestHusoHorarioLive(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/ORGANIZACIONES", headers=_service_headers(),
            params={"ID": f"eq.{ORG}", "select": "es_organizacion_prueba"}, timeout=30,
        )
        res.raise_for_status()
        filas = res.json()
        if not filas or filas[0].get("es_organizacion_prueba") is not True:
            raise unittest.SkipTest(f"{ORG} no es una organización de prueba (es_organizacion_prueba=true): no se siembra")
        cls.funciones = _funciones_aplicadas()
        cls.admin = _magic_link_access_token(ADMIN_EMAIL)
        cls.otra = _magic_link_access_token(OTRA_ADMIN_EMAIL)
        ahora = datetime.now(timezone.utc)
        lima = ahora.astimezone(LIMA)
        cls.en_ventana = lima.hour >= 19
        print(
            f"\n[huso] UTC={ahora:%Y-%m-%d %H:%M} | Lima={lima:%Y-%m-%d %H:%M} | "
            f"ventana 19:00-24:00 Lima (d. discrimina el error antiguo): {'SI' if cls.en_ventana else 'NO'} | "
            f"funciones aplicadas: {cls.funciones}"
        )

    def setUp(self):
        self.sfx = str(int(time.time() * 1000))
        self._cleanup = []  # (tabla, campo, valor), LIFO

    def tearDown(self):
        for tabla, campo, valor in reversed(self._cleanup):
            httpx.delete(f"{SUPABASE_URL}/rest/v1/{tabla}", headers=_service_headers(), params={campo: f"eq.{valor}"}, timeout=30)
        # limpieza verificada: nada de lo sembrado debe quedar
        restos = []
        for tabla, campo, valor in self._cleanup:
            res = httpx.get(f"{SUPABASE_URL}/rest/v1/{tabla}", headers=_service_headers(), params={campo: f"eq.{valor}", "select": campo}, timeout=30)
            if res.status_code == 200 and res.json():
                restos.append((tabla, valor))
        self.assertEqual(restos, [], f"limpieza incompleta en {ORG}: {restos}")

    def _exigir_funciones(self):
        if not self.funciones and not _funciones_aplicadas():
            self.skipTest(MSG_NO_APLICADA)

    # ---- siembra (service_role, solo GRANJA-TEST) ----
    def _post(self, tabla, payload):
        assert payload["ID_Organizacion"] == ORG, "la siembra solo es válida en GRANJA-TEST"
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/{tabla}",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json=payload, timeout=30,
        )
        res.raise_for_status()
        fila = res.json()[0]
        self._cleanup.append((tabla, "id", fila["id"]))
        return fila["id"]

    def _cod(self):
        return f"TEST-HUSO-{self.sfx}-{len(self._cleanup)}"

    def _fila_vista(self, vista, **filtros):
        params = {"ID_Organizacion": f"eq.{ORG}", **{k: f"eq.{v}" for k, v in filtros.items()}}
        res = httpx.get(f"{SUPABASE_URL}/rest/v1/{vista}", headers=_service_headers(), params=params, timeout=30)
        res.raise_for_status()
        filas = res.json()
        return filas[0] if filas else {}

    def _snapshot_vistas(self):
        return {
            "partos_mes": self._fila_vista("vw_pecuario_reproduccion_mes").get("partos_mes", 0),
            "ventas_mes": self._fila_vista("vw_pecuario_ventas_mes").get("ventas_mes", 0),
            "animales": self._fila_vista("vw_pecuario_ventas_mes").get("animales_vendidos_mes", 0),
            "neumonia": self._fila_vista("vw_pecuario_incidencia_patologias", causa="neumonia").get("cantidad_mes", 0),
            "muertes_repro": self._fila_vista("vw_pecuario_indicadores_sanitarios_mes").get("muertes_reproductores_12m", 0),
        }

    def _sembrar(self, hoy: date):
        """Fixtures en los bordes del calendario de Lima. Devuelve ids y fechas usadas."""
        primero = hoy.replace(day=1)
        dia_anterior = primero - timedelta(days=1)
        jaula = self._post("PECUARIO_JAULAS", {"ID_Organizacion": ORG, "codigo_poza": self._cod()})
        ids = {"jaula": jaula, "primero": primero, "hoy": hoy}
        ids["parto_mes"] = self._post("PECUARIO_PARTOS", {"ID_Organizacion": ORG, "poza_id": jaula, "n_vivos": 3, "fecha_parto": primero.isoformat()})
        ids["parto_previo"] = self._post("PECUARIO_PARTOS", {"ID_Organizacion": ORG, "poza_id": jaula, "n_vivos": 3, "fecha_parto": dia_anterior.isoformat()})

        def lote(cantidad, destete):
            return self._post("PECUARIO_LOTES", {
                "ID_Organizacion": ORG, "codigo_lote": self._cod(), "poza_actual_id": jaula,
                "cantidad_inicial": cantidad, "cantidad_actual": cantidad, "fecha_destete": destete.isoformat(),
            })
        ids["lote_engorde"] = lote(5, hoy - timedelta(days=56))
        ids["lote_recria"] = lote(5, hoy - timedelta(days=55))
        ids["lote_ventas"] = lote(30, hoy)

        def venta(cantidad, fecha, precio):
            return self._post("PECUARIO_VENTAS", {
                "ID_Organizacion": ORG, "lote_id": ids["lote_ventas"], "cantidad": cantidad,
                "precio_total": precio, "tipo_salida": "carne", "fecha_venta": fecha.isoformat(),
            })
        ids["venta_2"] = venta(2, primero, 20)          # día 1 del mes de Lima: cuenta
        ids["venta_3"] = venta(3, hoy, 30)              # hoy de Lima: cuenta
        ids["venta_previa"] = venta(4, dia_anterior, 40)  # mes anterior: NO cuenta

        animal = self._post("PECUARIO_REPRODUCTORES", {"ID_Organizacion": ORG, "codigo_arete": self._cod(), "sexo": "macho", "estado": "activo"})
        ids["mortalidad"] = self._post("PECUARIO_MORTALIDAD", {
            "ID_Organizacion": ORG, "animal_id": animal, "etapa": "reproductor", "cantidad": 1,
            "causa": "neumonia", "fecha_evento": primero.isoformat(),
        })
        return ids

    def _con_reintento_medianoche(self, cuerpo):
        """Si la corrida cruza la medianoche de Lima, se repite una vez con la fecha nueva."""
        antes = hoy_lima()
        try:
            cuerpo(antes)
        except AssertionError:
            if hoy_lima() == antes:
                raise
            for tabla, campo, valor in reversed(self._cleanup):
                httpx.delete(f"{SUPABASE_URL}/rest/v1/{tabla}", headers=_service_headers(), params={campo: f"eq.{valor}"}, timeout=30)
            self._cleanup.clear()
            cuerpo(hoy_lima())

    # ------------------------------------------------------------------
    # b. FUNCIONES
    # ------------------------------------------------------------------
    def _casos_funciones(self, headers, etiqueta):
        r1 = _rpc("fn_fecha_operativa", {"p_ts": "2026-10-01T04:30:00Z"}, headers)
        self.assertEqual(r1.status_code, 200, f"{etiqueta}: {r1.status_code} {r1.text[:200]}")
        self.assertEqual(r1.json(), "2026-09-30", f"{etiqueta}: 04:30Z es 23:30 del 30-sep en Lima")
        r2 = _rpc("fn_fecha_operativa", {"p_ts": "2026-10-01T05:00:00Z"}, headers)
        self.assertEqual(r2.status_code, 200, f"{etiqueta}: {r2.status_code} {r2.text[:200]}")
        self.assertEqual(r2.json(), "2026-10-01", f"{etiqueta}: 05:00Z es 00:00 del 1-oct en Lima")
        esperado = hoy_lima().isoformat()
        r3 = _rpc("fn_hoy_operativo", {}, headers)
        self.assertEqual(r3.status_code, 200, f"{etiqueta}: {r3.status_code} {r3.text[:200]}")
        if r3.json() != esperado and hoy_lima().isoformat() != esperado:  # cruzó la medianoche de Lima
            esperado = hoy_lima().isoformat()
        self.assertEqual(r3.json(), esperado, f"{etiqueta}: fn_hoy_operativo() != hoy de Lima")

    def test_b1_funciones_con_anon(self):
        self._exigir_funciones()
        self._casos_funciones(_anon_headers(), "anon")

    def test_b2_funciones_con_authenticated(self):
        self._exigir_funciones()
        self._casos_funciones(_session_headers(self.admin), "authenticated")

    # ------------------------------------------------------------------
    # c. LECTURA
    # ------------------------------------------------------------------
    def test_c1_authenticated_lee_las_8_vistas_sin_error_de_permisos(self):
        for vista in VISTAS_8:
            with self.subTest(vista=vista):
                res = httpx.get(f"{SUPABASE_URL}/rest/v1/{vista}", headers=_session_headers(self.admin), timeout=30)
                self.assertEqual(res.status_code, 200, f"{vista}: {res.status_code} {res.text[:200]}")
                orgs = {f.get("ID_Organizacion") for f in res.json()}
                self.assertLessEqual(orgs, {ORG}, f"{vista} muestra filas de otra organización: {orgs - {ORG}}")

    def test_c2_aislamiento_cruzado_otra_organizacion_no_ve_granja_test(self):
        for vista in VISTAS_8:
            with self.subTest(vista=vista):
                res = httpx.get(f"{SUPABASE_URL}/rest/v1/{vista}", headers=_session_headers(self.otra), timeout=30)
                self.assertEqual(res.status_code, 200, f"{vista}: {res.status_code} {res.text[:200]}")
                self.assertNotIn(ORG, {f.get("ID_Organizacion") for f in res.json()})

    def test_c3_anon_no_recibe_error_de_permisos_en_las_vistas(self):
        for vista in VISTAS_8:
            with self.subTest(vista=vista):
                res = httpx.get(f"{SUPABASE_URL}/rest/v1/{vista}", headers=_anon_headers(), timeout=30)
                self.assertEqual(res.status_code, 200, f"{vista}: {res.status_code} {res.text[:200]}")
                self.assertEqual(res.json(), [], "anon no debe ver filas de ninguna organización")

    # ------------------------------------------------------------------
    # d. SIEMBRA en GRANJA-TEST
    # ------------------------------------------------------------------
    def test_d0_siembra_y_limpieza_funcionan_sin_necesitar_la_migracion(self):
        ids = self._sembrar(hoy_lima())
        self.assertGreaterEqual(len(self._cleanup), 11)
        fila = self._fila_vista("vw_pecuario_lotes_etapa", id=ids["lote_engorde"])
        self.assertEqual(fila.get("id"), ids["lote_engorde"], "el lote sembrado debe ser visible en la vista (service_role)")
        # tearDown borra todo y verifica que no quede nada

    def test_d1_bordes_del_mes_y_de_los_56_dias_en_hora_de_lima(self):
        self._exigir_funciones()

        def cuerpo(hoy):
            antes = self._snapshot_vistas()
            ids = self._sembrar(hoy)
            despues = self._snapshot_vistas()
            print(f"[huso] hoy Lima={hoy} primero del mes={ids['primero']} | UTC hoy={datetime.now(timezone.utc).date()}")

            self.assertEqual(despues["partos_mes"] - antes["partos_mes"], 1, "solo el parto del día 1 (Lima) cuenta en partos_mes")
            self.assertEqual(despues["ventas_mes"] - antes["ventas_mes"], 2, "dos ventas del mes; la del mes anterior no cuenta")
            self.assertEqual(despues["animales"] - antes["animales"], 5, "animales_vendidos_mes = 2 + 3 (el 4 del mes anterior no cuenta)")
            self.assertEqual(despues["neumonia"] - antes["neumonia"], 1, "mortalidad del día 1 del mes de Lima entra en el mes")
            self.assertEqual(despues["muertes_repro"] - antes["muertes_repro"], 1, "mortalidad de reproductor en 12 meses")

            engorde = self._fila_vista("vw_pecuario_lotes_etapa", id=ids["lote_engorde"])
            self.assertEqual(engorde["etapa_calculada"], "engorde", "hoy_Lima - 56 días => engorde")
            self.assertIsNone(engorde["dias_para_engorde"])
            recria = self._fila_vista("vw_pecuario_lotes_etapa", id=ids["lote_recria"])
            self.assertEqual(recria["etapa_calculada"], "recria", "hoy_Lima - 55 días => aún recría")
            self.assertEqual(recria["dias_para_engorde"], 1)

        self._con_reintento_medianoche(cuerpo)
