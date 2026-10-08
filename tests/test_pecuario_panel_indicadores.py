"""
Test de integración para el Panel de indicadores real (ítem 10 del
roadmap Pecuario, el último): 10 vistas de solo lectura — Ganancia
diaria/FCR a 3 niveles (lote/galpón/granja), reproductivos, sanitarios,
productivos y comerciales — que reemplazan los números de ejemplo del
simulador.

Ver supabase/migrations/20260928090000_pecuario_panel_indicadores_vistas.sql
(specs/pecuario_panel_indicadores.md referenciada, no existe en este
repo -- mismo hallazgo recurrente de toda esta ronda, no se fabrica).
No hay contrato Zod ni Server Action que probar -- son vistas de solo
lectura, mismo criterio ya confirmado en el ítem 9 §10.9 y en la
migración de Población (20260924110000): JS plano, sin capa de
aplicación de Pecuario en este repo.

Siembra SOLO en la organización de prueba dedicada ORG-TEST-PANEL
(migración 20261009090000, es_organizacion_prueba=true; ya no toca la
organización real GRANJA-VALENCIA). setUpClass aborta toda la suite si esa
fila no existe o no está marcada como de prueba. Todas las filas son
descartables, con prefijo TEST-PANEL-, creadas y borradas dentro de cada
test: cada DELETE filtra por id (UUID propio) Y por ID_Organizacion, se
verifica el código de respuesta, y al final de la clase se comprueba que
ORG-TEST-PANEL quedó sin residuos. El aislamiento cruzado usa ORG-TEST-DEMO.

Casos agregados (los 4 bloques de reproductivo/sanitario/productivo/
comercial, y algunos reproductivos) leen antes y después de insertar
(patrón delta), en vez de asumir un valor absoluto -- estas vistas
agregan TODOS los datos reales de la organización en la ventana de
tiempo correspondiente (mes calendario actual / ventana rolling 12
meses), así que pueden convivir con datos de otros tests corridos el
mismo día/mes. Los 6 casos de control de FCR/ganancia diaria (Bloque A)
sí usan valores exactos -- cada uno crea su propio lote aislado, sin
esa ambigüedad.

La migración NO se aplica desde este archivo ni desde ningún script de
este repo -- ninguna migración SQL se aplica automáticamente contra la
base real (system prompt / docs/RYZOS_ORQUESTADOR_V3.1.md §4.1.4). Este
archivo verifica el contenido estático de la migración siempre, y sus
casos en vivo solo cuando las 10 vistas ya existen (aplicadas a mano en
Supabase Studio) -- `unittest.SkipTest` explícito en caso contrario,
sin fallar la suite.
"""

import os
import time
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase" / "migrations" / "20260928090000_pecuario_panel_indicadores_vistas.sql"
)

VIEWS = [
    "vw_pecuario_seguimiento_lote",
    "vw_pecuario_seguimiento_galpon",
    "vw_pecuario_seguimiento_granja",
    "vw_pecuario_reproduccion_mes",
    "vw_pecuario_intervalo_partos",
    "vw_pecuario_reemplazo_reproductoras_anual",
    "vw_pecuario_indicadores_sanitarios_mes",
    "vw_pecuario_incidencia_patologias",
    "vw_pecuario_pesos_promedio_mes",
    "vw_pecuario_ventas_mes",
]

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

NEEDS_SUPABASE = pytest.mark.skipif(
    not SUPABASE_URL or not SUPABASE_ANON_KEY or not SUPABASE_SERVICE_ROLE_KEY,
    reason="SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY no configuradas — test requiere Supabase Live",
)

ORG_A = "ORG-TEST-PANEL"      # organización de prueba dedicada (es_organizacion_prueba=true), vacía
ORG_B = "ORG-TEST-DEMO"       # "otra organización" para el aislamiento cruzado
ADMIN_EMAIL = "admin-demo@ryzos-demo.test"  # cuenta admin de ORG_B, ya usada en el resto de la suite

TODAY = datetime.now(ZoneInfo("America/Lima")).date()  # hoy operativo (Lima), igual que fn_hoy_operativo() en las vistas


def _service_headers():
    return {"apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"}


def _session_headers(access_token):
    return {"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {access_token}"}


def _magic_link_access_token(email: str) -> str:
    gen = httpx.post(
        f"{SUPABASE_URL}/auth/v1/admin/generate_link",
        headers={"apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"},
        json={"type": "magiclink", "email": email},
        timeout=30,
    )
    gen.raise_for_status()
    gen_json = gen.json()
    hashed_token = (gen_json.get("properties") or {}).get("hashed_token") or gen_json.get("hashed_token")
    verify = httpx.post(
        f"{SUPABASE_URL}/auth/v1/verify",
        headers={"apikey": SUPABASE_ANON_KEY},
        json={"type": "magiclink", "token_hash": hashed_token},
        timeout=30,
    )
    verify.raise_for_status()
    return verify.json()["access_token"]


