"""
Aislamiento RLS por rol + RPC atómica de Insumos -- PECUARIO_INSUMOS (catálogo),
PECUARIO_INSUMOS_MOVIMIENTOS y fn_crear_insumo_con_stock_inicial. Verifica
supabase/migrations/20261001223000_fix_rls_insumos_y_galpon_movimientos.sql
(aplicada) y el archivo 20261001230000_revoke_execute_publico_insumos.sql.

  catálogo:    SELECT org | INSERT/UPDATE/DELETE solo admin
  movimientos: SELECT org | INSERT admin+tecnico_campo | UPDATE/DELETE solo admin
  RPC:         solo admin de la propia organización; atómica

Mismo patrón que tests/test_pecuario_sanidad_rls_por_rol.py: las llamadas "de
usuario" usan la sesión REAL de cada cuenta (magic link); service_role solo
siembra, limpia y re-lee el estado verdadero. Un UPDATE/DELETE bloqueado por
USING no da error en PostgREST (0 filas) -> se confirma releyendo con
service_role. Un INSERT bloqueado da 403. Los errores de la RPC (RAISE
EXCEPTION) llegan como 400 con el mensaje en el cuerpo.

Cuentas: GRANJA-TEST admin (dneyser5+test) y tecnico_campo (dneyser5+tecnico);
auditor demo de ORG-TEST-DEMO. Org ajena: COOP-AROMAS-VALLE. Todo lo sembrado
lleva prefijo TEST- y se borra en tearDown (movimientos antes que insumos por
la FK RESTRICT).

NO cubierto acá (a propósito): que anon no pueda ejecutar la RPC. Eso solo se
cumple una vez aplicada 20261001230000_revoke_execute_publico_insumos.sql; un
test que falle hasta entonces dejaría la suite en rojo. Se agrega después de
aplicarla. Sin credenciales de Supabase, los casos en vivo se saltan.
"""

import os
import re
import time
import unittest
import uuid
from pathlib import Path

import httpx
import pytest

MIGRATIONS = Path(__file__).resolve().parent.parent / "supabase" / "migrations"
REVOKE_PATH = MIGRATIONS / "20261001230000_revoke_execute_publico_insumos.sql"

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

T_INS = "PECUARIO_INSUMOS"
T_MOV = "PECUARIO_INSUMOS_MOVIMIENTOS"
T_GAL = "PECUARIO_GALPONES"
RPC = "fn_crear_insumo_con_stock_inicial"
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


class TestRevokeMigrationStatic(unittest.TestCase):
    """Sin Supabase: el archivo del REVOKE dice lo que debe y nada más."""

    @classmethod
    def setUpClass(cls):
        sql = REVOKE_PATH.read_text(encoding="utf-8")
        cls.codigo = "\n".join(l for l in sql.splitlines() if not l.lstrip().startswith("--"))

    def test_revoca_public_y_anon_por_separado(self):
        self.assertIn("REVOKE EXECUTE ON FUNCTION fn_crear_insumo_con_stock_inicial FROM PUBLIC;", self.codigo)
        self.assertIn("REVOKE EXECUTE ON FUNCTION fn_crear_insumo_con_stock_inicial FROM anon;", self.codigo)

    def test_no_otorga_ni_revoca_otra_cosa(self):
        self.assertEqual(len(re.findall(r"^REVOKE ", self.codigo, flags=re.M)), 2)
        self.assertNotIn("GRANT", self.codigo)
        self.assertNotIn("authenticated", self.codigo)
        self.assertNotIn("service_role", self.codigo)


