"""
Aislamiento RLS por rol de Sanidad -- PECUARIO_ACTIVIDADES_SANIDAD (catálogo)
y PECUARIO_SANIDAD_REGISTROS (ejecuciones). Verifica las 8 políticas de
supabase/migrations/20260930202402_fix_rls_sanidad_por_rol.sql:

  catálogo:  SELECT org | INSERT/UPDATE/DELETE solo admin
  registros: SELECT org | INSERT admin+tecnico_campo | UPDATE/DELETE solo admin

Las llamadas "de usuario" usan la sesión REAL de cada cuenta (access token
vía magic link -- mismo patrón que test_pecuario_sanidad_actividades.py); la
service_role solo siembra/limpia filas y re-lee el estado verdadero. Importante:
una política que bloquea UPDATE/DELETE por USING NO devuelve error en PostgREST
(0 filas afectadas, 200/204), así que esos casos se verifican releyendo la fila
con service_role, nunca por el status HTTP. Un INSERT bloqueado sí da 403.

Cuentas: GRANJA-TEST admin (dneyser5+test@gmail.com) y tecnico_campo
(dneyser5+tecnico@gmail.com, scripts/provision_login_accounts.mjs); auditor
demo de ORG-TEST-DEMO. Org ajena para aislamiento cruzado: COOP-AROMAS-VALLE
(filas sembradas con prefijo TEST-RLSROL y borradas en tearDown).

Este test NO aplica la migración. Si la migración no está aplicada en la base,
los casos de bloqueo FALLAN a propósito (es el gap que detecta). Sin
credenciales de Supabase, se salta.
"""

import os
import re
import time
import unittest
from pathlib import Path

import httpx
import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase" / "migrations" / "20260930202402_fix_rls_sanidad_por_rol.sql"
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

NEEDS_SUPABASE = pytest.mark.skipif(
    not SUPABASE_URL or not SUPABASE_ANON_KEY or not SUPABASE_SERVICE_ROLE_KEY,
    reason="SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY no configuradas — test requiere Supabase Live",
)

ORG = "GRANJA-TEST"
ORG_AJENA = "COOP-AROMAS-VALLE"
ORG_DEMO = "ORG-TEST-DEMO"
ADMIN_EMAIL = "dneyser5+test@gmail.com"
TECNICO_EMAIL = "dneyser5+tecnico@gmail.com"
AUDITOR_EMAIL = "auditor-qc-demo@ryzos-demo.test"

T_ACT = "PECUARIO_ACTIVIDADES_SANIDAD"
T_REG = "PECUARIO_SANIDAD_REGISTROS"
JSON = {"Content-Type": "application/json"}


def _service_headers():
    return {"apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"}


def _session_headers(token):
    return {"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}"}


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


def _bloque_politica(sql: str, nombre: str) -> str:
    """Texto de un CREATE POLICY "nombre" hasta su ';' de cierre."""
    ini = sql.index(f'CREATE POLICY "{nombre}"')
    return sql[ini: sql.index(";", ini)]


class TestMigrationFileStatic(unittest.TestCase):
    """Sin Supabase: las 8 políticas del archivo dicen lo que el negocio decidió."""

    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION_PATH.read_text(encoding="utf-8")

    def test_ocho_politicas_creadas_y_all_reemplazadas(self):
        codigo = "\n".join(l for l in self.sql.splitlines() if not l.lstrip().startswith("--"))
        self.assertEqual(len(re.findall(r"^CREATE POLICY", codigo, flags=re.M)), 8)
        self.assertIn('DROP POLICY IF EXISTS "rls_all_pecuario_actividades_sanidad"', self.sql)
        self.assertIn('DROP POLICY IF EXISTS "rls_all_pecuario_sanidad_registros"', self.sql)
        self.assertNotIn("FOR ALL", codigo)

    def test_catalogo_escritura_solo_admin(self):
        for cmd in ("insert", "update", "delete"):
            with self.subTest(cmd=cmd):
                b = _bloque_politica(self.sql, f"rls_{cmd}_pecuario_actividades_sanidad")
                self.assertIn("auth_role() = 'admin'", b)
                self.assertNotIn("tecnico_campo", b)

    def test_registros_insert_admin_y_tecnico_resto_solo_admin(self):
        self.assertIn("auth_role() IN ('admin', 'tecnico_campo')", _bloque_politica(self.sql, "rls_insert_pecuario_sanidad_registros"))
        for cmd in ("update", "delete"):
            with self.subTest(cmd=cmd):
                b = _bloque_politica(self.sql, f"rls_{cmd}_pecuario_sanidad_registros")
                self.assertIn("auth_role() = 'admin'", b)
                self.assertNotIn("tecnico_campo", b)

    def test_select_sin_restriccion_de_rol(self):
        for t in ("actividades_sanidad", "sanidad_registros"):
            self.assertNotIn("auth_role()", _bloque_politica(self.sql, f"rls_select_pecuario_{t}"))