# Tablas con una columna de código donde el test pone la marca TEST-PANEL-... (verificación de residuos).
TABLAS_CON_CODIGO = [
    ("PECUARIO_GALPONES", "codigo_galpon"),
    ("PECUARIO_JAULAS", "codigo_poza"),
    ("PECUARIO_LOTES", "codigo_lote"),
    ("PECUARIO_INSUMOS", "nombre"),
    ("PECUARIO_REPRODUCTORES", "codigo_arete"),
]
# Todas las tablas donde el test (o sus triggers) pueden escribir; ORG-TEST-PANEL es dedicada: debe quedar vacía.
TABLAS_SEMBRADAS = [
    "PECUARIO_VENTAS", "PECUARIO_MORTALIDAD", "PECUARIO_PARTOS", "PECUARIO_PESAJES",
    "PECUARIO_INSUMOS_MOVIMIENTOS", "PECUARIO_RECOLECCION_PARTOS", "PECUARIO_RECOLECCIONES_DESTETE",
    "PECUARIO_SUGERENCIAS_REEMPLAZO", "PECUARIO_LOTES", "PECUARIO_JAULAS", "PECUARIO_GALPONES",
    "PECUARIO_INSUMOS", "PECUARIO_REPRODUCTORES",
]


def _contar(tabla, params):
    res = httpx.get(
        f"{SUPABASE_URL}/rest/v1/{tabla}", headers={**_service_headers(), "Prefer": "count=exact"},
        params={**params, "select": "id", "limit": 1}, timeout=30,
    )
    res.raise_for_status()
    return int(res.headers["content-range"].split("/")[-1])


def _migracion_aplicada():
    try:
        for vista in VIEWS:
            res = httpx.get(
                f"{SUPABASE_URL}/rest/v1/{vista}",
                headers=_service_headers(), params={"select": "*", "limit": 1}, timeout=15,
            )
            if res.status_code != 200:
                return False
    except Exception:
        return False
    return True


class TestMigrationFileStatic(unittest.TestCase):
    """No requiere Supabase Live -- verifica el contenido de la migración
    en disco, siempre corre."""

    @classmethod
    def setUpClass(cls):
        if not MIGRATION_PATH.exists():
            raise AssertionError(f"No existe {MIGRATION_PATH}")
        cls.sql = MIGRATION_PATH.read_text(encoding="utf-8")

    def test_las_10_vistas_creadas_idempotentes(self):
        for vista in VIEWS:
            with self.subTest(vista=vista):
                self.assertIn(f"CREATE OR REPLACE VIEW public.{vista}", self.sql)
                self.assertIn(f"GRANT SELECT ON public.{vista} TO authenticated", self.sql)

    def test_sin_tablas_ni_triggers_ni_check_nuevos(self):
        self.assertNotIn("CREATE TABLE", self.sql)
        self.assertNotIn("CREATE TRIGGER", self.sql)
        self.assertNotIn("ADD CONSTRAINT", self.sql)
        self.assertNotIn("ENABLE ROW LEVEL SECURITY", self.sql)

    def test_filtro_organizacion_escrito_a_mano_en_cada_vista(self):
        # 8 de las 10, no 10 -- vw_pecuario_seguimiento_galpon/_granja
        # agregan sobre vw_pecuario_seguimiento_lote (que ya filtra por
        # organización), así que no repiten su propio filtro.
        self.assertEqual(self.sql.count("= public.auth_org_id() OR auth.role() = 'service_role'"), 8)

    def test_fcr_usa_cantidad_actual_en_vivo_no_snapshot(self):
        lote_start = self.sql.index("CREATE OR REPLACE VIEW public.vw_pecuario_seguimiento_lote")
        lote_end = self.sql.index("COMMENT ON VIEW public.vw_pecuario_seguimiento_lote")
        cuerpo = self.sql[lote_start:lote_end]
        self.assertIn("l.cantidad_actual", cuerpo)

    def test_solo_suma_alimento_en_kg(self):
        # unidad_medida es un ENUM real (unidad_medida_insumo) -- ILIKE
        # exige el cast a texto, hallazgo real al aplicar en Studio
        # (2026-09-28, ver AI_STATE.md).
        self.assertIn("i.unidad_medida::text ILIKE 'kg'", self.sql)

    def test_agregacion_pooled_no_promedio_de_promedios(self):
        galpon_start = self.sql.index("CREATE OR REPLACE VIEW public.vw_pecuario_seguimiento_galpon")
        galpon_end = self.sql.index("COMMENT ON VIEW public.vw_pecuario_seguimiento_galpon")
        cuerpo = self.sql[galpon_start:galpon_end]
        self.assertIn("SUM(s.cantidad_actual * s.dias_periodo)", cuerpo)
        self.assertNotIn("AVG(", cuerpo)

    def test_preflight_exige_dependencias(self):
        self.assertIn('to_regclass(\'public."PECUARIO_LOTES"\')', self.sql)
        self.assertIn('to_regclass(\'public."PECUARIO_PESAJES"\')', self.sql)
        self.assertIn("to_regclass('public.vw_pecuario_poblacion_resumen')", self.sql)
        self.assertIn("proname = 'auth_org_id'", self.sql)

    def test_reemplazo_reproductoras_solo_hembras(self):
        reemplazo_start = self.sql.index("CREATE OR REPLACE VIEW public.vw_pecuario_reemplazo_reproductoras_anual")
        reemplazo_end = self.sql.index("COMMENT ON VIEW public.vw_pecuario_reemplazo_reproductoras_anual")
        cuerpo = self.sql[reemplazo_start:reemplazo_end]
        # bajas_mortalidad, bajas_venta, altas y activas -- las 4 CTEs.
        self.assertEqual(cuerpo.count("sexo = 'hembra'"), 4)