@NEEDS_SUPABASE
class TestInsumosRlsYRpcLive(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.admin = _magic_link_access_token(ADMIN_EMAIL)
        cls.tecnico = _magic_link_access_token(TECNICO_EMAIL)
        cls.auditor = _magic_link_access_token(AUDITOR_EMAIL)

    def setUp(self):
        self.sfx = str(int(time.time() * 1000))
        self._cleanup = []  # (tabla, campo, valor), LIFO

    def tearDown(self):
        for tabla, campo, valor in reversed(self._cleanup):
            httpx.delete(f"{SUPABASE_URL}/rest/v1/{tabla}", headers=_service_headers(), params={campo: f"eq.{valor}"}, timeout=30)

    # ---- helpers ----

    def _seed(self, tabla, payload):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/{tabla}",
            headers={**_service_headers(), **JSON, "Prefer": "return=representation"}, json=payload, timeout=30,
        )
        res.raise_for_status()
        id_ = res.json()[0]["id"]
        self._cleanup.append((tabla, "id", id_))
        return id_

    def _seed_insumo(self, org=ORG, tag="seed"):
        return self._seed(T_INS, {"ID_Organizacion": org, "nombre": f"TEST-INS-{tag}-{self.sfx}", "categoria": "alimento", "unidad_medida": "kg"})

    def _seed_movimiento(self, insumo_id, org=ORG):
        return self._seed(T_MOV, {"ID_Organizacion": org, "insumo_id": insumo_id, "tipo_movimiento": "entrada", "cantidad": 10})

    def _seed_galpon(self, org=ORG):
        return self._seed(T_GAL, {"ID_Organizacion": org, "codigo_galpon": f"TEST-INS-{self.sfx}"})

    def _fila(self, tabla, id_):
        res = httpx.get(f"{SUPABASE_URL}/rest/v1/{tabla}", headers=_service_headers(), params={"id": f"eq.{id_}", "select": "*"}, timeout=30)
        res.raise_for_status()
        rows = res.json()
        return rows[0] if rows else None

    def _filas_por(self, tabla, campo, valor):
        res = httpx.get(f"{SUPABASE_URL}/rest/v1/{tabla}", headers=_service_headers(), params={campo: f"eq.{valor}", "select": "*"}, timeout=30)
        res.raise_for_status()
        return res.json()

    def _post(self, token, tabla, payload):
        return httpx.post(f"{SUPABASE_URL}/rest/v1/{tabla}", headers={**_session_headers(token), **JSON, "Prefer": "return=representation"}, json=payload, timeout=30)

    def _patch(self, token, tabla, id_, payload):
        return httpx.patch(f"{SUPABASE_URL}/rest/v1/{tabla}", headers={**_session_headers(token), **JSON, "Prefer": "return=representation"}, params={"id": f"eq.{id_}"}, json=payload, timeout=30)

    def _delete(self, token, tabla, id_):
        return httpx.delete(f"{SUPABASE_URL}/rest/v1/{tabla}", headers={**_session_headers(token), "Prefer": "return=representation"}, params={"id": f"eq.{id_}"}, timeout=30)

    def _get(self, token, tabla, id_):
        return httpx.get(f"{SUPABASE_URL}/rest/v1/{tabla}", headers=_session_headers(token), params={"id": f"eq.{id_}"}, timeout=30)

    def _payload_insumo(self, org=ORG, tag="x"):
        return {"ID_Organizacion": org, "nombre": f"TEST-INS-{tag}-{self.sfx}", "categoria": "alimento", "unidad_medida": "kg"}

    def _registrar_para_limpieza(self, tabla, res):
        if res.status_code == 201:
            self._cleanup.append((tabla, "id", res.json()[0]["id"]))

    def _rpc(self, token, **overrides):
        """Llama la RPC con la sesión dada; devuelve (response, insumo_id, movimiento_id)."""
        insumo_id, mov_id = str(uuid.uuid4()), str(uuid.uuid4())
        # limpieza: movimientos primero (FK RESTRICT), luego el insumo (LIFO).
        self._cleanup.append((T_INS, "id", insumo_id))
        self._cleanup.append((T_MOV, "insumo_id", insumo_id))
        body = {
            "p_insumo_id": insumo_id, "p_id_organizacion": ORG, "p_nombre": f"TEST-INS-rpc-{self.sfx}",
            "p_categoria": "alimento", "p_unidad_medida": "kg", "p_stock_minimo": 5, "p_activo": True,
            "p_device_id": "test-device", "p_created_offline_at": "2026-10-01T12:00:00Z",
            "p_stock_inicial": 25, "p_movimiento_id": mov_id, "p_galpon_id": None,
        }
        body.update(overrides)
        res = httpx.post(f"{SUPABASE_URL}/rest/v1/rpc/{RPC}", headers={**_session_headers(token), **JSON}, json=body, timeout=30)
        return res, body["p_insumo_id"], body["p_movimiento_id"]

    # ---- (a) tecnico_campo ----

    def test_tecnico_insert_catalogo_bloqueado(self):
        res = self._post(self.tecnico, T_INS, self._payload_insumo(tag="tec"))
        self._registrar_para_limpieza(T_INS, res)
        self.assertEqual(res.status_code, 403, f"tecnico_campo NO debe insertar en el catálogo. body={res.text}")

    def test_tecnico_update_delete_catalogo_bloqueados(self):
        ins = self._seed_insumo()
        self._patch(self.tecnico, T_INS, ins, {"stock_minimo": 99})
        self.assertIsNone(self._fila(T_INS, ins)["stock_minimo"], "tecnico_campo modificó el catálogo")
        self._delete(self.tecnico, T_INS, ins)
        self.assertIsNotNone(self._fila(T_INS, ins), "tecnico_campo borró un insumo")

    def test_tecnico_lee_catalogo_y_movimientos(self):
        ins = self._seed_insumo()
        mov = self._seed_movimiento(ins)
        self.assertEqual(len(self._get(self.tecnico, T_INS, ins).json()), 1)
        self.assertEqual(len(self._get(self.tecnico, T_MOV, mov).json()), 1)

    def test_tecnico_insert_movimiento_permitido(self):
        ins = self._seed_insumo()
        res = self._post(self.tecnico, T_MOV, {"ID_Organizacion": ORG, "insumo_id": ins, "tipo_movimiento": "salida", "cantidad": 3})
        self._registrar_para_limpieza(T_MOV, res)
        self.assertEqual(res.status_code, 201, res.text)

    def test_tecnico_update_delete_movimiento_bloqueados(self):
        mov = self._seed_movimiento(self._seed_insumo())
        self._patch(self.tecnico, T_MOV, mov, {"observaciones": "MODIFICADO-POR-TECNICO"})
        self.assertIsNone(self._fila(T_MOV, mov)["observaciones"], "tecnico_campo modificó un movimiento")
        self._delete(self.tecnico, T_MOV, mov)
        self.assertIsNotNone(self._fila(T_MOV, mov), "tecnico_campo borró un movimiento")

    # ---- (b) admin: acceso completo ----

    def test_admin_crud_catalogo(self):
        res = self._post(self.admin, T_INS, self._payload_insumo(tag="adm"))
        self.assertEqual(res.status_code, 201, res.text)
        ins = res.json()[0]["id"]
        self._cleanup.append((T_INS, "id", ins))
        up = self._patch(self.admin, T_INS, ins, {"stock_minimo": 7})
        self.assertEqual(up.status_code, 200, up.text)
        self.assertEqual(float(self._fila(T_INS, ins)["stock_minimo"]), 7.0)
        self._delete(self.admin, T_INS, ins)
        self.assertIsNone(self._fila(T_INS, ins), "admin debe poder borrar un insumo sin movimientos")

    def test_admin_crud_movimientos(self):
        ins = self._seed_insumo()
        res = self._post(self.admin, T_MOV, {"ID_Organizacion": ORG, "insumo_id": ins, "tipo_movimiento": "entrada", "cantidad": 4})
        self.assertEqual(res.status_code, 201, res.text)
        mov = res.json()[0]["id"]
        self._cleanup.append((T_MOV, "id", mov))
        up = self._patch(self.admin, T_MOV, mov, {"observaciones": "corregido-por-admin"})
        self.assertEqual(up.status_code, 200, up.text)
        self.assertEqual(self._fila(T_MOV, mov)["observaciones"], "corregido-por-admin")
        self._delete(self.admin, T_MOV, mov)
        self.assertIsNone(self._fila(T_MOV, mov), "admin debe poder borrar un movimiento")

    # ---- (c) aislamiento cruzado de organización ----

    def _por_cada_rol(self):
        return (("admin", self.admin), ("tecnico_campo", self.tecnico))

    def test_cross_org_lectura(self):
        ins_b = self._seed_insumo(org=ORG_AJENA)
        mov_b = self._seed_movimiento(ins_b, org=ORG_AJENA)
        for rol, token in self._por_cada_rol():
            for tabla, id_ in ((T_INS, ins_b), (T_MOV, mov_b)):
                with self.subTest(rol=rol, tabla=tabla):
                    res = self._get(token, tabla, id_)
                    self.assertEqual(res.status_code, 200)
                    self.assertEqual(res.json(), [], f"{rol} de {ORG} ve filas de {ORG_AJENA} en {tabla}")

    def test_cross_org_insert(self):
        ins_b = self._seed_insumo(org=ORG_AJENA)
        for rol, token in self._por_cada_rol():
            with self.subTest(rol=rol, tabla=T_INS):
                res = self._post(token, T_INS, self._payload_insumo(org=ORG_AJENA, tag=f"x-{rol}"))
                self._registrar_para_limpieza(T_INS, res)
                self.assertEqual(res.status_code, 403, f"{rol}: insert de catálogo en org ajena. body={res.text}")
            with self.subTest(rol=rol, tabla=T_MOV):
                res = self._post(token, T_MOV, {"ID_Organizacion": ORG_AJENA, "insumo_id": ins_b, "tipo_movimiento": "entrada", "cantidad": 1})
                self._registrar_para_limpieza(T_MOV, res)
                self.assertEqual(res.status_code, 403, f"{rol}: insert de movimiento en org ajena. body={res.text}")

    def test_cross_org_update_delete(self):
        ins_b = self._seed_insumo(org=ORG_AJENA)
        mov_b = self._seed_movimiento(ins_b, org=ORG_AJENA)
        for rol, token in self._por_cada_rol():
            with self.subTest(rol=rol):
                self._patch(token, T_INS, ins_b, {"stock_minimo": 99})
                self._patch(token, T_MOV, mov_b, {"observaciones": f"HACK-{rol}"})
                self._delete(token, T_MOV, mov_b)
                self._delete(token, T_INS, ins_b)
                fila_ins = self._fila(T_INS, ins_b)
                self.assertIsNotNone(fila_ins, f"{rol} borró un insumo ajeno")
                self.assertIsNone(fila_ins["stock_minimo"], f"{rol} alteró un insumo ajeno")
                fila_mov = self._fila(T_MOV, mov_b)
                self.assertIsNotNone(fila_mov, f"{rol} borró un movimiento ajeno")
                self.assertIsNone(fila_mov["observaciones"], f"{rol} alteró un movimiento ajeno")

    # ---- (d) auditor_qc: solo lectura ----

    def test_auditor_lee_pero_no_escribe(self):
        ins = self._seed_insumo(org=ORG_DEMO)
        mov = self._seed_movimiento(ins, org=ORG_DEMO)
        self.assertEqual(len(self._get(self.auditor, T_INS, ins).json()), 1, "auditor_qc debe leer el catálogo")
        self.assertEqual(len(self._get(self.auditor, T_MOV, mov).json()), 1, "auditor_qc debe leer los movimientos")
        res_i = self._post(self.auditor, T_INS, self._payload_insumo(org=ORG_DEMO, tag="aud"))
        self._registrar_para_limpieza(T_INS, res_i)
        self.assertEqual(res_i.status_code, 403, res_i.text)
        res_m = self._post(self.auditor, T_MOV, {"ID_Organizacion": ORG_DEMO, "insumo_id": ins, "tipo_movimiento": "entrada", "cantidad": 1})
        self._registrar_para_limpieza(T_MOV, res_m)
        self.assertEqual(res_m.status_code, 403, res_m.text)
        self._patch(self.auditor, T_MOV, mov, {"observaciones": "HACK-auditor"})
        self._delete(self.auditor, T_MOV, mov)
        fila = self._fila(T_MOV, mov)
        self.assertIsNotNone(fila, "auditor_qc borró un movimiento")
        self.assertIsNone(fila["observaciones"], "auditor_qc modificó un movimiento")

    # ---- (e) RPC fn_crear_insumo_con_stock_inicial ----

    def test_rpc_admin_crea_insumo_y_movimiento_de_entrada(self):
        galpon = self._seed_galpon()
        res, ins, mov = self._rpc(self.admin, p_galpon_id=galpon)
        self.assertIn(res.status_code, (200, 204), res.text)
        fila_ins = self._fila(T_INS, ins)
        self.assertIsNotNone(fila_ins, "la RPC no creó el insumo")
        self.assertEqual(fila_ins["ID_Organizacion"], ORG)
        self.assertEqual(fila_ins["categoria"], "alimento")
        fila_mov = self._fila(T_MOV, mov)
        self.assertIsNotNone(fila_mov, "la RPC no creó el movimiento de entrada inicial")
        self.assertEqual(fila_mov["insumo_id"], ins)
        self.assertEqual(fila_mov["tipo_movimiento"], "entrada")
        self.assertEqual(float(fila_mov["cantidad"]), 25.0)
        self.assertEqual(fila_mov["galpon_id"], galpon)

    def test_rpc_sin_stock_inicial_crea_solo_el_insumo(self):
        res, ins, mov = self._rpc(self.admin, p_stock_inicial=None, p_movimiento_id=None)
        self.assertIn(res.status_code, (200, 204), res.text)
        self.assertIsNotNone(self._fila(T_INS, ins))
        self.assertEqual(self._filas_por(T_MOV, "insumo_id", ins), [], "no debe haber movimiento sin stock inicial")

    def test_rpc_stock_inicial_sin_movimiento_id_falla(self):
        res, ins, _ = self._rpc(self.admin, p_movimiento_id=None)
        self.assertEqual(res.status_code, 400, res.text)
        self.assertIn("p_movimiento_id es obligatorio", res.text)
        self.assertIsNone(self._fila(T_INS, ins), "no debe quedar un insumo huérfano")

    def test_rpc_tecnico_rechazado_solo_admin(self):
        res, ins, mov = self._rpc(self.tecnico)
        self.assertEqual(res.status_code, 400, res.text)
        self.assertIn("solo admin puede crear insumos", res.text)
        self.assertIsNone(self._fila(T_INS, ins), "tecnico_campo creó un insumo por la RPC")
        self.assertIsNone(self._fila(T_MOV, mov), "tecnico_campo creó un movimiento por la RPC")

    def test_rpc_auditor_rechazado_solo_admin(self):
        res, ins, _ = self._rpc(self.auditor, p_id_organizacion=ORG_DEMO)
        self.assertEqual(res.status_code, 400, res.text)
        self.assertIn("solo admin puede crear insumos", res.text)
        self.assertIsNone(self._fila(T_INS, ins))

    def test_rpc_galpon_de_otra_organizacion_rechazado_y_atomico(self):
        galpon_ajeno = self._seed_galpon(org=ORG_AJENA)
        res, ins, mov = self._rpc(self.admin, p_galpon_id=galpon_ajeno)
        self.assertEqual(res.status_code, 400, res.text)
        self.assertIn("El galpón indicado no pertenece a la organización", res.text)
        # Atomicidad: el insumo se insertó ANTES de la validación del galpón; si
        # el error no revirtiera todo, quedaría un insumo huérfano.
        self.assertIsNone(self._fila(T_INS, ins), "quedó un insumo huérfano: la RPC no es atómica")
        self.assertIsNone(self._fila(T_MOV, mov))

    def test_rpc_organizacion_distinta_a_la_sesion_rechazada(self):
        res, ins, mov = self._rpc(self.admin, p_id_organizacion=ORG_AJENA)
        self.assertEqual(res.status_code, 400, res.text)
        self.assertIn("organización no coincide", res.text)
        self.assertIsNone(self._fila(T_INS, ins), "un admin creó un insumo en otra organización por la RPC")
        self.assertIsNone(self._fila(T_MOV, mov))


if __name__ == "__main__":
    unittest.main()
