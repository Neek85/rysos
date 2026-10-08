"""
Huso horario operativo (America/Lima) -- Migración 2 de 2: defaults, funciones y 1 vista.
Verifica supabase/migrations/20261008110000_huso_horario_lima_defaults_y_funciones_pecuario.sql
(redactada por Cowork; la aplicó Neyser a mano en Supabase Studio el 2026-10-08).

  a. ESTÁTICOS (sin base): forma del SQL de la migración y de su reversa.
  b. CATÁLOGO (solo lectura, `supabase db query --linked`, ADR-042): 0 defaults CURRENT_DATE
     en PECUARIO_*, 15 con fn_hoy_operativo(); las 3 funciones sin CURRENT_DATE y con el mismo
     prosecdef/proconfig de antes; los 2 triggers siguen existiendo; la vista sin CURRENT_DATE.
     Se omite si el CLI no está enlazado (p. ej. CI).
  c. COMPORTAMIENTO en GRANJA-TEST (es_organizacion_prueba=true; NUNCA GRANJA-VALENCIA) con
     service_role: parto y lote insertados SIN fecha reciben el hoy de Lima, y la entrada de
     stock inicial de fn_crear_insumo_con_stock_inicial también. Limpieza verificada.

Cobertura: c. solo distingue UTC de Lima entre las 19:00 y las 24:00 de Lima (el test imprime
las horas y si la corrida cae en esa ventana); fuera de ella lo cubren a. y b.
"""
import json
import os
import re
import shutil
import subprocess
import time
import unittest
import uuid
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest

ROOT = Path(__file__).resolve().parent.parent
MIGRATION = ROOT / "supabase" / "migrations" / "20261008110000_huso_horario_lima_defaults_y_funciones_pecuario.sql"
ROLLBACK = ROOT / "supabase" / "rollbacks" / "20261008110000_huso_horario_lima_rollback.sql"

