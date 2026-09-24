"""
Test de integración para Destete real: recolección semanal (Paso 1, sin
sexar) + conformación de lotes por sexo (Paso 2, repetible) — Pecuario
Cuyes. Reemplaza el estado en memoria del navegador del simulador
(`poolDestete`/`lotesDesteteFormados`).

Ver supabase/migrations/20260925090000_pecuario_destete_recoleccion.sql
y specs/pecuario_destete_recoleccion_semanal.md §10.

Usa la organización real GRANJA-VALENCIA (mismo criterio que
Traslado/Población) para los casos de negocio — todas las filas de
estos tests son descartables, con prefijo TEST-, creadas y borradas
dentro de cada test. El aislamiento cruzado usa ORG-TEST-DEMO.

La migración NO se aplica desde este archivo ni desde ningún script de
este repo -- ninguna migración SQL se aplica automáticamente contra la
base real (system prompt / docs/RYZOS_ORQUESTADOR_V3.1.md §4.1.4). Este
archivo verifica el contenido estático de la migración y del contrato
Zod siempre, y sus casos en vivo solo cuando las nuevas tablas/vistas ya
existen (aplicadas a mano en Supabase Studio) -- `unittest.SkipTest`
explícito en caso contrario, sin fallar la suite.
"""

import os
import time
import unittest
from pathlib import Path

import httpx
import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase" / "migrations" / "20260925090000_pecuario_destete_recoleccion.sql"
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

NEEDS_SUPABASE = pytest.mark.skipif(
    not SUPABASE_URL or not SUPABASE_ANON_KEY or not SUPABASE_SERVICE_ROLE_KEY,
    reason="SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY no configuradas — test requiere Supabase Live",
)

ORG_A = "GRANJA-VALENCIA"     # organización real, mismo criterio que Traslado/Población
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
        for tabla_o_vista in (
            "PECUARIO_RECOLECCIONES_DESTETE", "PECUARIO_RECOLECCION_PARTOS", "vw_pecuario_recolecciones_destete",
        ):
            res = httpx.get(
                f"{SUPABASE_URL}/rest/v1/{tabla_o_vista}",
                headers=_service_headers(), params={"select": "*", "limit": 1}, timeout=15,
            )
            if res.status_code != 200:
                return False
        # recoleccion_origen_id es la señal de que PECUARIO_LOTES ya tiene la columna nueva.
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_LOTES",
            headers=_service_headers(), params={"select": "recoleccion_origen_id", "limit": 1}, timeout=15,
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

    def test_dos_tablas_nuevas(self):
        self.assertIn('CREATE TABLE IF NOT EXISTS public."PECUARIO_RECOLECCIONES_DESTETE"', self.sql)
        self.assertIn('CREATE TABLE IF NOT EXISTS public."PECUARIO_RECOLECCION_PARTOS"', self.sql)

    def test_parto_unico_global_no_por_recoleccion(self):
        self.assertIn("uq_recoleccion_partos_parto UNIQUE (parto_id)", self.sql)

    def test_cantidad_incluida_no_confia_en_el_cliente(self):
        self.assertIn("NEW.cantidad_incluida := v_restante;", self.sql)

    def test_check_sexo_definido_para_lotes_de_destete(self):
        self.assertIn("chk_lotes_destete_sexo_definido", self.sql)
        self.assertIn("recoleccion_origen_id IS NULL OR sexo IN ('macho', 'hembra')", self.sql)

    def test_trigger_conformar_no_actua_fuera_del_flujo_destete(self):
        self.assertIn("IF NEW.recoleccion_origen_id IS NULL THEN", self.sql)
        self.assertIn("RETURN NEW; -- lote de cualquier otro flujo", self.sql)

    def test_vw_lactancia_restante_reemplazada_usa_recoleccion_no_parto_origen(self):
        self.assertIn('LEFT JOIN public."PECUARIO_RECOLECCION_PARTOS" rp ON rp.parto_id = p.id', self.sql)
        # No debe volver a usar parto_origen_id como fuente del cálculo.
        # Recorte acotado a la consulta SQL de la vista en sí, sin el
        # COMMENT ON VIEW que la sigue -- ese comentario menciona
        # parto_origen_id a propósito, en prosa, para explicar qué
        # reemplaza (mismo patrón de bug ya documentado: un assertNotIn
        # demasiado amplio termina chocando con comentarios legítimos).
        vista_start = self.sql.index("CREATE OR REPLACE VIEW public.vw_pecuario_lactancia_restante")
        vista_end = self.sql.index("COMMENT ON VIEW public.vw_pecuario_lactancia_restante")
        self.assertNotIn("parto_origen_id", self.sql[vista_start:vista_end])

    def test_vw_lactancia_mantiene_mismo_nombre_de_columna_por_compatibilidad(self):
        self.assertIn("AS cantidad_destetada", self.sql)
        self.assertIn("AS cantidad_restante", self.sql)

    def test_vw_recolecciones_estado_calculado_no_columna(self):
        self.assertIn("AS estado", self.sql)
        self.assertIn("THEN 'cerrada'", self.sql)
        self.assertIn("ELSE 'abierta'", self.sql)

    def test_rls_habilitado_en_las_2_tablas_nuevas(self):
        self.assertIn('ALTER TABLE public."PECUARIO_RECOLECCIONES_DESTETE" ENABLE ROW LEVEL SECURITY', self.sql)
        self.assertIn('ALTER TABLE public."PECUARIO_RECOLECCION_PARTOS"    ENABLE ROW LEVEL SECURITY', self.sql)

    def test_no_toca_fn_crear_tarea_destete_a_proposito(self):
        # Hallazgo señalado, no corregido en esta migración (por diseño).
        self.assertNotIn("CREATE OR REPLACE FUNCTION public.fn_crear_tarea_destete", self.sql)

    def test_preflight_exige_dependencias(self):
        self.assertIn('to_regclass(\'public."PECUARIO_PARTOS"\')', self.sql)
        self.assertIn("to_regclass('public.vw_pecuario_lactancia_restante')", self.sql)
        self.assertIn("proname = 'auth_org_id'", self.sql)


class TestZodContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parent.parent / "lib" / "validations" / "pecuario.ts"
        if not path.exists():
            raise AssertionError(f"No existe {path}")
        cls.ts = path.read_text(encoding="utf-8")

    def test_ambos_schemas_exportados(self):
        self.assertIn("export const RecoleccionDestemteSchema", self.ts)
        self.assertIn("export const ConformarLoteDestemteSchema", self.ts)
        self.assertIn("export type RecoleccionDestemteInput", self.ts)
        self.assertIn("export type ConformarLoteDestemteInput", self.ts)

    def test_recoleccion_schema_pide_al_menos_un_parto(self):
        start = self.ts.index("export const RecoleccionDestemteSchema")
        end = self.ts.index("export const ConformarLoteDestemteSchema")
        body = self.ts[start:end]
        self.assertIn("partos_ids: z.array(z.string().uuid()).min(1", body)

    def test_conformar_schema_no_valida_remanente_a_proposito(self):
        start = self.ts.index("export const ConformarLoteDestemteSchema")
        end = self.ts.index("export type SanidadActividadInput")
        body = self.ts[start:end]
        self.assertIn("sexo: z.enum(['macho', 'hembra'])", body)
        self.assertIn("pesaje: z.object(", body)
        # No debe haber ningún .refine() comparando cantidad_inicial contra
        # un remanente -- esa regla vive solo en el trigger.
        self.assertNotIn(".refine(", body)


