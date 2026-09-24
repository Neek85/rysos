"""
Test de integración para las 3 vistas de población real (ficha de poza +
KPIs de Inicio/Dashboard, Pecuario Cuyes):
- vw_pecuario_lactancia_restante
- vw_pecuario_ocupacion_poza
- vw_pecuario_poblacion_resumen

Ver supabase/migrations/20260924110000_pecuario_poblacion_vistas.sql
(specs/pecuario_ficha_poza_y_calculo_poblacion.md no existe en este
repo -- solo referenciada por la migración/el prompt, nunca comiteada;
mismo hallazgo recurrente que Compras/Guano/Mortalidad-fotos/Sanidad/
Traslado. La migración trae suficiente contexto en su propia cabecera
para verificar sin ella).

Esta migración es de SOLO LECTURA -- 3 vistas, sin tablas nuevas, sin
triggers, sin RLS de escritura nueva. No hay contrato Zod que verificar
(no hay ningún INSERT/UPDATE nuevo que validar contra estas vistas).

Usa la organización real GRANJA-VALENCIA (mismo criterio que
tests/test_pecuario_traslado_interno.py) para los casos de negocio --
todas las filas de estos tests son descartables, con prefijo TEST-,
creadas y borradas dentro de cada test. El aislamiento cruzado usa
ORG-TEST-DEMO como "otra organización".

La migración NO se aplica desde este archivo ni desde ningún script de
este repo -- ninguna migración SQL se aplica automáticamente contra la
base real (system prompt / docs/RYZOS_ORQUESTADOR_V3.1.md §4.1.4). Este
archivo verifica el contenido estático de la migración siempre, y sus
casos en vivo solo cuando las 3 vistas ya existen (aplicadas a mano en
Supabase Studio) -- `unittest.SkipTest` explícito en caso contrario, sin
fallar la suite.
"""

import os
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase" / "migrations" / "20260924110000_pecuario_poblacion_vistas.sql"
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

NEEDS_SUPABASE = pytest.mark.skipif(
    not SUPABASE_URL or not SUPABASE_ANON_KEY or not SUPABASE_SERVICE_ROLE_KEY,
    reason="SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY no configuradas — test requiere Supabase Live",
)

ORG_A = "GRANJA-VALENCIA"     # organización real, mismo criterio que Traslado
ORG_B = "ORG-TEST-DEMO"       # "otra organización" para el aislamiento cruzado
ADMIN_EMAIL = "admin-demo@ryzos-demo.test"  # cuenta admin de ORG_B, ya usada en el resto de la suite


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


