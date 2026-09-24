"""
Test de integración para Empadre real: "Asignar macho a jaula" (empadre
continuo vs. controlado) + retiro pendiente persistente, reemplazando el
estado en memoria del simulador (`RETIROS_MACHO_PENDIENTES`).

Ver supabase/migrations/20260926090000_pecuario_empadre_asignacion_macho.sql
(specs/pecuario_sistema_empadre.md referenciada, pero no existe en este
repo -- mismo hallazgo recurrente de toda esta ronda; el detalle
completo ya está en la cabecera de la migración, no se fabrica el
archivo por instrucción explícita de esta tarea).

No hay contrato Zod nuevo -- reutiliza `HistorialMachoSchema` (v3,
2026-09-11), ya existente en lib/validations/pecuario.ts sin cambios.

Usa la organización real GRANJA-VALENCIA (mismo criterio que
Traslado/Destete/Población) para los casos de negocio -- todas las
filas de estos tests son descartables, con prefijo TEST-, creadas y
borradas dentro de cada test. El aislamiento cruzado usa ORG-TEST-DEMO.
El único estado compartido a nivel organización (`Config->pecuario->
sistema_cria`) se guarda y se restaura exacto en cada test que lo toca,
en un `try/finally`, para no filtrar estado entre tests.

La migración NO se aplica desde este archivo ni desde ningún script de
este repo -- ninguna migración SQL se aplica automáticamente contra la
base real (system prompt / docs/RYZOS_ORQUESTADOR_V3.1.md §4.1.4). Este
archivo verifica el contenido estático de la migración siempre, y sus
casos en vivo solo cuando las nuevas tablas/vistas ya existen (aplicadas
a mano en Supabase Studio) -- `unittest.SkipTest` explícito en caso
contrario, sin fallar la suite.
"""

import os
import time
import unittest
from pathlib import Path

import httpx
import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase" / "migrations" / "20260926090000_pecuario_empadre_asignacion_macho.sql"
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

NEEDS_SUPABASE = pytest.mark.skipif(
    not SUPABASE_URL or not SUPABASE_ANON_KEY or not SUPABASE_SERVICE_ROLE_KEY,
    reason="SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY no configuradas — test requiere Supabase Live",
)

