"""
Aislamiento RLS por rol de PECUARIO_PARTOS. Verifica
supabase/migrations/20261004130000_fix_rls_partos_por_rol.sql (aplicada
manualmente por Neyser en Studio):

  SELECT: toda la organización | INSERT/UPDATE: admin + tecnico_campo
  DELETE: solo admin
  INSERT/UPDATE: poza_id y macho_id (si viene) deben ser de la MISMA organización

El caso que cierra la migración: auditor_qc podía antes escribir partos.

Mismo patrón que tests/test_pecuario_compras_rls.py: las llamadas "de usuario"
usan la sesión REAL de cada cuenta (magic link); service_role solo siembra,
limpia y re-lee el estado verdadero. Un UPDATE/DELETE que el USING descarta no
da error en PostgREST (0 filas) -> se confirma releyendo con service_role. Un
INSERT/UPDATE que viola WITH CHECK da 403.

No es objeto de este archivo la validación de madre_id (la cubre el trigger
trg_partos_validar_madre); solo hay un test de cordura de que sigue intacto.
Los partos de estas pruebas no llevan madre_id, así que no disparan sugerencias.

Cuentas: GRANJA-TEST admin (dneyser5+test) y tecnico_campo (dneyser5+tecnico);
auditor demo de ORG-TEST-DEMO (no hay auditor en GRANJA-TEST). Org ajena:
COOP-AROMAS-VALLE. Todo lo sembrado lleva prefijo TEST- y se borra en tearDown
(partos antes que jaulas/reproductores, por las FK). Sin credenciales de
Supabase, los casos en vivo se saltan.
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
    / "supabase" / "migrations" / "20261004130000_fix_rls_partos_por_rol.sql"
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

T_PAR = "PECUARIO_PARTOS"
T_JAU = "PECUARIO_JAULAS"
T_REP = "PECUARIO_REPRODUCTORES"
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
    ini = sql.index(f'CREATE POLICY "{nombre}"')
    fin = sql.find("\n\n", ini)  # la última política del archivo no tiene línea en blanco después
    return sql[ini:] if fin == -1 else sql[ini:fin]


class TestMigrationFileStatic(unittest.TestCase):
    """Sin Supabase: el archivo dice lo que el negocio decidió y no regresa a la forma frágil."""

    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION_PATH.read_text(encoding="utf-8")
        cls.codigo = "\n".join(l for l in cls.sql.splitlines() if not l.lstrip().startswith("--"))

    def test_cuatro_politicas_y_all_reemplazada(self):
        self.assertEqual(len(re.findall(r"^CREATE POLICY", self.codigo, flags=re.M)), 4)
        self.assertIn('DROP POLICY IF EXISTS "rls_all_pecuario_partos"', self.codigo)
        self.assertNotIn("FOR ALL", self.codigo)

    def test_roles_por_comando(self):
        for cmd in ("insert", "update"):
            with self.subTest(cmd=cmd):
                b = _bloque_politica(self.sql, f"rls_{cmd}_pecuario_partos")
                self.assertIn("auth_role() IN ('admin', 'tecnico_campo')", b)
        b = _bloque_politica(self.sql, "rls_delete_pecuario_partos")
        self.assertIn("auth_role() = 'admin'", b)
        self.assertNotIn("tecnico_campo", b)
        self.assertNotIn("auth_role()", _bloque_politica(self.sql, "rls_select_pecuario_partos"))

    def test_referencias_de_los_exists_siempre_calificadas(self):
        # 2 políticas x (poza_id + 2 de macho_id) = 6 referencias a columnas de la fila
        # externa, todas calificadas; ninguna `= poza_id` / `= macho_id` suelta.
        self.assertEqual(self.codigo.count('"PECUARIO_PARTOS".poza_id'), 2)
        self.assertEqual(self.codigo.count('"PECUARIO_PARTOS".macho_id'), 4)
        self.assertEqual(self.codigo.count('= "PECUARIO_PARTOS"."ID_Organizacion"'), 4)
        self.assertIsNone(re.search(r"=\s*(poza_id|macho_id)\b", self.codigo))
        self.assertIsNone(re.search(r'\.\s*"ID_Organizacion"\s*=\s*"ID_Organizacion"', self.codigo))


@NEEDS_SUPABASE
class TestPartosRlsLive(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.admin = _magic_link_access_token(ADMIN_EMAIL)
        cls.tecnico = _magic_link_access_token(TECNICO_EMAIL)
        cls.auditor = _magic_link_access_token(AUDITOR_EMAIL)

    def setUp(self):
        self.sfx = str(int(time.time() * 1000))
        self._n = 0
        self._cleanup = []  # (tabla, id), LIFO

    def tearDown(self):
        for tabla, id_ in reversed(self._cleanup):
            httpx.delete(f"{SUPABASE_URL}/rest/v1/{tabla}", headers=_service_headers(), params={"id": f"eq.{id_}"}, timeout=30)

    # ---- siembra / lectura (service_role) ----

    def _seed(self, tabla, payload):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/{tabla}",
            headers={**_service_headers(), **JSON, "Prefer": "return=representation"}, json=payload, timeout=30,
        )
        res.raise_for_status()
        id_ = res.json()[0]["id"]
        self._cleanup.append((tabla, id_))
        return id_

    def _nombre(self):
        self._n += 1
        return f"TEST-PARTOS-{self.sfx}-{self._n}"

    def _jaula(self, org):
        return self._seed(T_JAU, {"ID_Organizacion": org, "codigo_poza": self._nombre()})

    def _macho(self, org):
        return self._seed(T_REP, {"ID_Organizacion": org, "codigo_arete": self._nombre(), "sexo": "macho"})

    def _parto_seed(self, org, poza_id, obs=None):
        payload = {"ID_Organizacion": org, "poza_id": poza_id, "n_vivos": 3, "n_muertos": 0}
        if obs is not None:
            payload["observaciones"] = obs
        return self._seed(T_PAR, payload)

    def _fila(self, id_):
        res = httpx.get(f"{SUPABASE_URL}/rest/v1/{T_PAR}", headers=_service_headers(), params={"id": f"eq.{id_}", "select": "*"}, timeout=30)
        res.raise_for_status()
        rows = res.json()
        return rows[0] if rows else None

    def _payload(self, org, poza_id, macho_id=None):
        p = {"ID_Organizacion": org, "poza_id": poza_id, "n_vivos": 4, "n_muertos": 0}
        if macho_id is not None:
            p["macho_id"] = macho_id
        return p

    # ---- llamadas con sesión real ----

    def _post(self, token, payload):
        return httpx.post(f"{SUPABASE_URL}/rest/v1/{T_PAR}", headers={**_session_headers(token), **JSON, "Prefer": "return=representation"}, json=payload, timeout=30)

    def _patch(self, token, id_, payload):
        return httpx.patch(f"{SUPABASE_URL}/rest/v1/{T_PAR}", headers={**_session_headers(token), **JSON, "Prefer": "return=representation"}, params={"id": f"eq.{id_}"}, json=payload, timeout=30)

    def _delete(self, token, id_):
        return httpx.delete(f"{SUPABASE_URL}/rest/v1/{T_PAR}", headers={**_session_headers(token), "Prefer": "return=representation"}, params={"id": f"eq.{id_}"}, timeout=30)

    def _get(self, token, id_):
        return httpx.get(f"{SUPABASE_URL}/rest/v1/{T_PAR}", headers=_session_headers(token), params={"id": f"eq.{id_}"}, timeout=30)

    def _registrar(self, res):
        """Si un INSERT que debía fallar prosperó, igual se limpia."""
        if res.status_code == 201:
            self._cleanup.append((T_PAR, res.json()[0]["id"]))

    def _por_cada_rol_escritor(self):
        return (("admin", self.admin), ("tecnico_campo", self.tecnico))

    # ---- SELECT ----

    def test_select_cada_rol_lee_los_partos_de_su_organizacion(self):
        p_org = self._parto_seed(ORG, self._jaula(ORG))
        p_demo = self._parto_seed(ORG_DEMO, self._jaula(ORG_DEMO))
        for rol, token, id_ in (("admin", self.admin, p_org), ("tecnico_campo", self.tecnico, p_org), ("auditor_qc", self.auditor, p_demo)):
            with self.subTest(rol=rol):
                res = self._get(token, id_)
                self.assertEqual(res.status_code, 200)
                self.assertEqual(len(res.json()), 1, f"{rol} debe leer los partos de su organización")

    def test_select_cross_org_ningun_rol_lee_partos_ajenos(self):
        p_b = self._parto_seed(ORG_AJENA, self._jaula(ORG_AJENA))
        for rol, token in (("admin", self.admin), ("tecnico_campo", self.tecnico), ("auditor_qc", self.auditor)):
            with self.subTest(rol=rol):
                res = self._get(token, p_b)
                self.assertEqual(res.status_code, 200)
                self.assertEqual(res.json(), [], f"{rol} ve partos de {ORG_AJENA}")

    # ---- INSERT ----

    def test_insert_admin_y_tecnico_permitido(self):
        poza = self._jaula(ORG)
        for rol, token in self._por_cada_rol_escritor():
            with self.subTest(rol=rol):
                res = self._post(token, self._payload(ORG, poza))
                self._registrar(res)
                self.assertEqual(res.status_code, 201, f"{rol} debe poder registrar un parto. body={res.text}")

    def test_insert_auditor_bloqueado(self):
        # Este es el caso que cierra la migración: antes un auditor_qc podía escribir partos.
        poza = self._jaula(ORG_DEMO)
        res = self._post(self.auditor, self._payload(ORG_DEMO, poza))
        self._registrar(res)
        self.assertEqual(res.status_code, 403, f"auditor_qc NO debe insertar partos. body={res.text}")

    def test_insert_macho_null_aceptado_y_macho_propio_aceptado(self):
        poza, macho = self._jaula(ORG), self._macho(ORG)
        for rol, token in self._por_cada_rol_escritor():
            with self.subTest(rol=rol, caso="macho NULL"):
                res = self._post(token, self._payload(ORG, poza, None))
                self._registrar(res)
                self.assertEqual(res.status_code, 201, res.text)
            with self.subTest(rol=rol, caso="macho de la propia organización"):
                res = self._post(token, self._payload(ORG, poza, macho))
                self._registrar(res)
                self.assertEqual(res.status_code, 201, res.text)

    def test_insert_poza_de_otra_organizacion_rechazado(self):
        poza_b = self._jaula(ORG_AJENA)
        for rol, token in self._por_cada_rol_escritor():
            with self.subTest(rol=rol):
                res = self._post(token, self._payload(ORG, poza_b))
                self._registrar(res)
                self.assertEqual(res.status_code, 403, f"{rol}: parto con poza de {ORG_AJENA}. body={res.text}")

    def test_insert_macho_de_otra_organizacion_rechazado(self):
        poza, macho_b = self._jaula(ORG), self._macho(ORG_AJENA)
        for rol, token in self._por_cada_rol_escritor():
            with self.subTest(rol=rol):
                res = self._post(token, self._payload(ORG, poza, macho_b))
                self._registrar(res)
                self.assertEqual(res.status_code, 403, f"{rol}: parto con macho de {ORG_AJENA}. body={res.text}")

    def test_insert_con_organizacion_ajena_rechazado(self):
        poza_b = self._jaula(ORG_AJENA)
        for rol, token in self._por_cada_rol_escritor():
            with self.subTest(rol=rol):
                res = self._post(token, self._payload(ORG_AJENA, poza_b))
                self._registrar(res)
                self.assertEqual(res.status_code, 403, f"{rol}: parto en org ajena. body={res.text}")

    # ---- UPDATE ----

    def test_update_admin_y_tecnico_permitido(self):
        for rol, token in self._por_cada_rol_escritor():
            with self.subTest(rol=rol):
                p = self._parto_seed(ORG, self._jaula(ORG))
                res = self._patch(token, p, {"observaciones": f"EDITADO-{rol}"})
                self.assertEqual(res.status_code, 200, res.text)
                self.assertEqual(self._fila(p)["observaciones"], f"EDITADO-{rol}")

    def test_update_auditor_bloqueado(self):
        p = self._parto_seed(ORG_DEMO, self._jaula(ORG_DEMO))
        self._patch(self.auditor, p, {"observaciones": "HACK-auditor"})
        self.assertIsNone(self._fila(p)["observaciones"], "auditor_qc modificó un parto")

    def test_update_hacia_poza_o_macho_de_otra_organizacion_rechazado(self):
        poza_a = self._jaula(ORG)
        poza_b, macho_b = self._jaula(ORG_AJENA), self._macho(ORG_AJENA)
        for rol, token in self._por_cada_rol_escritor():
            p = self._parto_seed(ORG, poza_a)
            for campo, valor in (("poza_id", poza_b), ("macho_id", macho_b)):
                with self.subTest(rol=rol, campo=campo):
                    res = self._patch(token, p, {campo: valor})
                    self.assertEqual(res.status_code, 403, f"{rol} re-apuntó {campo} a otra organización. body={res.text}")
                    fila = self._fila(p)
                    self.assertEqual(fila["poza_id"], poza_a)
                    self.assertIsNone(fila["macho_id"])

    def test_update_no_puede_mover_un_parto_a_otra_organizacion(self):
        p = self._parto_seed(ORG, self._jaula(ORG))
        res = self._patch(self.admin, p, {"ID_Organizacion": ORG_AJENA})
        self.assertEqual(res.status_code, 403, res.text)
        self.assertEqual(self._fila(p)["ID_Organizacion"], ORG)

    def test_update_cross_org_ningun_rol_toca_partos_ajenos(self):
        p_b = self._parto_seed(ORG_AJENA, self._jaula(ORG_AJENA))
        for rol, token in self._por_cada_rol_escritor():
            with self.subTest(rol=rol):
                self._patch(token, p_b, {"observaciones": f"HACK-{rol}"})
                self.assertIsNone(self._fila(p_b)["observaciones"], f"{rol} alteró un parto ajeno")

    # ---- DELETE ----

    def test_delete_solo_admin(self):
        p = self._parto_seed(ORG, self._jaula(ORG))
        self._delete(self.tecnico, p)
        self.assertIsNotNone(self._fila(p), "tecnico_campo borró un parto")
        self._delete(self.admin, p)
        self.assertIsNone(self._fila(p), "admin debe poder borrar un parto no recolectado")

    def test_delete_auditor_bloqueado(self):
        p = self._parto_seed(ORG_DEMO, self._jaula(ORG_DEMO))
        self._delete(self.auditor, p)
        self.assertIsNotNone(self._fila(p), "auditor_qc borró un parto")

    def test_delete_cross_org_ningun_rol_borra_partos_ajenos(self):
        p_b = self._parto_seed(ORG_AJENA, self._jaula(ORG_AJENA))
        for rol, token in self._por_cada_rol_escritor():
            with self.subTest(rol=rol):
                self._delete(token, p_b)
                self.assertIsNotNone(self._fila(p_b), f"{rol} borró un parto ajeno")

    # ---- cordura: la validación de madre_id (trigger) sigue intacta ----

    def test_trigger_validar_madre_sigue_rechazando_madre_de_otra_organizacion(self):
        poza = self._jaula(ORG)
        madre_b = self._seed(T_REP, {"ID_Organizacion": ORG_AJENA, "codigo_arete": self._nombre(), "sexo": "hembra"})
        payload = {**self._payload(ORG, poza), "madre_id": madre_b}
        res = self._post(self.admin, payload)
        self._registrar(res)
        self.assertEqual(res.status_code, 400, res.text)
        self.assertIn("madre_id", res.text)


if __name__ == "__main__":
    unittest.main()