def _migracion_aplicada():
    try:
        for vista in ("vw_pecuario_lactancia_restante", "vw_pecuario_ocupacion_poza", "vw_pecuario_poblacion_resumen"):
            res = httpx.get(
                f"{SUPABASE_URL}/rest/v1/{vista}",
                headers=_service_headers(), params={"select": "*", "limit": 1}, timeout=15,
            )
            if res.status_code != 200:
                return False
        # vw_pecuario_lactancia_restante fue REEMPLAZADA por
        # 20260925090000_pecuario_destete_recoleccion.sql (v12) -- 3 de los
        # tests de este archivo ejercitan el invariante de población a
        # través del flujo real de recolección/conformación (no vía
        # parto_origen_id directo, ver docs/schema_live_pecuario.md v11),
        # así que también dependen de que v12 ya esté aplicada.
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_RECOLECCIONES_DESTETE",
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

    def test_wrapped_in_transaction(self):
        self.assertIn("BEGIN;", self.sql)
        self.assertIn("COMMIT;", self.sql)

    def test_solo_lectura_sin_tablas_ni_triggers_nuevos(self):
        self.assertNotIn("CREATE TABLE", self.sql)
        self.assertNotIn("CREATE TRIGGER", self.sql)
        self.assertNotIn("ENABLE ROW LEVEL SECURITY", self.sql)

    def test_no_reproduce_camadas_lactancia_calcula_desde_partos(self):
        self.assertIn('FROM public."PECUARIO_PARTOS" p', self.sql)
        self.assertIn("l.parto_origen_id = p.id", self.sql)
        # CAMADAS_LACTANCIA aparece en comentarios explicando qué
        # reemplaza esta vista -- lo que no debe existir es una
        # referencia real (FROM/JOIN) a esa tabla.
        self.assertNotIn('FROM public."CAMADAS_LACTANCIA"', self.sql)
        self.assertNotIn('JOIN public."CAMADAS_LACTANCIA"', self.sql)

    def test_reutiliza_etapa_calculada_no_columna_cruda(self):
        self.assertIn("FROM public.vw_pecuario_lotes_etapa", self.sql)
        self.assertIn("etapa_calculada = 'recria'", self.sql)
        self.assertIn("etapa_calculada = 'engorde'", self.sql)

    def test_las_3_vistas_creadas_idempotentes(self):
        for vista in ("vw_pecuario_lactancia_restante", "vw_pecuario_ocupacion_poza", "vw_pecuario_poblacion_resumen"):
            with self.subTest(vista=vista):
                self.assertIn(f"CREATE OR REPLACE VIEW public.{vista}", self.sql)
                self.assertIn(f"GRANT SELECT ON public.{vista} TO authenticated", self.sql)

    def test_filtro_organizacion_escrito_a_mano_en_las_3(self):
        # "auth_org_id()" también aparece en el mensaje de RAISE EXCEPTION
        # del preflight -- se cuenta el patrón real del filtro WHERE, no
        # el nombre de la función a secas.
        self.assertEqual(self.sql.count("= public.auth_org_id() OR auth.role() = 'service_role'"), 3)

    def test_reproductor_enfermo_cuenta_vendido_muerto_no(self):
        # Solo 2 de las 3 vistas tocan PECUARIO_REPRODUCTORES
        # (vw_pecuario_lactancia_restante no tiene nada que ver con
        # reproductores) -- ocupación (por poza) y resumen (por org).
        self.assertEqual(self.sql.count("estado IN ('activo', 'enfermo')"), 2)

    def test_lactancia_resumen_descuenta_mortalidad_ocupacion_no(self):
        # La asimetría documentada a propósito: la vista de resumen (org)
        # sí resta mortalidad de lactancia; la de ocupación (por poza) no.
        self.assertIn("mortalidad_lactancia AS", self.sql)
        self.assertIn("GREATEST(COALESCE(lb.total, 0) - COALESCE(ml.total, 0), 0)", self.sql)
        ocupacion_start = self.sql.index("CREATE OR REPLACE VIEW public.vw_pecuario_ocupacion_poza")
        ocupacion_end = self.sql.index("CREATE OR REPLACE VIEW public.vw_pecuario_poblacion_resumen")
        self.assertNotIn("PECUARIO_MORTALIDAD", self.sql[ocupacion_start:ocupacion_end])

    def test_preflight_exige_dependencias(self):
        self.assertIn('to_regclass(\'public."PECUARIO_JAULAS"\')', self.sql)
        self.assertIn('to_regclass(\'public."PECUARIO_PARTOS"\')', self.sql)
        self.assertIn('to_regclass(\'public."PECUARIO_MORTALIDAD"\')', self.sql)
        self.assertIn("to_regclass('public.vw_pecuario_lotes_etapa')", self.sql)