ORG_A = "GRANJA-VALENCIA"     # organización real, mismo criterio que el resto de la suite
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
        for tabla_o_vista in ("PECUARIO_RETIROS_MACHO_PENDIENTES", "vw_pecuario_retiros_macho_pendientes"):
            res = httpx.get(
                f"{SUPABASE_URL}/rest/v1/{tabla_o_vista}",
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

    def test_tabla_retiros_nueva(self):
        self.assertIn('CREATE TABLE IF NOT EXISTS public."PECUARIO_RETIROS_MACHO_PENDIENTES"', self.sql)

    def test_no_agrega_columnas_a_historial_machos(self):
        # La cabecera es explícita: "no se le agrega ninguna columna" --
        # el único cambio real ahí es comportamiento (triggers nuevos).
        self.assertNotIn('ALTER TABLE public."PECUARIO_HISTORIAL_MACHOS" ADD COLUMN', self.sql)

    def test_validar_exige_sexo_macho_y_organizacion(self):
        self.assertIn("v_sexo_macho IS DISTINCT FROM 'macho'", self.sql)
        self.assertIn('v_org_macho IS DISTINCT FROM NEW."ID_Organizacion"', self.sql)
        self.assertIn('v_org_jaula IS DISTINCT FROM NEW."ID_Organizacion"', self.sql)

    def test_validar_exige_fecha_salida_en_modo_controlado(self):
        self.assertIn("v_sistema_cria = 'controlado' AND NEW.fecha_salida IS NULL", self.sql)
        self.assertIn("COALESCE(\"Config\"->'pecuario'->>'sistema_cria', 'continuo')", self.sql)

    def test_efectos_cierra_asignacion_previa_del_mismo_macho(self):
        self.assertIn("SET fecha_salida = NEW.fecha_entrada", self.sql)
        self.assertIn("WHERE macho_id = NEW.macho_id", self.sql)
        self.assertIn("AND id <> NEW.id", self.sql)

    def test_efectos_sincroniza_jaula_actual_sin_tocar_fecha_salida_reproductor(self):
        self.assertIn("SET jaula_actual_id = NEW.jaula_id", self.sql)
        # No debe tocar PECUARIO_REPRODUCTORES.fecha_salida en ningún UPDATE real.
        efectos_start = self.sql.index("CREATE OR REPLACE FUNCTION public.trg_historial_macho_efectos()")
        efectos_end = self.sql.index("DROP TRIGGER IF EXISTS trg_historial_macho_efectos")
        cuerpo = self.sql[efectos_start:efectos_end]
        self.assertNotIn("SET fecha_salida", cuerpo.replace("SET fecha_salida = NEW.fecha_entrada", ""))

    def test_efectos_crea_pendiente_solo_si_fecha_salida_no_es_null(self):
        self.assertIn("IF NEW.fecha_salida IS NOT NULL THEN", self.sql)
        self.assertIn('INSERT INTO public."PECUARIO_RETIROS_MACHO_PENDIENTES"', self.sql)

    def test_resolver_no_toca_jaula_si_ya_fue_reasignado(self):
        self.assertIn("IF v_fecha_salida_actual IS NULL THEN", self.sql)
        self.assertIn("AND jaula_actual_id = NEW.jaula_id", self.sql)

    def test_trigger_resolver_solo_dispara_de_false_a_true(self):
        self.assertIn("WHEN (NOT OLD.resuelta AND NEW.resuelta)", self.sql)

    def test_unique_un_pendiente_por_fila_de_historial(self):
        self.assertIn("uq_retiros_macho_historial UNIQUE (historial_macho_id)", self.sql)

    def test_vista_estado_calculado_no_columna(self):
        self.assertIn("AS estado", self.sql)
        self.assertIn("THEN 'resuelto'", self.sql)
        self.assertIn("THEN 'vencido'", self.sql)
        self.assertIn("ELSE 'programado'", self.sql)

    def test_rls_habilitado(self):
        self.assertIn('ALTER TABLE public."PECUARIO_RETIROS_MACHO_PENDIENTES" ENABLE ROW LEVEL SECURITY', self.sql)

    def test_preflight_exige_dependencias(self):
        self.assertIn('to_regclass(\'public."PECUARIO_REPRODUCTORES"\')', self.sql)
        self.assertIn('to_regclass(\'public."PECUARIO_HISTORIAL_MACHOS"\')', self.sql)
        self.assertIn('to_regclass(\'public."PECUARIO_JAULAS"\')', self.sql)
        self.assertIn("proname = 'auth_org_id'", self.sql)


class TestZodContractReutilizado(unittest.TestCase):
    """No se crea ningún schema nuevo -- solo confirma que
    HistorialMachoSchema sigue existiendo tal cual, sin tocar."""

    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parent.parent / "lib" / "validations" / "pecuario.ts"
        if not path.exists():
            raise AssertionError(f"No existe {path}")
        cls.ts = path.read_text(encoding="utf-8")

    def test_historial_macho_schema_existe_sin_cambios(self):
        self.assertIn("export const HistorialMachoSchema", self.ts)
        self.assertIn("export type HistorialMachoInput", self.ts)

    def test_no_existe_ningun_schema_duplicado_de_asignar_macho(self):
        self.assertNotIn("AsignarMachoJaulaSchema", self.ts)


@NEEDS_SUPABASE
class TestEmpadreAsignacionMachoLive(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not _migracion_aplicada():
            raise unittest.SkipTest(
                "PECUARIO_RETIROS_MACHO_PENDIENTES/vw_pecuario_retiros_macho_pendientes "
                "no existen todavía -- 20260926090000_pecuario_empadre_asignacion_macho.sql "
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
            json={"ID_Organizacion": org, "codigo_poza": f"TEST-EMPADRE-{self.suffix}-{len(self._cleanup)}"},
            timeout=30,
        )
        res.raise_for_status()
        jaula_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_JAULAS", "id", jaula_id))
        return jaula_id

    def _crear_reproductor(self, sexo, org=ORG_A):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_REPRODUCTORES",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": org, "codigo_arete": f"TEST-EMPADRE-{self.suffix}-{len(self._cleanup)}", "sexo": sexo},
            timeout=30,
        )
        res.raise_for_status()
        animal_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_REPRODUCTORES", "id", animal_id))
        return animal_id

    def _insertar_historial(self, macho_id, jaula_id, fecha_salida=None, fecha_entrada=None, org=ORG_A):
        payload = {"ID_Organizacion": org, "macho_id": macho_id, "jaula_id": jaula_id}
        if fecha_salida is not None:
            payload["fecha_salida"] = fecha_salida
        if fecha_entrada is not None:
            payload["fecha_entrada"] = fecha_entrada
        return httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_HISTORIAL_MACHOS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json=payload, timeout=30,
        )

    def _get_historial(self, historial_id):
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_HISTORIAL_MACHOS", headers=_service_headers(),
            params={"id": f"eq.{historial_id}"}, timeout=30,
        )
        res.raise_for_status()
        rows = res.json()
        self.assertEqual(len(rows), 1)
        return rows[0]

    def _get_reproductor(self, macho_id):
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_REPRODUCTORES", headers=_service_headers(),
            params={"id": f"eq.{macho_id}"}, timeout=30,
        )
        res.raise_for_status()
        rows = res.json()
        self.assertEqual(len(rows), 1)
        return rows[0]

    def _get_pendiente_por_historial(self, historial_id):
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_RETIROS_MACHO_PENDIENTES", headers=_service_headers(),
            params={"historial_macho_id": f"eq.{historial_id}"}, timeout=30,
        )
        res.raise_for_status()
        return res.json()

    def _marcar_resuelto(self, pendiente_id):
        return httpx.patch(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_RETIROS_MACHO_PENDIENTES",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            params={"id": f"eq.{pendiente_id}"},
            json={"resuelta": True},
            timeout=30,
        )

    def _get_vista_pendiente(self, pendiente_id):
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/vw_pecuario_retiros_macho_pendientes", headers=_service_headers(),
            params={"id": f"eq.{pendiente_id}"}, timeout=30,
        )
        res.raise_for_status()
        rows = res.json()
        self.assertEqual(len(rows), 1)
        return rows[0]

    def _get_config(self, org=ORG_A):
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/ORGANIZACIONES", headers=_service_headers(),
            params={"ID": f"eq.{org}", "select": "Config"}, timeout=30,
        )
        res.raise_for_status()
        rows = res.json()
        self.assertEqual(len(rows), 1)
        return rows[0]["Config"]

    def _set_config(self, config, org=ORG_A):
        res = httpx.patch(
            f"{SUPABASE_URL}/rest/v1/ORGANIZACIONES",
            headers={**_service_headers(), "Content-Type": "application/json"},
            params={"ID": f"eq.{org}"},
            json={"Config": config},
            timeout=30,
        )
        res.raise_for_status()

    def _set_sistema_cria(self, modo, org=ORG_A):
        config = self._get_config(org) or {}
        pecuario = dict(config.get("pecuario") or {})
        pecuario["sistema_cria"] = modo
        config = {**config, "pecuario": pecuario}
        self._set_config(config, org)

    # ---- Flujo básico: asignar, reasignar, resolver ----

    def test_asignar_macho_a_jaula_sin_fecha_salida_no_crea_pendiente(self):
        jaula = self._crear_jaula()
        macho = self._crear_reproductor("macho")

        res = self._insertar_historial(macho, jaula)
        self.assertEqual(res.status_code, 201, res.text)
        historial_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_HISTORIAL_MACHOS", "id", historial_id))

        self.assertEqual(self._get_reproductor(macho)["jaula_actual_id"], jaula)
        self.assertEqual(self._get_pendiente_por_historial(historial_id), [])

    def test_reasignar_macho_a_otra_jaula_cierra_la_anterior_y_crea_pendiente(self):
        jaula_1 = self._crear_jaula()
        jaula_2 = self._crear_jaula()
        macho = self._crear_reproductor("macho")

        primero = self._insertar_historial(macho, jaula_1)
        primero.raise_for_status()
        historial_1_id = primero.json()[0]["id"]
        self._cleanup.append(("PECUARIO_HISTORIAL_MACHOS", "id", historial_1_id))

        fecha_retiro = "2026-12-31"
        segundo = self._insertar_historial(macho, jaula_2, fecha_salida=fecha_retiro)
        self.assertEqual(segundo.status_code, 201, segundo.text)
        historial_2 = segundo.json()[0]
        historial_2_id = historial_2["id"]
        self._cleanup.append(("PECUARIO_HISTORIAL_MACHOS", "id", historial_2_id))

        historial_1 = self._get_historial(historial_1_id)
        self.assertEqual(historial_1["fecha_salida"], historial_2["fecha_entrada"], "La fila vieja debe cerrarse con la fecha_entrada del nuevo insert.")

        self.assertEqual(self._get_reproductor(macho)["jaula_actual_id"], jaula_2)

        pendientes = self._get_pendiente_por_historial(historial_2_id)
        self.assertEqual(len(pendientes), 1)
        pendiente = pendientes[0]
        self._cleanup.append(("PECUARIO_RETIROS_MACHO_PENDIENTES", "id", pendiente["id"]))
        self.assertFalse(pendiente["resuelta"])
        self.assertEqual(pendiente["fecha_retiro_planificada"], fecha_retiro)

    def test_marcar_pendiente_resuelto_cierra_historial_y_limpia_jaula_actual(self):
        jaula = self._crear_jaula()
        macho = self._crear_reproductor("macho")

        res = self._insertar_historial(macho, jaula, fecha_salida="2026-12-31")
        res.raise_for_status()
        historial_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_HISTORIAL_MACHOS", "id", historial_id))
        pendiente = self._get_pendiente_por_historial(historial_id)[0]
        self._cleanup.append(("PECUARIO_RETIROS_MACHO_PENDIENTES", "id", pendiente["id"]))

        resuelto = self._marcar_resuelto(pendiente["id"])
        self.assertEqual(resuelto.status_code, 200, resuelto.text)

        import datetime
        hoy = datetime.date.today().isoformat()
        self.assertEqual(self._get_historial(historial_id)["fecha_salida"], hoy)
        self.assertIsNone(self._get_reproductor(macho)["jaula_actual_id"])
        self.assertEqual(self._get_vista_pendiente(pendiente["id"])["estado"], "resuelto")

    def test_resolver_pendiente_viejo_no_toca_jaula_si_macho_ya_fue_reasignado(self):
        jaula_1 = self._crear_jaula()
        jaula_2 = self._crear_jaula()
        jaula_3 = self._crear_jaula()
        macho = self._crear_reproductor("macho")

        primero = self._insertar_historial(macho, jaula_1, fecha_salida="2026-12-31")
        primero.raise_for_status()
        historial_1_id = primero.json()[0]["id"]
        self._cleanup.append(("PECUARIO_HISTORIAL_MACHOS", "id", historial_1_id))
        pendiente_1 = self._get_pendiente_por_historial(historial_1_id)[0]
        self._cleanup.append(("PECUARIO_RETIROS_MACHO_PENDIENTES", "id", pendiente_1["id"]))

        # Reasignado a jaula_3 ANTES de que alguien marque "hecho" el pendiente viejo.
        segundo = self._insertar_historial(macho, jaula_3)
        segundo.raise_for_status()
        historial_3_id = segundo.json()[0]["id"]
        self._cleanup.append(("PECUARIO_HISTORIAL_MACHOS", "id", historial_3_id))
        self.assertEqual(self._get_reproductor(macho)["jaula_actual_id"], jaula_3)

        resuelto = self._marcar_resuelto(pendiente_1["id"])
        self.assertEqual(resuelto.status_code, 200, resuelto.text)

        self.assertEqual(
            self._get_reproductor(macho)["jaula_actual_id"], jaula_3,
            "Resolver un pendiente de una asignación ya reemplazada no debe tocar la jaula actual (que ya es jaula_3).",
        )
        self.assertEqual(self._get_vista_pendiente(pendiente_1["id"])["estado"], "resuelto")

    # ---- Validaciones del trigger BEFORE INSERT ----

    def test_macho_id_de_sexo_hembra_falla(self):
        jaula = self._crear_jaula()
        hembra = self._crear_reproductor("hembra")

        res = self._insertar_historial(hembra, jaula)
        self.assertEqual(res.status_code, 400, res.text)

    def test_jaula_de_otra_organizacion_falla(self):
        jaula_otra_org = self._crear_jaula(org=ORG_B)
        macho = self._crear_reproductor("macho")

        res = self._insertar_historial(macho, jaula_otra_org)
        self.assertEqual(res.status_code, 400, res.text)

    # ---- Empadre controlado: fecha_salida obligatoria ----

    def test_modo_controlado_exige_fecha_salida_y_modo_continuo_no(self):
        original_config = self._get_config()
        try:
            self._set_sistema_cria("controlado")
            jaula = self._crear_jaula()
            macho = self._crear_reproductor("macho")

            sin_fecha = self._insertar_historial(macho, jaula)
            self.assertEqual(sin_fecha.status_code, 400, sin_fecha.text)

            con_fecha = self._insertar_historial(macho, jaula, fecha_salida="2026-12-31")
            self.assertEqual(con_fecha.status_code, 201, con_fecha.text)
            historial_id = con_fecha.json()[0]["id"]
            self._cleanup.append(("PECUARIO_HISTORIAL_MACHOS", "id", historial_id))
            pendientes = self._get_pendiente_por_historial(historial_id)
            self.assertEqual(len(pendientes), 1)
            self._cleanup.append(("PECUARIO_RETIROS_MACHO_PENDIENTES", "id", pendientes[0]["id"]))
        finally:
            self._set_config(original_config)

    # ---- Aislamiento RLS cruzado ----

    def test_aislamiento_cruzado_vista_retiros_pendientes(self):
        jaula = self._crear_jaula()
        macho = self._crear_reproductor("macho")
        res = self._insertar_historial(macho, jaula, fecha_salida="2026-12-31")
        res.raise_for_status()
        historial_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_HISTORIAL_MACHOS", "id", historial_id))
        pendiente = self._get_pendiente_por_historial(historial_id)[0]
        self._cleanup.append(("PECUARIO_RETIROS_MACHO_PENDIENTES", "id", pendiente["id"]))

        read = httpx.get(
            f"{SUPABASE_URL}/rest/v1/vw_pecuario_retiros_macho_pendientes",
            headers=_session_headers(self.otra_org_token), params={"id": f"eq.{pendiente['id']}"}, timeout=30,
        )
        self.assertEqual(read.status_code, 200)
        self.assertEqual(read.json(), [], f"Una sesión de {ORG_B} no debe ver un retiro pendiente de {ORG_A}.")


if __name__ == "__main__":
    unittest.main(verbosity=2)