@NEEDS_SUPABASE
class TestPanelIndicadoresLive(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not _migracion_aplicada():
            raise unittest.SkipTest(
                "Alguna de las 10 vistas del Panel de indicadores no existe todavía -- "
                "20260928090000_pecuario_panel_indicadores_vistas.sql no aplicada "
                "(aplicación manual pendiente, ver §4.1.4)."
            )
        # Guarda anti-error: este test jamás debe sembrar en una organización real.
        org = httpx.get(
            f"{SUPABASE_URL}/rest/v1/ORGANIZACIONES", headers=_service_headers(),
            params={"ID": f"eq.{ORG_A}", "select": "ID,es_organizacion_prueba"}, timeout=30,
        )
        org.raise_for_status()
        filas = org.json()
        if not filas:
            raise AssertionError(f"{ORG_A} no existe en ORGANIZACIONES (migración 20261009090000 no aplicada): se aborta la suite sin sembrar nada.")
        if filas[0].get("es_organizacion_prueba") is not True:
            raise AssertionError(f"{ORG_A} NO está marcada es_organizacion_prueba=true: se aborta la suite, jamás se siembra en una organización real.")
        cls.otra_org_token = _magic_link_access_token(ADMIN_EMAIL)

    @classmethod
    def tearDownClass(cls):
        # (c) La organización es dedicada: no debe quedar nada. Marca TEST-PANEL% en las tablas con código
        # y conteo total por organización en el resto (partos, mortalidad, ventas, pesajes, ...).
        residuos = []
        for tabla, col in TABLAS_CON_CODIGO:
            n = _contar(tabla, {"ID_Organizacion": f"eq.{ORG_A}", col: "like.TEST-PANEL%"})
            if n:
                residuos.append(f"{tabla}.{col} LIKE 'TEST-PANEL%': {n}")
        for tabla in TABLAS_SEMBRADAS:
            n = _contar(tabla, {"ID_Organizacion": f"eq.{ORG_A}"})
            if n:
                residuos.append(f"{tabla} (cualquier fila de {ORG_A}): {n}")
        if residuos:
            raise AssertionError(f"Residuos en {ORG_A} tras la suite: {residuos}")

    def setUp(self):
        self.suffix = str(int(time.time() * 1000))
        self._cleanup = []  # list of (table, field, value), LIFO en tearDown

    def tearDown(self):
        # (a) filtra por id (UUID propio) Y por ID_Organizacion; (b) un borrado rechazado (FK u otro) hace fallar el test.
        rechazados = []
        for table, field, value in reversed(self._cleanup):
            res = httpx.delete(
                f"{SUPABASE_URL}/rest/v1/{table}", headers=_service_headers(),
                params={field: f"eq.{value}", "ID_Organizacion": f"eq.{ORG_A}"}, timeout=30,
            )
            if res.status_code not in (200, 204):
                rechazados.append(f"{table} {field}={value}: HTTP {res.status_code} {res.text[:160]}")
        if rechazados:
            self.fail(f"Borrado rechazado en la limpieza ({ORG_A}): {rechazados}")

    # ---- Helpers de creación (service role) ----

    def _crear_galpon(self, org=ORG_A):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_GALPONES",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": org, "codigo_galpon": f"TEST-PANEL-{self.suffix}-{len(self._cleanup)}"},
            timeout=30,
        )
        res.raise_for_status()
        galpon_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_GALPONES", "id", galpon_id))
        return galpon_id

    def _crear_jaula(self, org=ORG_A, galpon_id=None):
        payload = {"ID_Organizacion": org, "codigo_poza": f"TEST-PANEL-{self.suffix}-{len(self._cleanup)}"}
        if galpon_id is not None:
            payload["galpon_id"] = galpon_id
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_JAULAS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json=payload, timeout=30,
        )
        res.raise_for_status()
        jaula_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_JAULAS", "id", jaula_id))
        return jaula_id

    def _crear_lote(self, poza_id, cantidad, org=ORG_A, recoleccion_origen_id=None, fecha_destete=None, sexo=None):
        payload = {
            "ID_Organizacion": org, "codigo_lote": f"TEST-PANEL-{self.suffix}-{len(self._cleanup)}",
            "poza_actual_id": poza_id, "cantidad_inicial": cantidad, "cantidad_actual": cantidad,
        }
        if recoleccion_origen_id is not None:
            payload["recoleccion_origen_id"] = recoleccion_origen_id
            payload["sexo"] = sexo or "macho"
        if fecha_destete is not None:
            payload["fecha_destete"] = fecha_destete.isoformat()
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_LOTES",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json=payload, timeout=30,
        )
        res.raise_for_status()
        lote_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_LOTES", "id", lote_id))
        return lote_id

    def _crear_recoleccion(self, org=ORG_A):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_RECOLECCIONES_DESTETE",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": org},
            timeout=30,
        )
        res.raise_for_status()
        recoleccion_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_RECOLECCIONES_DESTETE", "id", recoleccion_id))
        return recoleccion_id

    def _recolectar_parto(self, recoleccion_id, parto_id, org=ORG_A):
        # Mismo flujo real de Destete (ítem 6) -- trg_conformar_lote_destete
        # rechaza un lote cuya cantidad_inicial supere el remanente
        # disponible de la recolección, así que hay que recolectar un
        # parto real antes de poder conformar un lote desde ella.
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_RECOLECCION_PARTOS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": org, "recoleccion_id": recoleccion_id, "parto_id": parto_id},
            timeout=30,
        )
        res.raise_for_status()
        recoleccion_parto_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_RECOLECCION_PARTOS", "id", recoleccion_parto_id))
        return recoleccion_parto_id

    def _actualizar_cantidad_actual(self, lote_id, nueva_cantidad):
        res = httpx.patch(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_LOTES",
            headers={**_service_headers(), "Content-Type": "application/json"},
            params={"id": f"eq.{lote_id}", "ID_Organizacion": f"eq.{ORG_A}"},
            json={"cantidad_actual": nueva_cantidad},
            timeout=30,
        )
        res.raise_for_status()

    def _crear_pesaje(self, lote_id, fecha_pesaje, animales_muestreados, peso_total_muestra_g, org=ORG_A):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_PESAJES",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={
                "ID_Organizacion": org, "lote_id": lote_id, "fecha_pesaje": fecha_pesaje.isoformat(),
                "animales_muestreados": animales_muestreados, "peso_total_muestra_g": peso_total_muestra_g,
            },
            timeout=30,
        )
        res.raise_for_status()
        pesaje_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_PESAJES", "id", pesaje_id))
        return pesaje_id

    def _crear_insumo(self, categoria, unidad_medida, org=ORG_A):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_INSUMOS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": org, "nombre": f"TEST-PANEL-{self.suffix}-{len(self._cleanup)}", "categoria": categoria, "unidad_medida": unidad_medida},
            timeout=30,
        )
        res.raise_for_status()
        insumo_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_INSUMOS", "id", insumo_id))
        return insumo_id

    def _crear_movimiento(self, insumo_id, lote_id, cantidad, fecha, tipo_movimiento="salida", org=ORG_A):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_INSUMOS_MOVIMIENTOS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={
                "ID_Organizacion": org, "insumo_id": insumo_id, "lote_id": lote_id,
                "cantidad": cantidad, "fecha": fecha.isoformat(), "tipo_movimiento": tipo_movimiento,
            },
            timeout=30,
        )
        res.raise_for_status()
        mov_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_INSUMOS_MOVIMIENTOS", "id", mov_id))
        return mov_id

    def _crear_parto(self, poza_id, n_vivos, org=ORG_A, madre_id=None, fecha_parto=None, peso_total_camada_g=None):
        payload = {"ID_Organizacion": org, "poza_id": poza_id, "n_vivos": n_vivos}
        if madre_id is not None:
            payload["madre_id"] = madre_id
        if fecha_parto is not None:
            payload["fecha_parto"] = fecha_parto.isoformat()
        if peso_total_camada_g is not None:
            payload["peso_total_camada_g"] = peso_total_camada_g
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_PARTOS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json=payload, timeout=30,
        )
        res.raise_for_status()
        parto_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_PARTOS", "id", parto_id))
        return parto_id

    def _crear_reproductor(self, sexo, org=ORG_A, estado="activo"):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_REPRODUCTORES",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": org, "codigo_arete": f"TEST-PANEL-{self.suffix}-{len(self._cleanup)}", "sexo": sexo, "estado": estado},
            timeout=30,
        )
        res.raise_for_status()
        animal_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_REPRODUCTORES", "id", animal_id))
        return animal_id

    def _crear_mortalidad(self, poza_id, etapa, cantidad, org=ORG_A, causa=None, fecha_evento=None, animal_id=None):
        payload = {"ID_Organizacion": org, "poza_id": poza_id, "etapa": etapa, "cantidad": cantidad}
        if causa is not None:
            payload["causa"] = causa
        if fecha_evento is not None:
            payload["fecha_evento"] = fecha_evento.isoformat()
        if animal_id is not None:
            payload["animal_id"] = animal_id
            payload["poza_id"] = None
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_MORTALIDAD",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json=payload, timeout=30,
        )
        res.raise_for_status()
        mort_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_MORTALIDAD", "id", mort_id))
        return mort_id

    def _crear_venta_lote(self, lote_id, cantidad, precio_total, org=ORG_A, tipo_salida="carne", peso_total_kg=None, fecha_venta=None):
        payload = {"ID_Organizacion": org, "lote_id": lote_id, "cantidad": cantidad, "precio_total": precio_total, "tipo_salida": tipo_salida}
        if peso_total_kg is not None:
            payload["peso_total_kg"] = peso_total_kg
        if fecha_venta is not None:
            payload["fecha_venta"] = fecha_venta.isoformat()
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_VENTAS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json=payload, timeout=30,
        )
        res.raise_for_status()
        venta_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_VENTAS", "id", venta_id))
        return res.json()[0]

    def _crear_venta_animal(self, animal_id, cantidad, precio_total, org=ORG_A, tipo_salida="reproductor_saca", fecha_venta=None):
        payload = {"ID_Organizacion": org, "animal_id": animal_id, "cantidad": cantidad, "precio_total": precio_total, "tipo_salida": tipo_salida}
        if fecha_venta is not None:
            payload["fecha_venta"] = fecha_venta.isoformat()
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_VENTAS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json=payload, timeout=30,
        )
        res.raise_for_status()
        venta_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_VENTAS", "id", venta_id))
        return res.json()[0]

    def _crear_venta_pelado(self, lote_id, cantidad, peso_total_kg, peso_vivo_pre_beneficio_kg, precio_kg, precio_total, org=ORG_A):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_VENTAS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={
                "ID_Organizacion": org, "lote_id": lote_id, "cantidad": cantidad, "tipo_salida": "pelado_beneficiado",
                "base_precio": "por_kg", "peso_total_kg": peso_total_kg, "peso_vivo_pre_beneficio_kg": peso_vivo_pre_beneficio_kg,
                "precio_kg": precio_kg, "precio_total": precio_total,
            },
            timeout=30,
        )
        res.raise_for_status()
        venta_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_VENTAS", "id", venta_id))
        return res.json()[0]

    # ---- Helpers de lectura ----

    def _get_seguimiento_lote(self, lote_id):
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/vw_pecuario_seguimiento_lote", headers=_service_headers(),
            params={"lote_id": f"eq.{lote_id}"}, timeout=30,
        )
        res.raise_for_status()
        rows = res.json()
        self.assertEqual(len(rows), 1)
        return rows[0]

    def _get_view_org(self, vista, org=ORG_A):
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/{vista}", headers=_service_headers(),
            params={"ID_Organizacion": f"eq.{org}"}, timeout=30,
        )
        res.raise_for_status()
        return res.json()

    def _get_row_org(self, vista, org=ORG_A):
        rows = self._get_view_org(vista, org)
        return rows[0] if rows else {}

    # =====================================================================
    # Bloque A — los 6 casos de control de FCR/ganancia diaria
    # =====================================================================

    def test_caso1_un_solo_pesaje_no_calcula_nada(self):
        jaula = self._crear_jaula()
        lote = self._crear_lote(jaula, cantidad=100)
        self._crear_pesaje(lote, TODAY - timedelta(days=10), animales_muestreados=5, peso_total_muestra_g=2500)  # 500g promedio

        row = self._get_seguimiento_lote(lote)
        self.assertIsNone(row["dias_periodo"])
        self.assertIsNone(row["ganancia_diaria_g"])
        self.assertIsNone(row["fcr"])
        self.assertFalse(row["datos_suficientes"])

    def test_caso2_dos_pesajes_sin_alimento_en_rango_calcula_ganancia_no_fcr(self):
        jaula = self._crear_jaula()
        lote = self._crear_lote(jaula, cantidad=100)
        self._crear_pesaje(lote, TODAY - timedelta(days=10), animales_muestreados=5, peso_total_muestra_g=2500)  # 500g
        self._crear_pesaje(lote, TODAY, animales_muestreados=5, peso_total_muestra_g=3000)  # 600g

        row = self._get_seguimiento_lote(lote)
        self.assertEqual(row["dias_periodo"], 10)
        self.assertEqual(float(row["ganancia_diaria_g"]), 10.0)
        # La fórmula de fcr solo devuelve NULL cuando la ganancia es <= 0
        # -- sin alimento en el período, el numerador es 0 y fcr = 0.00
        # (no NULL). datos_suficientes=False es la señal real de "no
        # confíes en este número" -- el consumidor debe usarla, no un
        # fcr NULL que esta vista nunca produce por falta de alimento.
        self.assertEqual(float(row["fcr"]), 0.0)
        self.assertFalse(row["datos_suficientes"])

    def test_caso3_alimento_en_rango_calcula_fcr(self):
        jaula = self._crear_jaula()
        lote = self._crear_lote(jaula, cantidad=100)
        self._crear_pesaje(lote, TODAY - timedelta(days=10), animales_muestreados=5, peso_total_muestra_g=2500)  # 500g
        self._crear_pesaje(lote, TODAY, animales_muestreados=5, peso_total_muestra_g=3000)  # 600g
        alimento = self._crear_insumo("alimento", "kg")
        self._crear_movimiento(alimento, lote, cantidad=50, fecha=TODAY - timedelta(days=5))

        row = self._get_seguimiento_lote(lote)
        self.assertTrue(row["datos_suficientes"])
        self.assertEqual(float(row["ganancia_total_kg_periodo"]), 10.0)  # (600-500)/1000 * 100
        self.assertEqual(float(row["fcr"]), 5.0)  # 50kg alimento / 10kg ganancia

    def test_caso4_vender_parte_del_lote_sin_pesaje_nuevo_sube_el_fcr(self):
        jaula = self._crear_jaula()
        lote = self._crear_lote(jaula, cantidad=100)
        self._crear_pesaje(lote, TODAY - timedelta(days=10), animales_muestreados=5, peso_total_muestra_g=2500)  # 500g
        self._crear_pesaje(lote, TODAY, animales_muestreados=5, peso_total_muestra_g=3000)  # 600g
        alimento = self._crear_insumo("alimento", "kg")
        self._crear_movimiento(alimento, lote, cantidad=50, fecha=TODAY - timedelta(days=5))

        fcr_antes = float(self._get_seguimiento_lote(lote)["fcr"])
        self.assertEqual(fcr_antes, 5.0)

        # Venta/baja de la mitad del lote, SIN registrar ningún pesaje nuevo.
        self._actualizar_cantidad_actual(lote, 50)

        fcr_despues = float(self._get_seguimiento_lote(lote)["fcr"])
        self.assertEqual(fcr_despues, 10.0)  # 50kg alimento / 5kg ganancia (100->50 animales)
        self.assertGreater(fcr_despues, fcr_antes, "El FCR debe subir solo por el cambio de cantidad_actual, sin tocar ninguna fila -- confirma que no hay snapshot desactualizado.")

    def test_caso5_alimento_fuera_de_rango_no_suma(self):
        jaula = self._crear_jaula()
        lote = self._crear_lote(jaula, cantidad=100)
        self._crear_pesaje(lote, TODAY - timedelta(days=10), animales_muestreados=5, peso_total_muestra_g=2500)
        self._crear_pesaje(lote, TODAY, animales_muestreados=5, peso_total_muestra_g=3000)
        alimento = self._crear_insumo("alimento", "kg")
        self._crear_movimiento(alimento, lote, cantidad=999, fecha=TODAY - timedelta(days=20))  # antes de fecha_pesaje_anterior

        row = self._get_seguimiento_lote(lote)
        self.assertEqual(float(row["alimento_consumido_kg"]), 0.0)
        self.assertFalse(row["datos_suficientes"])

    def test_caso6_insumo_alimento_en_otra_unidad_no_suma(self):
        jaula = self._crear_jaula()
        lote = self._crear_lote(jaula, cantidad=100)
        self._crear_pesaje(lote, TODAY - timedelta(days=10), animales_muestreados=5, peso_total_muestra_g=2500)
        self._crear_pesaje(lote, TODAY, animales_muestreados=5, peso_total_muestra_g=3000)
        # unidad_medida es un ENUM real (unidad_medida_insumo: kg, g,
        # litro, ml, unidad, saco_50kg, saco_40kg) -- 'sacos' no es un
        # valor válido, hallazgo real al aplicar en Studio (ver
        # AI_STATE.md). saco_50kg sí lo es, y no es 'kg'.
        alimento_sacos = self._crear_insumo("alimento", "saco_50kg")
        self._crear_movimiento(alimento_sacos, lote, cantidad=999, fecha=TODAY - timedelta(days=5))

        row = self._get_seguimiento_lote(lote)
        self.assertEqual(float(row["alimento_consumido_kg"]), 0.0)
        self.assertFalse(row["datos_suficientes"])

    # ---- vw_pecuario_seguimiento_galpon / _granja: al menos un caso ----

    def test_seguimiento_galpon_y_granja_agregan_pooled(self):
        galpon = self._crear_galpon()
        jaula = self._crear_jaula(galpon_id=galpon)
        lote = self._crear_lote(jaula, cantidad=100)
        self._crear_pesaje(lote, TODAY - timedelta(days=10), animales_muestreados=5, peso_total_muestra_g=2500)
        self._crear_pesaje(lote, TODAY, animales_muestreados=5, peso_total_muestra_g=3000)
        alimento = self._crear_insumo("alimento", "kg")
        self._crear_movimiento(alimento, lote, cantidad=50, fecha=TODAY - timedelta(days=5))

        galpon_row = httpx.get(
            f"{SUPABASE_URL}/rest/v1/vw_pecuario_seguimiento_galpon", headers=_service_headers(),
            params={"galpon_id": f"eq.{galpon}"}, timeout=30,
        ).json()
        self.assertEqual(len(galpon_row), 1)
        self.assertEqual(float(galpon_row[0]["fcr_promedio"]), 5.0)

        granja_antes = self._get_row_org("vw_pecuario_seguimiento_granja")
        self.assertIsNotNone(granja_antes.get("fcr_promedio"))

    # =====================================================================
    # Bloque B — Reproductivos
    # =====================================================================

    def test_reproduccion_mes_suma_partos_y_crias_vivas(self):
        antes = self._get_row_org("vw_pecuario_reproduccion_mes")
        partos_antes = antes.get("partos_mes", 0) or 0
        crias_antes = antes.get("crias_vivas_total_mes", 0) or 0

        jaula = self._crear_jaula()
        self._crear_parto(jaula, n_vivos=8, fecha_parto=TODAY, peso_total_camada_g=1600)

        despues = self._get_row_org("vw_pecuario_reproduccion_mes")
        self.assertEqual(despues["partos_mes"], partos_antes + 1)
        self.assertEqual(despues["crias_vivas_total_mes"], crias_antes + 8)
        self.assertGreaterEqual(despues["partos_con_peso_registrado"], 1)

    def test_intervalo_partos_calcula_por_madre_identificada(self):
        antes = self._get_row_org("vw_pecuario_intervalo_partos")
        madres_antes = antes.get("madres_con_intervalo_calculado", 0) or 0

        jaula = self._crear_jaula()
        madre = self._crear_reproductor("hembra")
        self._crear_parto(jaula, n_vivos=6, madre_id=madre, fecha_parto=TODAY - timedelta(days=70))
        self._crear_parto(jaula, n_vivos=7, madre_id=madre, fecha_parto=TODAY)

        despues = self._get_row_org("vw_pecuario_intervalo_partos")
        self.assertEqual(despues["madres_con_intervalo_calculado"], madres_antes + 1)

    def test_reemplazo_reproductoras_cuenta_altas_y_bajas_de_hembras(self):
        # Hotfix 2026-09-28
        # (supabase/migrations/20260928110000_fix_pecuario_reemplazo_reproductoras_from.sql):
        # antes de este fix, una organización que vendía su ÚNICA hembra
        # activa desaparecía POR COMPLETO de esta vista (ver AI_STATE.md,
        # 2026-09-27) -- fn_dar_baja_animal_por_venta (trigger preexistente,
        # no de esta migración) le pone estado='vendido', sacándola de la
        # CTE `activas`, en la que el FROM de la vista estaba anclado. El
        # fix cambia el FROM para que la fila siga existiendo siempre, con
        # hembras_activas_actual=0 y tasa_reemplazo_pct NULL (división por
        # cero evitada con NULLIF -- nunca un 0% falso).
        antes = self._get_row_org("vw_pecuario_reemplazo_reproductoras_anual")
        altas_antes = antes.get("altas_hembras_12m", 0) or 0
        bajas_antes = antes.get("bajas_hembras_12m", 0) or 0
        activas_antes = antes.get("hembras_activas_actual", 0) or 0

        hembra = self._crear_reproductor("hembra")
        self._crear_venta_animal(hembra, cantidad=1, precio_total=50, tipo_salida="reproductor_saca")

        despues = self._get_row_org("vw_pecuario_reemplazo_reproductoras_anual")
        self.assertNotEqual(despues, {}, "La fila de la organización debe seguir existiendo aunque se venda la única hembra activa -- ese era exactamente el bug.")
        self.assertEqual(despues["altas_hembras_12m"], altas_antes + 1)
        self.assertEqual(despues["bajas_hembras_12m"], bajas_antes + 1)
        # Se agregó una hembra activa y se vendió la misma -- el neto de
        # hembras_activas_actual no cambia respecto al "antes".
        self.assertEqual(despues["hembras_activas_actual"], activas_antes)
        if activas_antes == 0:
            # Caso límite exacto del bug: si la organización no tenía
            # ninguna otra hembra activa, ahora queda en 0 -- la tasa debe
            # ser NULL, nunca una división por cero ni un 0% falso.
            self.assertIsNone(despues["tasa_reemplazo_pct"])

    # =====================================================================
    # Bloque C — Sanitarios
    # =====================================================================

    def test_indicadores_sanitarios_mes_suma_mortalidad_lactancia(self):
        antes = self._get_row_org("vw_pecuario_indicadores_sanitarios_mes")
        muertes_antes = antes.get("muertes_lactancia_mes", 0) or 0

        jaula = self._crear_jaula()
        self._crear_mortalidad(jaula, etapa="lactancia", cantidad=3, fecha_evento=TODAY)

        despues = self._get_row_org("vw_pecuario_indicadores_sanitarios_mes")
        self.assertEqual(despues["muertes_lactancia_mes"], muertes_antes + 3)

    def test_incidencia_patologias_agrupa_por_causa(self):
        jaula = self._crear_jaula()
        self._crear_mortalidad(jaula, etapa="recria", cantidad=2, causa="neumonia", fecha_evento=TODAY)

        rows = self._get_view_org("vw_pecuario_incidencia_patologias")
        fila_neumonia = next((r for r in rows if r["causa"] == "neumonia"), None)
        self.assertIsNotNone(fila_neumonia, "Debe existir una fila para causa='neumonia' este mes.")
        self.assertGreaterEqual(fila_neumonia["cantidad_mes"], 2)

    # =====================================================================
    # Bloque D — Productivo
    # =====================================================================

    def test_pesos_promedio_destete_mes(self):
        jaula_origen = self._crear_jaula()
        jaula_destino = self._crear_jaula()
        parto = self._crear_parto(jaula_origen, n_vivos=10, fecha_parto=TODAY)
        recoleccion = self._crear_recoleccion()
        self._recolectar_parto(recoleccion, parto)  # deja un remanente real de 10
        lote = self._crear_lote(jaula_destino, cantidad=10, recoleccion_origen_id=recoleccion, fecha_destete=TODAY, sexo="macho")
        self._crear_pesaje(lote, TODAY, animales_muestreados=5, peso_total_muestra_g=2500)  # 500g

        row = self._get_row_org("vw_pecuario_pesos_promedio_mes")
        self.assertIsNotNone(row.get("peso_promedio_destete_g_mes"))

    def test_pesos_promedio_engorde_actual(self):
        jaula = self._crear_jaula()
        # etapa_calculada = 'engorde' cuando fecha_destete tiene más de 56 días (vw_pecuario_lotes_etapa, ítem Etapa automática).
        lote = self._crear_lote(jaula, cantidad=10, fecha_destete=TODAY - timedelta(days=60))
        self._crear_pesaje(lote, TODAY, animales_muestreados=5, peso_total_muestra_g=6000)  # 1200g

        row = self._get_row_org("vw_pecuario_pesos_promedio_mes")
        self.assertIsNotNone(row.get("peso_promedio_engorde_g_actual"))

    # =====================================================================
    # Bloque E — Comercial
    # =====================================================================

    def test_ventas_mes_suma_cantidad_monto_y_kg(self):
        antes = self._get_row_org("vw_pecuario_ventas_mes")
        ventas_antes = antes.get("ventas_mes", 0) or 0
        monto_antes = float(antes.get("monto_total_mes", 0) or 0)
        kg_antes = float(antes.get("kg_vendidos_mes", 0) or 0)

        jaula = self._crear_jaula()
        lote = self._crear_lote(jaula, cantidad=20)
        self._crear_venta_lote(lote, cantidad=5, precio_total=100, peso_total_kg=10, fecha_venta=TODAY)

        despues = self._get_row_org("vw_pecuario_ventas_mes")
        self.assertEqual(despues["ventas_mes"], ventas_antes + 1)
        self.assertAlmostEqual(float(despues["monto_total_mes"]), monto_antes + 100, places=2)
        self.assertAlmostEqual(float(despues["kg_vendidos_mes"]), kg_antes + 10, places=2)

    def test_ventas_mes_rendimiento_carcasa_pelado_beneficiado(self):
        antes = self._get_row_org("vw_pecuario_ventas_mes")
        con_rendimiento_antes = antes.get("ventas_con_rendimiento_registrado", 0) or 0

        jaula = self._crear_jaula()
        lote = self._crear_lote(jaula, cantidad=5)
        venta = self._crear_venta_pelado(lote, cantidad=1, peso_total_kg=9, peso_vivo_pre_beneficio_kg=15, precio_kg=22, precio_total=198)
        self.assertEqual(float(venta["rendimiento_carcasa_pct"]), 60.0)  # generado por la DB, no-regresión de v9

        despues = self._get_row_org("vw_pecuario_ventas_mes")
        self.assertEqual(despues["ventas_con_rendimiento_registrado"], con_rendimiento_antes + 1)

    # =====================================================================
    # Aislamiento RLS cruzado obligatorio — las 10 vistas
    # =====================================================================

    def test_aislamiento_cruzado_las_10_vistas(self):
        # Datos reales en AMBAS organizaciones -- si ORG_A no tuviera
        # ninguna fila propia en alguna vista, la aserción de aislamiento
        # de esa vista sería una prueba vacía (un [] esperado que ya
        # daría [] aunque RLS no filtrara nada). Se crea aquí, en vez de
        # depender de que otro test haya dejado algo por casualidad.
        galpon_a = self._crear_galpon(org=ORG_A)  # vw_pecuario_seguimiento_galpon exige galpon_id IS NOT NULL
        jaula_a = self._crear_jaula(org=ORG_A, galpon_id=galpon_a)
        lote_a = self._crear_lote(jaula_a, cantidad=10, org=ORG_A)
        self._crear_pesaje(lote_a, TODAY - timedelta(days=10), animales_muestreados=5, peso_total_muestra_g=2500, org=ORG_A)
        self._crear_pesaje(lote_a, TODAY, animales_muestreados=5, peso_total_muestra_g=3000, org=ORG_A)
        alimento_a = self._crear_insumo("alimento", "kg", org=ORG_A)
        self._crear_movimiento(alimento_a, lote_a, cantidad=10, fecha=TODAY - timedelta(days=5), org=ORG_A)
        self._crear_parto(jaula_a, n_vivos=5, fecha_parto=TODAY, org=ORG_A)
        self._crear_mortalidad(jaula_a, etapa="lactancia", cantidad=1, causa="otro", fecha_evento=TODAY, org=ORG_A)
        self._crear_venta_lote(lote_a, cantidad=1, precio_total=20, org=ORG_A, fecha_venta=TODAY)
        self._crear_reproductor("hembra", org=ORG_A)

        for vista in VIEWS:
            with self.subTest(vista=vista):
                propia = httpx.get(
                    f"{SUPABASE_URL}/rest/v1/{vista}", headers=_service_headers(),
                    params={"ID_Organizacion": f"eq.{ORG_A}"}, timeout=30,
                )
                self.assertEqual(propia.status_code, 200)
                self.assertGreater(len(propia.json()), 0, f"{vista} debería tener al menos 1 fila propia de {ORG_A} para que el aislamiento de abajo sea una prueba real.")

        # Sesión real de ORG_B (autenticada) no puede ver filas de ORG_A
        # en ninguna de las 10 vistas.
        for vista in VIEWS:
            with self.subTest(vista=vista):
                cruzado = httpx.get(
                    f"{SUPABASE_URL}/rest/v1/{vista}",
                    headers=_session_headers(self.otra_org_token),
                    params={"ID_Organizacion": f"eq.{ORG_A}"}, timeout=30,
                )
                self.assertEqual(cruzado.status_code, 200)
                self.assertEqual(cruzado.json(), [], f"Una sesión de {ORG_B} no debe ver filas de {ORG_A} en {vista}.")


if __name__ == "__main__":
    unittest.main(verbosity=2)