@NEEDS_SUPABASE
class TestPoblacionVistasLive(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not _migracion_aplicada():
            raise unittest.SkipTest(
                "Alguna de las 3 vistas de población no existe todavía -- "
                "20260924110000_pecuario_poblacion_vistas.sql no aplicada "
                "(aplicación manual pendiente, ver §4.1.4)."
            )
        cls.otra_org_token = _magic_link_access_token(ADMIN_EMAIL)

    def setUp(self):
        self.suffix = str(int(time.time() * 1000))
        self._cleanup = []  # list of (table, field, value), LIFO en tearDown

    def tearDown(self):
        for table, field, value in reversed(self._cleanup):
            httpx.delete(f"{SUPABASE_URL}/rest/v1/{table}", headers=_service_headers(), params={field: f"eq.{value}"}, timeout=30)

    def _crear_jaula(self, capacidad_max=None, org=ORG_A):
        payload = {"ID_Organizacion": org, "codigo_poza": f"TEST-POBLACION-{self.suffix}-{len(self._cleanup)}"}
        if capacidad_max is not None:
            payload["capacidad_max"] = capacidad_max
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_JAULAS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json=payload, timeout=30,
        )
        res.raise_for_status()
        jaula_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_JAULAS", "id", jaula_id))
        return jaula_id

    def _crear_parto(self, poza_id, n_vivos, org=ORG_A):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_PARTOS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": org, "poza_id": poza_id, "n_vivos": n_vivos, "n_muertos": 0},
            timeout=30,
        )
        res.raise_for_status()
        parto_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_PARTOS", "id", parto_id))
        return parto_id

    def _crear_lote(self, poza_id, cantidad, parto_origen_id=None, etapa=None, fecha_destete=None, org=ORG_A):
        payload = {
            "ID_Organizacion": org, "codigo_lote": f"TEST-POBLACION-{self.suffix}-{len(self._cleanup)}",
            "poza_actual_id": poza_id, "cantidad_inicial": cantidad, "cantidad_actual": cantidad,
        }
        if parto_origen_id:
            payload["parto_origen_id"] = parto_origen_id
        if etapa:
            payload["etapa"] = etapa
        if fecha_destete:
            payload["fecha_destete"] = fecha_destete
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_LOTES",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json=payload, timeout=30,
        )
        res.raise_for_status()
        lote_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_LOTES", "id", lote_id))
        return lote_id

    def _crear_reproductor(self, jaula_id, sexo, estado="activo", org=ORG_A):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_REPRODUCTORES",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={
                "ID_Organizacion": org, "codigo_arete": f"TEST-POBLACION-{self.suffix}-{len(self._cleanup)}",
                "sexo": sexo, "estado": estado, "jaula_actual_id": jaula_id,
            },
            timeout=30,
        )
        res.raise_for_status()
        animal_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_REPRODUCTORES", "id", animal_id))
        return animal_id

    def _crear_mortalidad(self, poza_id, etapa, cantidad, org=ORG_A):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_MORTALIDAD",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={
                "ID_Organizacion": org, "poza_id": poza_id, "etapa": etapa,
                "cantidad": cantidad, "fecha_evento": datetime.now(timezone.utc).date().isoformat(),
            },
            timeout=30,
        )
        res.raise_for_status()
        mort_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_MORTALIDAD", "id", mort_id))
        return mort_id

    # ---- Recolección + conformación real (mismo flujo que
    #      tests/test_pecuario_destete_recoleccion.py, replicado fielmente
    #      -- confirmado por grep que ningún Server Action real usa
    #      parto_origen_id directo, así que estos 3 tests deben pasar por
    #      el flujo real en vez de setearlo a mano). ----

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

    def _conformar_lote_destete(self, recoleccion_id, poza_id, sexo, cantidad, org=ORG_A):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_LOTES",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={
                "ID_Organizacion": org, "codigo_lote": f"TEST-POBLACION-DESTETE-{self.suffix}-{len(self._cleanup)}",
                "recoleccion_origen_id": recoleccion_id, "poza_actual_id": poza_id,
                "sexo": sexo, "cantidad_inicial": cantidad, "cantidad_actual": cantidad,
            },
            timeout=30,
        )
        res.raise_for_status()
        lote_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_LOTES", "id", lote_id))
        return lote_id

    def _get_recoleccion_estado(self, recoleccion_id):
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/vw_pecuario_recolecciones_destete", headers=_service_headers(),
            params={"id": f"eq.{recoleccion_id}"}, timeout=30,
        )
        res.raise_for_status()
        rows = res.json()
        self.assertEqual(len(rows), 1)
        return rows[0]

    def _get_lactancia_por_parto(self, parto_id):
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/vw_pecuario_lactancia_restante", headers=_service_headers(),
            params={"parto_id": f"eq.{parto_id}"}, timeout=30,
        )
        res.raise_for_status()
        return res.json()

    def _get_ocupacion_poza(self, jaula_id):
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/vw_pecuario_ocupacion_poza", headers=_service_headers(),
            params={"id": f"eq.{jaula_id}"}, timeout=30,
        )
        res.raise_for_status()
        rows = res.json()
        self.assertEqual(len(rows), 1)
        return rows[0]

    def _get_resumen_org(self, org=ORG_A):
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/vw_pecuario_poblacion_resumen", headers=_service_headers(),
            params={"ID_Organizacion": f"eq.{org}"}, timeout=30,
        )
        res.raise_for_status()
        rows = res.json()
        self.assertEqual(len(rows), 1, f"Esperaba exactamente 1 fila de resumen para {org}")
        return rows[0]

    # ---- vw_pecuario_lactancia_restante: destete parcial y completo ----

    def test_parto_nuevo_aparece_con_cantidad_restante_completa(self):
        jaula = self._crear_jaula()
        parto_id = self._crear_parto(jaula, n_vivos=10)

        rows = self._get_lactancia_por_parto(parto_id)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["cantidad_restante"], 10)
        self.assertEqual(rows[0]["n_vivos"], 10)

    def test_destete_parcial_baja_cantidad_restante_sin_hacer_desaparecer_el_parto(self):
        # Reescrito 2026-09-25 (v12, 20260925090000_pecuario_destete_recoleccion.sql):
        # el corte real de "ya no está en lactancia" es la RECOLECCIÓN, no
        # la conformación del lote -- confirmado por grep que ningún
        # Server Action real setea parto_origen_id directo (única vía que
        # este test probaba antes). Con el nuevo flujo, "parcial" ya no
        # existe a nivel de vw_pecuario_lactancia_restante (se recolecta
        # completo o nada, ver trg_recoleccion_partos_validar) -- el parto
        # desaparece de esa vista apenas se recolecta, sin importar cuánto
        # se conforme después. Lo "parcial" real ahora vive en
        # vw_pecuario_recolecciones_destete.cantidad_pendiente, que es lo
        # que este test verifica.
        jaula_origen = self._crear_jaula()
        jaula_destino = self._crear_jaula()
        parto_id = self._crear_parto(jaula_origen, n_vivos=10)
        recoleccion_id = self._crear_recoleccion()
        self._recolectar_parto(recoleccion_id, parto_id)

        self.assertEqual(
            self._get_lactancia_por_parto(parto_id), [],
            "El parto ya no debe aparecer en vw_pecuario_lactancia_restante apenas se recolecta, antes de conformar ningún lote.",
        )

        self._conformar_lote_destete(recoleccion_id, jaula_destino, sexo="macho", cantidad=4)

        estado = self._get_recoleccion_estado(recoleccion_id)
        self.assertEqual(estado["cantidad_pendiente"], 6)  # 10 - 4
        self.assertEqual(estado["estado"], "abierta", "Un lote parcial no debe cerrar la recolección -- todavía queda remanente.")

    def test_destete_completo_hace_desaparecer_el_parto_de_la_vista(self):
        # Reescrito 2026-09-25 (v12) -- ver nota del test anterior.
        jaula_origen = self._crear_jaula()
        jaula_destino = self._crear_jaula()
        parto_id = self._crear_parto(jaula_origen, n_vivos=10)
        recoleccion_id = self._crear_recoleccion()
        self._recolectar_parto(recoleccion_id, parto_id)
        self._conformar_lote_destete(recoleccion_id, jaula_destino, sexo="hembra", cantidad=10)  # completo

        rows = self._get_lactancia_por_parto(parto_id)
        self.assertEqual(rows, [], "Un parto completamente destetado no debe aparecer en vw_pecuario_lactancia_restante.")

        estado = self._get_recoleccion_estado(recoleccion_id)
        self.assertEqual(estado["estado"], "cerrada", "Sin remanente pendiente, la recolección debe quedar cerrada (calculado, sin ningún UPDATE manual).")

    # ---- Invariante de población: destete no cambia el total ----

    def test_invariante_total_poblacion_no_cambia_con_destete_completo(self):
        # Reescrito 2026-09-25 (v12) -- ver nota de test_destete_parcial_*
        # arriba. El lote real ahora se crea vía recolección +
        # conformación, no seteando parto_origen_id directo.
        jaula = self._crear_jaula()
        parto_id = self._crear_parto(jaula, n_vivos=8)

        antes = self._get_resumen_org()
        recoleccion_id = self._crear_recoleccion()
        self._recolectar_parto(recoleccion_id, parto_id)
        # sexo/fecha_destete default -> recria, hoy (mismo criterio que la versión anterior de este test)
        self._conformar_lote_destete(recoleccion_id, jaula, sexo="macho", cantidad=8)
        despues = self._get_resumen_org()

        self.assertEqual(despues["total_poblacion"], antes["total_poblacion"], "El destete completo no debe cambiar el total de población, solo la categoría.")
        self.assertEqual(despues["total_lactancia"], antes["total_lactancia"] - 8)
        self.assertEqual(despues["total_recria"], antes["total_recria"] + 8)

    # ---- etapa_calculada, no la columna cruda ----

    def test_lote_recria_con_mas_de_56_dias_cuenta_en_engorde(self):
        jaula = self._crear_jaula()
        fecha_vieja = (datetime.now(timezone.utc).date() - timedelta(days=60)).isoformat()

        antes = self._get_resumen_org()
        self._crear_lote(jaula, cantidad=7, etapa="recria", fecha_destete=fecha_vieja)
        despues = self._get_resumen_org()

        self.assertEqual(despues["total_engorde"], antes["total_engorde"] + 7)
        self.assertEqual(despues["total_recria"], antes["total_recria"], "La columna etapa cruda sigue diciendo 'recria', pero etapa_calculada ya es 'engorde' -- no debe contar en total_recria.")

    # ---- Reproductores: enfermo cuenta, vendido no ----

    def test_reproductor_enfermo_cuenta_vendido_no(self):
        jaula = self._crear_jaula()
        self._crear_reproductor(jaula, sexo="hembra", estado="enfermo")
        self._crear_reproductor(jaula, sexo="macho", estado="vendido")

        ocupacion = self._get_ocupacion_poza(jaula)
        self.assertEqual(ocupacion["total_hembras"], 1)
        self.assertEqual(ocupacion["total_machos"], 0)
        self.assertEqual(ocupacion["total_reproductores"], 1)

    # ---- sobre_capacidad ----

    def test_sobre_capacidad_true_cuando_supera_y_false_cuando_no(self):
        jaula_llena = self._crear_jaula(capacidad_max=2)
        self._crear_lote(jaula_llena, cantidad=5)
        self.assertTrue(self._get_ocupacion_poza(jaula_llena)["sobre_capacidad"])

        jaula_ok = self._crear_jaula(capacidad_max=10)
        self._crear_lote(jaula_ok, cantidad=3)
        self.assertFalse(self._get_ocupacion_poza(jaula_ok)["sobre_capacidad"])

    # ---- Asimetría de mortalidad: resumen (org) sí descuenta, ocupación (poza) no ----

    def test_mortalidad_lactancia_descuenta_en_resumen_no_en_ocupacion(self):
        jaula = self._crear_jaula()
        self._crear_parto(jaula, n_vivos=10)

        ocupacion_antes = self._get_ocupacion_poza(jaula)
        self.assertEqual(ocupacion_antes["total_lactancia"], 10)
        resumen_antes = self._get_resumen_org()

        self._crear_mortalidad(jaula, etapa="lactancia", cantidad=3)

        ocupacion_despues = self._get_ocupacion_poza(jaula)
        self.assertEqual(ocupacion_despues["total_lactancia"], 10, "vw_pecuario_ocupacion_poza NO debe descontar mortalidad de lactancia (asimetría documentada a propósito).")
        resumen_despues = self._get_resumen_org()
        self.assertEqual(resumen_despues["total_lactancia"], resumen_antes["total_lactancia"] - 3, "vw_pecuario_poblacion_resumen SÍ debe descontar mortalidad de lactancia a nivel organización.")

    # ---- Aislamiento cruzado en las 3 vistas ----

    def test_aislamiento_cruzado_lactancia(self):
        jaula = self._crear_jaula()
        parto_id = self._crear_parto(jaula, n_vivos=5)

        read = httpx.get(
            f"{SUPABASE_URL}/rest/v1/vw_pecuario_lactancia_restante",
            headers=_session_headers(self.otra_org_token), params={"parto_id": f"eq.{parto_id}"}, timeout=30,
        )
        self.assertEqual(read.status_code, 200)
        self.assertEqual(read.json(), [], f"Una sesión de {ORG_B} no debe ver lactancia de {ORG_A}.")

    def test_aislamiento_cruzado_ocupacion(self):
        jaula = self._crear_jaula()

        read = httpx.get(
            f"{SUPABASE_URL}/rest/v1/vw_pecuario_ocupacion_poza",
            headers=_session_headers(self.otra_org_token), params={"id": f"eq.{jaula}"}, timeout=30,
        )
        self.assertEqual(read.status_code, 200)
        self.assertEqual(read.json(), [], f"Una sesión de {ORG_B} no debe ver la ocupación de una poza de {ORG_A}.")

    def test_aislamiento_cruzado_resumen(self):
        read = httpx.get(
            f"{SUPABASE_URL}/rest/v1/vw_pecuario_poblacion_resumen",
            headers=_session_headers(self.otra_org_token), params={"ID_Organizacion": f"eq.{ORG_A}"}, timeout=30,
        )
        self.assertEqual(read.status_code, 200)
        self.assertEqual(read.json(), [], f"Una sesión de {ORG_B} no debe ver el resumen de población de {ORG_A}.")


if __name__ == "__main__":
    unittest.main(verbosity=2)