@NEEDS_SUPABASE
class TestDesteteRecoleccionLive(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not _migracion_aplicada():
            raise unittest.SkipTest(
                "PECUARIO_RECOLECCIONES_DESTETE/PECUARIO_RECOLECCION_PARTOS/"
                "vw_pecuario_recolecciones_destete o PECUARIO_LOTES.recoleccion_origen_id "
                "no existen todavía -- 20260925090000_pecuario_destete_recoleccion.sql "
                "no aplicada (aplicación manual pendiente, ver §4.1.4)."
            )
        cls.otra_org_token = _magic_link_access_token(ADMIN_EMAIL)

    def setUp(self):
        self.suffix = str(int(time.time() * 1000))
        self._cleanup = []  # list of (table, field, value), LIFO en tearDown

    def tearDown(self):
        for table, field, value in reversed(self._cleanup):
            httpx.delete(f"{SUPABASE_URL}/rest/v1/{table}", headers=_service_headers(), params={field: f"eq.{value}"}, timeout=30)

    def _crear_jaula(self, org=ORG_A):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_JAULAS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": org, "codigo_poza": f"TEST-DESTETE-{self.suffix}-{len(self._cleanup)}"},
            timeout=30,
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

    def _recolectar_parto(self, recoleccion_id, parto_id, org=ORG_A, cantidad_incluida_falsa=None):
        payload = {"ID_Organizacion": org, "recoleccion_id": recoleccion_id, "parto_id": parto_id}
        if cantidad_incluida_falsa is not None:
            payload["cantidad_incluida"] = cantidad_incluida_falsa  # el trigger debe ignorar esto
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_RECOLECCION_PARTOS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json=payload, timeout=30,
        )
        return res

    def _conformar_lote(self, recoleccion_id, poza_id, sexo, cantidad, org=ORG_A):
        return httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_LOTES",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={
                "ID_Organizacion": org, "codigo_lote": f"TEST-DESTETE-LOTE-{self.suffix}-{len(self._cleanup)}",
                "recoleccion_origen_id": recoleccion_id, "poza_actual_id": poza_id,
                "sexo": sexo, "cantidad_inicial": cantidad, "cantidad_actual": cantidad,
            },
            timeout=30,
        )

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

    # ---- Recolección (Paso 1) ----

    def test_recoleccion_crea_filas_con_cantidad_calculada_por_el_trigger(self):
        jaula = self._crear_jaula()
        parto_id = self._crear_parto(jaula, n_vivos=5)
        recoleccion_id = self._crear_recoleccion()

        res = self._recolectar_parto(recoleccion_id, parto_id, cantidad_incluida_falsa=999)
        self.assertEqual(res.status_code, 201, res.text)
        row = res.json()[0]
        self._cleanup.append(("PECUARIO_RECOLECCION_PARTOS", "id", row["id"]))
        self.assertEqual(row["cantidad_incluida"], 5, "El trigger debe ignorar lo que manda el cliente y usar el restante real (5), no 999.")

    def test_recolectar_el_mismo_parto_dos_veces_falla(self):
        # Cubre a la vez los 2 casos pedidos ("UNIQUE global" y "parto ya
        # sin lactancia pendiente, mensaje del trigger") -- son la MISMA
        # observación acá: tras la primera recolección completa, ese
        # parto ya no aparece en vw_pecuario_lactancia_restante (recolecta
        # completo o nada, nunca parcial), así que el 2do intento siempre
        # dispara el guard del propio trigger (400) ANTES de llegar a
        # violar el UNIQUE -- el UNIQUE queda como defensa en profundidad
        # para una carrera concurrente, no observable en un test secuencial.
        jaula = self._crear_jaula()
        parto_id = self._crear_parto(jaula, n_vivos=3)
        recoleccion_id = self._crear_recoleccion()

        primero = self._recolectar_parto(recoleccion_id, parto_id)
        self.assertEqual(primero.status_code, 201, primero.text)
        self._cleanup.append(("PECUARIO_RECOLECCION_PARTOS", "id", primero.json()[0]["id"]))

        segundo = self._recolectar_parto(recoleccion_id, parto_id)
        self.assertEqual(segundo.status_code, 400, segundo.text)

    # ---- Conformación de lotes (Paso 2) ----

    def test_conformar_lote_baja_pendiente_y_sube_asignada(self):
        jaula_origen = self._crear_jaula()
        jaula_destino = self._crear_jaula()
        parto_id = self._crear_parto(jaula_origen, n_vivos=10)
        recoleccion_id = self._crear_recoleccion()
        seed = self._recolectar_parto(recoleccion_id, parto_id)
        seed.raise_for_status()
        self._cleanup.append(("PECUARIO_RECOLECCION_PARTOS", "id", seed.json()[0]["id"]))

        antes = self._get_recoleccion_estado(recoleccion_id)
        self.assertEqual(antes["cantidad_recolectada"], 10)
        self.assertEqual(antes["cantidad_asignada"], 0)
        self.assertEqual(antes["cantidad_pendiente"], 10)
        self.assertEqual(antes["estado"], "abierta")

        lote = self._conformar_lote(recoleccion_id, jaula_destino, "macho", 4)
        self.assertEqual(lote.status_code, 201, lote.text)
        self._cleanup.append(("PECUARIO_LOTES", "id", lote.json()[0]["id"]))

        despues = self._get_recoleccion_estado(recoleccion_id)
        self.assertEqual(despues["cantidad_asignada"], 4)
        self.assertEqual(despues["cantidad_pendiente"], 6)
        self.assertEqual(despues["estado"], "abierta")

    def test_conformar_lote_cantidad_mayor_al_remanente_falla(self):
        jaula_origen = self._crear_jaula()
        jaula_destino = self._crear_jaula()
        parto_id = self._crear_parto(jaula_origen, n_vivos=5)
        recoleccion_id = self._crear_recoleccion()
        seed = self._recolectar_parto(recoleccion_id, parto_id)
        seed.raise_for_status()
        self._cleanup.append(("PECUARIO_RECOLECCION_PARTOS", "id", seed.json()[0]["id"]))

        lote = self._conformar_lote(recoleccion_id, jaula_destino, "hembra", 999)
        self.assertEqual(lote.status_code, 400, lote.text)

    def test_conformar_lote_sexo_mixto_falla_check(self):
        jaula_origen = self._crear_jaula()
        jaula_destino = self._crear_jaula()
        parto_id = self._crear_parto(jaula_origen, n_vivos=5)
        recoleccion_id = self._crear_recoleccion()
        seed = self._recolectar_parto(recoleccion_id, parto_id)
        seed.raise_for_status()
        self._cleanup.append(("PECUARIO_RECOLECCION_PARTOS", "id", seed.json()[0]["id"]))

        lote = self._conformar_lote(recoleccion_id, jaula_destino, "mixto", 2)
        self.assertEqual(lote.status_code, 400, lote.text)

    def test_conformar_dos_lotes_hasta_agotar_remanente_cierra_la_recoleccion(self):
        jaula_origen = self._crear_jaula()
        jaula_destino = self._crear_jaula()
        parto_id = self._crear_parto(jaula_origen, n_vivos=10)
        recoleccion_id = self._crear_recoleccion()
        seed = self._recolectar_parto(recoleccion_id, parto_id)
        seed.raise_for_status()
        self._cleanup.append(("PECUARIO_RECOLECCION_PARTOS", "id", seed.json()[0]["id"]))

        lote1 = self._conformar_lote(recoleccion_id, jaula_destino, "macho", 6)
        self.assertEqual(lote1.status_code, 201, lote1.text)
        self._cleanup.append(("PECUARIO_LOTES", "id", lote1.json()[0]["id"]))
        self.assertEqual(self._get_recoleccion_estado(recoleccion_id)["estado"], "abierta")

        lote2 = self._conformar_lote(recoleccion_id, jaula_destino, "hembra", 4)
        self.assertEqual(lote2.status_code, 201, lote2.text)
        self._cleanup.append(("PECUARIO_LOTES", "id", lote2.json()[0]["id"]))

        final = self._get_recoleccion_estado(recoleccion_id)
        self.assertEqual(final["cantidad_pendiente"], 0)
        self.assertEqual(final["estado"], "cerrada", "El estado debe pasar a 'cerrada' solo por el cálculo de la vista, sin ningún UPDATE manual.")

    # ---- Cambio de corte: recolección, no conformación ----

    def test_lactancia_restante_ya_no_lista_el_parto_apenas_recolectado_sin_conformar_lote(self):
        jaula = self._crear_jaula()
        parto_id = self._crear_parto(jaula, n_vivos=8)

        antes = self._get_lactancia_por_parto(parto_id)
        self.assertEqual(len(antes), 1)
        self.assertEqual(antes[0]["cantidad_restante"], 8)

        recoleccion_id = self._crear_recoleccion()
        seed = self._recolectar_parto(recoleccion_id, parto_id)
        seed.raise_for_status()
        self._cleanup.append(("PECUARIO_RECOLECCION_PARTOS", "id", seed.json()[0]["id"]))

        despues = self._get_lactancia_por_parto(parto_id)
        self.assertEqual(despues, [], "El parto debe desaparecer de vw_pecuario_lactancia_restante apenas se recolecta, aunque ningún lote se haya conformado todavía.")

    # ---- Multi-tenant: lotes cruzados por recoleccion_origen_id / poza_actual_id ----

    def test_lote_con_recoleccion_de_otra_organizacion_falla(self):
        jaula_org_b = self._crear_jaula(org=ORG_B)
        recoleccion_org_b = self._crear_recoleccion(org=ORG_B)
        jaula_org_a = self._crear_jaula(org=ORG_A)

        lote = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_LOTES",
            headers={**_service_headers(), "Content-Type": "application/json"},
            json={
                "ID_Organizacion": ORG_A, "codigo_lote": f"TEST-DESTETE-CROSSORG-{self.suffix}",
                "recoleccion_origen_id": recoleccion_org_b, "poza_actual_id": jaula_org_a,
                "sexo": "macho", "cantidad_inicial": 1,
            },
            timeout=30,
        )
        self.assertEqual(lote.status_code, 400, lote.text)

    def test_lote_con_poza_de_otra_organizacion_falla(self):
        jaula_origen = self._crear_jaula()
        parto_id = self._crear_parto(jaula_origen, n_vivos=5)
        recoleccion_id = self._crear_recoleccion()
        seed = self._recolectar_parto(recoleccion_id, parto_id)
        seed.raise_for_status()
        self._cleanup.append(("PECUARIO_RECOLECCION_PARTOS", "id", seed.json()[0]["id"]))
        jaula_org_b = self._crear_jaula(org=ORG_B)

        lote = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_LOTES",
            headers={**_service_headers(), "Content-Type": "application/json"},
            json={
                "ID_Organizacion": ORG_A, "codigo_lote": f"TEST-DESTETE-CROSSPOZA-{self.suffix}",
                "recoleccion_origen_id": recoleccion_id, "poza_actual_id": jaula_org_b,
                "sexo": "hembra", "cantidad_inicial": 1,
            },
            timeout=30,
        )
        self.assertEqual(lote.status_code, 400, lote.text)

    # ---- Aislamiento RLS cruzado ----

    def test_aislamiento_cruzado_lectura_recolecciones_y_partos(self):
        jaula = self._crear_jaula()
        parto_id = self._crear_parto(jaula, n_vivos=5)
        recoleccion_id = self._crear_recoleccion()
        seed = self._recolectar_parto(recoleccion_id, parto_id)
        seed.raise_for_status()
        recoleccion_parto_id = seed.json()[0]["id"]
        self._cleanup.append(("PECUARIO_RECOLECCION_PARTOS", "id", recoleccion_parto_id))

        read_recoleccion = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_RECOLECCIONES_DESTETE",
            headers=_session_headers(self.otra_org_token), params={"id": f"eq.{recoleccion_id}"}, timeout=30,
        )
        self.assertEqual(read_recoleccion.status_code, 200)
        self.assertEqual(read_recoleccion.json(), [], f"Una sesión de {ORG_B} no debe ver recolecciones de {ORG_A}.")

        read_partos = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_RECOLECCION_PARTOS",
            headers=_session_headers(self.otra_org_token), params={"id": f"eq.{recoleccion_parto_id}"}, timeout=30,
        )
        self.assertEqual(read_partos.status_code, 200)
        self.assertEqual(read_partos.json(), [], f"Una sesión de {ORG_B} no debe ver PECUARIO_RECOLECCION_PARTOS de {ORG_A}.")

    def test_aislamiento_cruzado_insert_rechazado(self):
        jaula = self._crear_jaula()
        parto_id = self._crear_parto(jaula, n_vivos=5)
        recoleccion_id = self._crear_recoleccion()

        insert_recoleccion = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_RECOLECCIONES_DESTETE",
            headers={**_session_headers(self.otra_org_token), "Content-Type": "application/json"},
            json={"ID_Organizacion": ORG_A}, timeout=30,
        )
        self.assertIn(insert_recoleccion.status_code, (400, 401, 403), insert_recoleccion.text)

        insert_partos = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_RECOLECCION_PARTOS",
            headers={**_session_headers(self.otra_org_token), "Content-Type": "application/json"},
            json={"ID_Organizacion": ORG_A, "recoleccion_id": recoleccion_id, "parto_id": parto_id}, timeout=30,
        )
        self.assertIn(insert_partos.status_code, (400, 401, 403), insert_partos.text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