@NEEDS_SUPABASE
class TestSanidadRlsPorRolLive(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.admin = _magic_link_access_token(ADMIN_EMAIL)
        cls.tecnico = _magic_link_access_token(TECNICO_EMAIL)
        cls.auditor = _magic_link_access_token(AUDITOR_EMAIL)

    def setUp(self):
        self.sfx = str(int(time.time() * 1000))
        self._cleanup = []  # (tabla, id), LIFO

    def tearDown(self):
        for tabla, id_ in reversed(self._cleanup):
            httpx.delete(f"{SUPABASE_URL}/rest/v1/{tabla}", headers=_service_headers(), params={"id": f"eq.{id_}"}, timeout=30)

    # ---- helpers ----

    def _seed(self, tabla, payload):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/{tabla}",
            headers={**_service_headers(), **JSON, "Prefer": "return=representation"}, json=payload, timeout=30,
        )
        res.raise_for_status()
        id_ = res.json()[0]["id"]
        self._cleanup.append((tabla, id_))
        return id_

    def _seed_actividad(self, org=ORG):
        return self._seed(T_ACT, {"ID_Organizacion": org, "nombre": f"TEST-RLSROL-{self.sfx}", "alcance": "granja", "frecuencia_dias": 7})

    def _seed_registro(self, actividad_id, org=ORG):
        return self._seed(T_REG, {"ID_Organizacion": org, "actividad_id": actividad_id})

    def _fila(self, tabla, id_):
        res = httpx.get(f"{SUPABASE_URL}/rest/v1/{tabla}", headers=_service_headers(), params={"id": f"eq.{id_}", "select": "*"}, timeout=30)
        res.raise_for_status()
        rows = res.json()
        return rows[0] if rows else None

    def _post(self, token, tabla, payload):
        return httpx.post(
            f"{SUPABASE_URL}/rest/v1/{tabla}",
            headers={**_session_headers(token), **JSON, "Prefer": "return=representation"}, json=payload, timeout=30,
        )

    def _patch(self, token, tabla, id_, payload):
        return httpx.patch(
            f"{SUPABASE_URL}/rest/v1/{tabla}", headers={**_session_headers(token), **JSON, "Prefer": "return=representation"},
            params={"id": f"eq.{id_}"}, json=payload, timeout=30,
        )

    def _delete(self, token, tabla, id_):
        return httpx.delete(
            f"{SUPABASE_URL}/rest/v1/{tabla}", headers={**_session_headers(token), "Prefer": "return=representation"},
            params={"id": f"eq.{id_}"}, timeout=30,
        )

    def _get(self, token, tabla, id_):
        return httpx.get(f"{SUPABASE_URL}/rest/v1/{tabla}", headers=_session_headers(token), params={"id": f"eq.{id_}"}, timeout=30)

    def _nueva_actividad_payload(self, org=ORG, tag="X"):
        return {"ID_Organizacion": org, "nombre": f"TEST-RLSROL-{tag}-{self.sfx}", "alcance": "granja", "frecuencia_dias": 9}

    def _registrar_para_limpieza(self, tabla, res):
        if res.status_code == 201:
            self._cleanup.append((tabla, res.json()[0]["id"]))

    # ---- (a) tecnico_campo: catálogo bloqueado, registros insertables ----

    def test_tecnico_insert_catalogo_bloqueado(self):
        res = self._post(self.tecnico, T_ACT, self._nueva_actividad_payload(tag="tec"))
        self._registrar_para_limpieza(T_ACT, res)  # solo si la RLS fallara
        self.assertEqual(res.status_code, 403, f"tecnico_campo NO debe insertar en el catálogo. body={res.text}")

    def test_tecnico_update_catalogo_bloqueado(self):
        act = self._seed_actividad()
        self._patch(self.tecnico, T_ACT, act, {"frecuencia_dias": 99})
        self.assertEqual(self._fila(T_ACT, act)["frecuencia_dias"], 7, "tecnico_campo modificó el catálogo")

    def test_tecnico_delete_catalogo_bloqueado(self):
        act = self._seed_actividad()
        self._delete(self.tecnico, T_ACT, act)
        self.assertIsNotNone(self._fila(T_ACT, act), "tecnico_campo borró una actividad del catálogo")

    def test_tecnico_puede_leer_catalogo(self):
        act = self._seed_actividad()
        res = self._get(self.tecnico, T_ACT, act)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json()), 1, "tecnico_campo debe leer el catálogo de su organización")

    def test_tecnico_insert_registro_permitido(self):
        act = self._seed_actividad()
        res = self._post(self.tecnico, T_REG, {"ID_Organizacion": ORG, "actividad_id": act})
        self._registrar_para_limpieza(T_REG, res)
        self.assertEqual(res.status_code, 201, res.text)

    # ---- (d) tecnico_campo: UPDATE/DELETE de registros bloqueados ----

    def test_tecnico_update_registro_bloqueado(self):
        reg = self._seed_registro(self._seed_actividad())
        self._patch(self.tecnico, T_REG, reg, {"producto_usado": "MODIFICADO-POR-TECNICO"})
        self.assertIsNone(self._fila(T_REG, reg)["producto_usado"], "tecnico_campo modificó un registro")

    def test_tecnico_delete_registro_bloqueado(self):
        reg = self._seed_registro(self._seed_actividad())
        self._delete(self.tecnico, T_REG, reg)
        self.assertIsNotNone(self._fila(T_REG, reg), "tecnico_campo borró un registro")

    # ---- (b) admin: todo permitido en ambas tablas ----

    def test_admin_crud_catalogo(self):
        res = self._post(self.admin, T_ACT, self._nueva_actividad_payload(tag="adm"))
        self.assertEqual(res.status_code, 201, res.text)
        act = res.json()[0]["id"]
        self._cleanup.append((T_ACT, act))
        up = self._patch(self.admin, T_ACT, act, {"frecuencia_dias": 21})
        self.assertEqual(up.status_code, 200, up.text)
        self.assertEqual(self._fila(T_ACT, act)["frecuencia_dias"], 21)
        self._delete(self.admin, T_ACT, act)
        self.assertIsNone(self._fila(T_ACT, act), "admin debe poder borrar una actividad (sin registros)")

    def test_admin_crud_registros(self):
        act = self._seed_actividad()
        res = self._post(self.admin, T_REG, {"ID_Organizacion": ORG, "actividad_id": act})
        self.assertEqual(res.status_code, 201, res.text)
        reg = res.json()[0]["id"]
        self._cleanup.append((T_REG, reg))
        up = self._patch(self.admin, T_REG, reg, {"producto_usado": "corregido-por-admin"})
        self.assertEqual(up.status_code, 200, up.text)
        self.assertEqual(self._fila(T_REG, reg)["producto_usado"], "corregido-por-admin")
        self._delete(self.admin, T_REG, reg)
        self.assertIsNone(self._fila(T_REG, reg), "admin debe poder borrar un registro")

    # ---- (c) aislamiento cruzado de organización, ambos roles, ambas tablas ----

    def _por_cada_rol(self):
        return (("admin", self.admin), ("tecnico_campo", self.tecnico))

    def test_cross_org_lectura(self):
        act_b = self._seed_actividad(org=ORG_AJENA)
        reg_b = self._seed_registro(act_b, org=ORG_AJENA)
        for rol, token in self._por_cada_rol():
            for tabla, id_ in ((T_ACT, act_b), (T_REG, reg_b)):
                with self.subTest(rol=rol, tabla=tabla):
                    res = self._get(token, tabla, id_)
                    self.assertEqual(res.status_code, 200)
                    self.assertEqual(res.json(), [], f"{rol} de {ORG} ve filas de {ORG_AJENA} en {tabla}")

    def test_cross_org_insert(self):
        act_b = self._seed_actividad(org=ORG_AJENA)
        for rol, token in self._por_cada_rol():
            with self.subTest(rol=rol, tabla=T_ACT):
                res = self._post(token, T_ACT, self._nueva_actividad_payload(org=ORG_AJENA, tag=f"x-{rol}"))
                self._registrar_para_limpieza(T_ACT, res)
                self.assertEqual(res.status_code, 403, f"{rol}: insert de catálogo en org ajena. body={res.text}")
            with self.subTest(rol=rol, tabla=T_REG):
                res = self._post(token, T_REG, {"ID_Organizacion": ORG_AJENA, "actividad_id": act_b})
                self._registrar_para_limpieza(T_REG, res)
                self.assertEqual(res.status_code, 403, f"{rol}: insert de registro en org ajena. body={res.text}")

    def test_cross_org_update_delete(self):
        act_b = self._seed_actividad(org=ORG_AJENA)
        reg_b = self._seed_registro(act_b, org=ORG_AJENA)
        for rol, token in self._por_cada_rol():
            with self.subTest(rol=rol):
                self._patch(token, T_ACT, act_b, {"frecuencia_dias": 99})
                self._patch(token, T_REG, reg_b, {"producto_usado": f"HACK-{rol}"})
                self._delete(token, T_REG, reg_b)
                self._delete(token, T_ACT, act_b)
                self.assertEqual(self._fila(T_ACT, act_b)["frecuencia_dias"], 7, f"{rol} alteró/borró catálogo ajeno")
                fila_reg = self._fila(T_REG, reg_b)
                self.assertIsNotNone(fila_reg, f"{rol} borró un registro ajeno")
                self.assertIsNone(fila_reg["producto_usado"], f"{rol} alteró un registro ajeno")

    # ---- bonus: auditor_qc lee pero no escribe ----

    def test_auditor_lee_pero_no_escribe(self):
        act = self._seed_actividad(org=ORG_DEMO)
        self.assertEqual(len(self._get(self.auditor, T_ACT, act).json()), 1, "auditor_qc debe poder leer el catálogo")
        res_a = self._post(self.auditor, T_ACT, self._nueva_actividad_payload(org=ORG_DEMO, tag="aud"))
        self._registrar_para_limpieza(T_ACT, res_a)
        self.assertEqual(res_a.status_code, 403, res_a.text)
        res_r = self._post(self.auditor, T_REG, {"ID_Organizacion": ORG_DEMO, "actividad_id": act})
        self._registrar_para_limpieza(T_REG, res_r)
        self.assertEqual(res_r.status_code, 403, res_r.text)


if __name__ == "__main__":
    unittest.main()