CLI = shutil.which("supabase")
LINKED = (ROOT / "supabase" / ".temp" / "project-ref").exists()
NEEDS_CLI = pytest.mark.skipif(
    not CLI or not LINKED,
    reason="requiere `supabase` CLI instalado y enlazado (supabase link): lectura de catálogos (ADR-042)",
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
NEEDS_SUPABASE = pytest.mark.skipif(
    not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY,
    reason="SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configuradas — test requiere Supabase Live",
)

LIMA = ZoneInfo("America/Lima")
ORG = "GRANJA-TEST"

DEFAULTS_15 = (
    ("PECUARIO_COMPRAS", "fecha"),
    ("PECUARIO_CONTROL_SANITARIO", "fecha"),
    ("PECUARIO_HISTORIAL_MACHOS", "fecha_entrada"),
    ("PECUARIO_INSUMOS_MOVIMIENTOS", "fecha"),
    ("PECUARIO_LIMPIEZA_GALPON", "fecha"),
    ("PECUARIO_LOTES", "fecha_destete"),
    ("PECUARIO_MORTALIDAD", "fecha_evento"),
    ("PECUARIO_PARTOS", "fecha_parto"),
    ("PECUARIO_PESAJES", "fecha_pesaje"),
    ("PECUARIO_RECOLECCIONES_DESTETE", "fecha_destete"),
    ("PECUARIO_SANIDAD_REGISTROS", "fecha"),
    ("PECUARIO_TRASLADOS", "fecha"),
    ("PECUARIO_TRATAMIENTOS", "fecha"),
    ("PECUARIO_VENTAS", "fecha_venta"),
    ("PECUARIO_VENTAS_SUBPRODUCTOS", "fecha"),
)

FIRMA_INSUMO = "public.fn_crear_insumo_con_stock_inicial(uuid,text,varchar,categoria_insumo,unidad_medida_insumo,numeric,boolean,text,timestamptz,numeric,uuid,uuid)"
# (firma, SECURITY DEFINER, proconfig) tal como estaban antes de la Migración 2
FUNCIONES_3 = (
    ("public.fn_cerrar_historial_macho_anterior()", True, "{search_path=public}"),
    (FIRMA_INSUMO, True, "{search_path=public}"),
    ("public.trg_resolver_retiro_macho_pendiente()", False, None),
)


def hoy_lima():
    return datetime.now(LIMA).date()


def _limpiar(sql: str) -> str:
    """Quita comentarios `--` y literales '...' (los mensajes de error citan CURRENT_DATE)."""
    sin_comentarios = "\n".join(re.sub(r"--.*$", "", linea) for linea in sql.splitlines())
    return re.sub(r"'(?:[^']|'')*'", "''", sin_comentarios)


def _sql(consulta: str) -> list:
    ultimo = ""
    for _ in range(4):
        p = subprocess.run([CLI, "db", "query", "--linked", consulta], capture_output=True, text=True,
                           encoding="utf-8", cwd=ROOT, timeout=120)
        salida = (p.stdout or "") + (p.stderr or "")
        ultimo = salida
        if "failed to initialise" in salida or "{" not in salida:
            time.sleep(3)
            continue
        cuerpo = salida[salida.index("{"): salida.rindex("}") + 1]
        return json.loads(re.sub(r",(\s*[\]}])", r"\1", cuerpo))["rows"]
    raise RuntimeError(f"supabase db query falló 4 veces: {ultimo[:300]}")


# =====================================================================
# a. ESTÁTICOS
# =====================================================================
class TestMigracion2Estatica(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8")
        cls.codigo = _limpiar(cls.sql)

    def test_a1_sin_current_date_ejecutable(self):
        self.assertIsNone(re.search(r"\bCURRENT_DATE\b", self.codigo, re.I))
        self.assertIsNone(re.search(r"now\(\)\s*::\s*date", self.codigo, re.I))

    def test_a2_quince_set_default_con_fn_hoy_operativo(self):
        encontrados = re.findall(
            r'ALTER TABLE public\."(PECUARIO_\w+)"\s+ALTER COLUMN (\w+)\s+SET DEFAULT public\.fn_hoy_operativo\(\);', self.codigo)
        self.assertEqual(len(encontrados), 15)
        self.assertEqual(sorted(encontrados), sorted(DEFAULTS_15))

    def test_a3_tres_funciones_y_una_vista(self):
        self.assertEqual(len(re.findall(r"CREATE OR REPLACE FUNCTION", self.codigo)), 3)
        self.assertEqual(len(re.findall(r"CREATE OR REPLACE VIEW", self.codigo)), 1)
        self.assertIn("CREATE OR REPLACE VIEW public.vw_pecuario_retiros_macho_pendientes AS", self.codigo)

    def test_a4_conserva_hotfix_y_atributos_de_las_funciones(self):
        self.assertIn("HOTFIX 2026-09-26", self.sql)
        self.assertIn("IF v_fecha_salida_actual = NEW.fecha_retiro_planificada THEN", self.codigo)
        bloques = re.findall(r"CREATE OR REPLACE FUNCTION public\.(\w+)\((.*?)\$fn\$;", self.codigo, re.S)
        por_nombre = {n: texto for n, texto in bloques}
        for nombre in ("fn_cerrar_historial_macho_anterior", "fn_crear_insumo_con_stock_inicial"):
            self.assertRegex(por_nombre[nombre], r"SECURITY DEFINER")
            self.assertRegex(por_nombre[nombre], r"SET search_path TO ''")  # literal 'public' colapsado
        cabecera = por_nombre["trg_resolver_retiro_macho_pendiente"].split("AS $fn$")[0]  # el cuerpo tiene UPDATE ... SET
        self.assertNotRegex(cabecera, r"SECURITY DEFINER")
        self.assertNotRegex(cabecera, r"\bSET\b")

    def test_a5_sin_grant_ni_revoke(self):
        self.assertIsNone(re.search(r"^\s*(GRANT|REVOKE)\b", self.codigo, re.M | re.I))

    def test_a6_empieza_con_begin_y_termina_con_commit(self):
        sentencias = [s.strip() for s in self.codigo.split(";") if s.strip()]
        self.assertEqual(sentencias[0].upper(), "BEGIN")
        self.assertEqual(sentencias[-1].upper(), "COMMIT")

    def test_a7_depende_de_la_migracion_1(self):
        self.assertIn("20261008100000", self.sql)
        self.assertIn("to_regprocedure('public.fn_hoy_operativo()') IS NULL", self.sql)


class TestReversa2Estatica(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = ROLLBACK.read_text(encoding="utf-8")
        cls.codigo = _limpiar(cls.sql)

    def test_advierte_que_reabre_el_desfase(self):
        self.assertIn("REABRE EL DESFASE UTC", self.sql)

    def test_15_defaults_3_funciones_1_vista_con_current_date_y_sin_grants(self):
        self.assertEqual(len(re.findall(r"SET DEFAULT CURRENT_DATE;", self.codigo)), 15)
        self.assertEqual(len(re.findall(r"CREATE OR REPLACE FUNCTION", self.codigo)), 3)
        self.assertEqual(len(re.findall(r"CREATE OR REPLACE VIEW", self.codigo)), 1)
        self.assertNotIn("fn_hoy_operativo", self.codigo)
        self.assertIsNone(re.search(r"^\s*(GRANT|REVOKE)\b", self.codigo, re.M | re.I))
        self.assertIn("HOTFIX 2026-09-26", self.sql)


# =====================================================================
# b. CATÁLOGO
# =====================================================================
@NEEDS_CLI
class TestMigracion2Catalogo(unittest.TestCase):
    def test_b1_defaults_pecuario(self):
        filas = _sql(
            "SELECT c.relname AS t, a.attname AS col, pg_get_expr(d.adbin, d.adrelid) AS def "
            "FROM pg_attrdef d JOIN pg_class c ON c.oid = d.adrelid JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum "
            "WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'PECUARIO\\_%' AND format_type(a.atttypid, a.atttypmod) = 'date'"
        )
        con_current = [f"{r['t']}.{r['col']}" for r in filas if "CURRENT_DATE" in r["def"].upper()]
        con_fn = sorted((r["t"], r["col"]) for r in filas if r["def"] == "fn_hoy_operativo()")
        self.assertEqual(con_current, [], "migración 20261008110000 no aplicada: quedan defaults CURRENT_DATE")
        self.assertEqual(len(con_fn), 15, f"se esperaban 15 defaults fn_hoy_operativo(); hay {len(con_fn)}")
        self.assertEqual(con_fn, sorted(DEFAULTS_15))

    def test_b2_funciones_sin_current_date_y_mismos_atributos(self):
        problemas = []
        for firma, definer, cfg in FUNCIONES_3:
            r = _sql(
                f"SELECT p.prosrc AS src, p.prosecdef AS sd, p.proconfig::text AS cfg FROM pg_proc p WHERE p.oid = to_regprocedure('{firma}')"
            )
            if not r:
                problemas.append(f"{firma}: no existe")
                continue
            f = r[0]
            if "CURRENT_DATE" in f["src"].upper():
                problemas.append(f"{firma}: aún usa CURRENT_DATE (migración 20261008110000 no aplicada)")
            if "fn_hoy_operativo" not in f["src"]:
                problemas.append(f"{firma}: no usa fn_hoy_operativo()")
            if f["sd"] is not definer:
                problemas.append(f"{firma}: prosecdef={f['sd']} (esperado {definer})")
            if f["cfg"] != cfg:
                problemas.append(f"{firma}: proconfig={f['cfg']} (esperado {cfg})")
        self.assertEqual(problemas, [], problemas)

    def test_b3_hotfix_y_triggers_siguen(self):
        src = _sql("SELECT prosrc AS src FROM pg_proc WHERE oid = to_regprocedure('public.trg_resolver_retiro_macho_pendiente()')")[0]["src"]
        self.assertIn("HOTFIX 2026-09-26", src)
        trig = {r["tgname"] for r in _sql(
            "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN "
            "('trg_resolver_retiro_macho_pendiente', 'trg_cerrar_historial_macho_anterior')")}
        self.assertEqual(trig, {"trg_resolver_retiro_macho_pendiente", "trg_cerrar_historial_macho_anterior"})

    def test_b4_vista_retiros_sin_current_date_y_columnas_iguales(self):
        r = _sql(
            "SELECT pg_get_viewdef('public.vw_pecuario_retiros_macho_pendientes'::regclass) AS def, "
            "(SELECT string_agg(attname, ',' ORDER BY attnum) FROM pg_attribute WHERE attrelid = 'public.vw_pecuario_retiros_macho_pendientes'::regclass AND attnum > 0 AND NOT attisdropped) AS cols"
        )[0]
        self.assertNotIn("CURRENT_DATE", r["def"].upper(), "migración 20261008110000 no aplicada")
        self.assertIn("fn_hoy_operativo", r["def"])
        self.assertEqual(r["cols"], "id,ID_Organizacion,macho_id,macho_codigo_arete,jaula_id,jaula_codigo_poza,fecha_retiro_planificada,resuelta,resuelta_en,estado")


# =====================================================================
# c. COMPORTAMIENTO en GRANJA-TEST
# =====================================================================
@NEEDS_SUPABASE
class TestMigracion2Comportamiento(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        res = httpx.get(f"{SUPABASE_URL}/rest/v1/ORGANIZACIONES", headers=cls._h(),
                        params={"ID": f"eq.{ORG}", "select": "es_organizacion_prueba"}, timeout=30)
        res.raise_for_status()
        filas = res.json()
        if not filas or filas[0].get("es_organizacion_prueba") is not True:
            raise unittest.SkipTest(f"{ORG} no es una organización de prueba: no se siembra")
        ok = httpx.post(f"{SUPABASE_URL}/rest/v1/rpc/fn_hoy_operativo", headers={**cls._h(), "Content-Type": "application/json"}, json={}, timeout=30)
        if ok.status_code != 200:
            raise unittest.SkipTest("migración 20261008100000 no aplicada")
        lima = datetime.now(timezone.utc).astimezone(LIMA)
        print(f"\n[huso2] UTC={datetime.now(timezone.utc):%Y-%m-%d %H:%M} | Lima={lima:%Y-%m-%d %H:%M} | "
              f"ventana 19:00-24:00 Lima (c. discrimina el default antiguo): {'SI' if lima.hour >= 19 else 'NO'}")

    @staticmethod
    def _h():
        return {"apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"}

    def setUp(self):
        self.sfx = str(int(time.time() * 1000))
        self._cleanup = []

    def tearDown(self):
        for tabla, campo, valor in reversed(self._cleanup):
            httpx.delete(f"{SUPABASE_URL}/rest/v1/{tabla}", headers=self._h(), params={campo: f"eq.{valor}"}, timeout=30)
        restos = []
        for tabla, campo, valor in self._cleanup:
            r = httpx.get(f"{SUPABASE_URL}/rest/v1/{tabla}", headers=self._h(), params={campo: f"eq.{valor}", "select": campo}, timeout=30)
            if r.status_code == 200 and r.json():
                restos.append((tabla, valor))
        self.assertEqual(restos, [], f"limpieza incompleta en {ORG}: {restos}")

    def _post(self, tabla, payload):
        assert payload["ID_Organizacion"] == ORG, "la siembra solo es válida en GRANJA-TEST"
        res = httpx.post(f"{SUPABASE_URL}/rest/v1/{tabla}", headers={**self._h(), "Content-Type": "application/json", "Prefer": "return=representation"},
                         json=payload, timeout=30)
        res.raise_for_status()
        fila = res.json()[0]
        self._cleanup.append((tabla, "id", fila["id"]))
        return fila

    def _cod(self):
        return f"TEST-HUSO2-{self.sfx}-{len(self._cleanup)}"

    def _fechas_validas(self, antes):
        """Hoy de Lima antes y después (por si la corrida cruza la medianoche de Lima)."""
        return {antes.isoformat(), hoy_lima().isoformat()}

    def test_c1_parto_y_lote_sin_fecha_reciben_hoy_de_lima(self):
        antes = hoy_lima()
        jaula = self._post("PECUARIO_JAULAS", {"ID_Organizacion": ORG, "codigo_poza": self._cod()})
        parto = self._post("PECUARIO_PARTOS", {"ID_Organizacion": ORG, "poza_id": jaula["id"], "n_vivos": 2})
        lote = self._post("PECUARIO_LOTES", {"ID_Organizacion": ORG, "codigo_lote": self._cod(), "poza_actual_id": jaula["id"],
                                             "cantidad_inicial": 3, "cantidad_actual": 3})
        validas = self._fechas_validas(antes)
        self.assertIn(parto["fecha_parto"], validas, f"fecha_parto={parto['fecha_parto']} no es hoy de Lima {validas}")
        self.assertIn(lote["fecha_destete"], validas, f"fecha_destete={lote['fecha_destete']} no es hoy de Lima {validas}")

    def test_c2_stock_inicial_de_insumo_usa_hoy_de_lima(self):
        antes = hoy_lima()
        insumo, mov = str(uuid.uuid4()), str(uuid.uuid4())
        self._cleanup.append(("PECUARIO_INSUMOS", "id", insumo))            # se borra al final (LIFO)
        self._cleanup.append(("PECUARIO_INSUMOS_MOVIMIENTOS", "id", mov))   # antes que el insumo
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/rpc/fn_crear_insumo_con_stock_inicial",
            headers={**self._h(), "Content-Type": "application/json"},
            json={"p_insumo_id": insumo, "p_id_organizacion": ORG, "p_nombre": self._cod(), "p_categoria": "alimento",
                  "p_unidad_medida": "kg", "p_stock_minimo": 1, "p_activo": True, "p_device_id": None,
                  "p_created_offline_at": None, "p_stock_inicial": 5, "p_movimiento_id": mov, "p_galpon_id": None},
            timeout=30,
        )
        self.assertIn(res.status_code, (200, 204), res.text)
        fila = httpx.get(f"{SUPABASE_URL}/rest/v1/PECUARIO_INSUMOS_MOVIMIENTOS", headers=self._h(),
                         params={"id": f"eq.{mov}", "select": "fecha,tipo_movimiento"}, timeout=30).json()
        self.assertEqual(len(fila), 1, "la RPC no creó el movimiento de entrada inicial")
        self.assertEqual(fila[0]["tipo_movimiento"], "entrada")
        validas = self._fechas_validas(antes)
        self.assertIn(fila[0]["fecha"], validas, f"fecha del movimiento {fila[0]['fecha']} no es hoy de Lima {validas}")
