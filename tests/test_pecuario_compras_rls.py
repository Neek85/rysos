"""
Aislamiento RLS por rol de PECUARIO_COMPRAS + trigger que copia galpon_id.
Verifica supabase/migrations/20261001234500_fix_rls_compras_y_galpon_trigger.sql
(aplicada manualmente por Neyser en Studio):

  SELECT: toda la organización | INSERT/UPDATE/DELETE: solo admin
  INSERT/UPDATE: insumo_id y galpon_id (si vienen) deben ser de la MISMA organización
  trigger: la entrada automática de stock trae el galpon_id de la compra

Mismo patrón que tests/test_pecuario_insumos_rls_y_rpc.py: las llamadas "de
usuario" usan la sesión REAL de cada cuenta (magic link); service_role solo
siembra, limpia y re-lee el estado verdadero. Un UPDATE/DELETE que el USING
descarta no da error en PostgREST (0 filas) -> se confirma releyendo con
service_role. Un INSERT/UPDATE que viola WITH CHECK da 403.

El caso (d) es el que justifica la corrección de scoping: con
`i."ID_Organizacion" = "ID_Organizacion"` (sin calificar) el EXISTS era una
tautología y una compra de la org A apuntando a un insumo/galpón de la org B
pasaba como válida. Tiene que ser RECHAZADA.

Cuentas: GRANJA-TEST admin (dneyser5+test) y tecnico_campo (dneyser5+tecnico);
auditor demo de ORG-TEST-DEMO (no hay auditor en GRANJA-TEST). Org ajena:
COOP-AROMAS-VALLE. Todo lo sembrado lleva prefijo TEST- y se borra en tearDown
(compras, luego movimientos, luego insumos/galpones, por las FK RESTRICT).
Sin credenciales de Supabase, los casos en vivo se saltan.
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
    / "supabase" / "migrations" / "20261001234500_fix_rls_compras_y_galpon_trigger.sql"
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

T_COM = "PECUARIO_COMPRAS"
T_INS = "PECUARIO_INSUMOS"
T_GAL = "PECUARIO_GALPONES"
T_MOV = "PECUARIO_INSUMOS_MOVIMIENTOS"
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
    return sql[ini: sql.index("\n\n", ini)]


class TestMigrationFileStatic(unittest.TestCase):
    """Sin Supabase: el archivo dice lo que el negocio decidió y no regresa al bug."""

    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION_PATH.read_text(encoding="utf-8")
        cls.codigo = "\n".join(l for l in cls.sql.splitlines() if not l.lstrip().startswith("--"))

    def test_cuatro_politicas_y_all_reemplazada(self):
        self.assertEqual(len(re.findall(r"^CREATE POLICY", self.codigo, flags=re.M)), 4)
        self.assertIn('DROP POLICY IF EXISTS "rls_all_pecuario_compras"', self.codigo)
        self.assertNotIn("FOR ALL", self.codigo)

    def test_escritura_solo_admin_y_select_sin_rol(self):
        for cmd in ("insert", "update", "delete"):
            with self.subTest(cmd=cmd):
                b = _bloque_politica(self.sql, f"rls_{cmd}_pecuario_compras")
                self.assertIn("auth_role() = 'admin'", b)
                self.assertNotIn("tecnico_campo", b)
        self.assertNotIn("auth_role()", _bloque_politica(self.sql, "rls_select_pecuario_compras"))

    def test_scoping_calificado_no_regresa_al_bug(self):
        # Las 4 comparaciones de organización dentro de los EXISTS deben usar la
        # tabla externa calificada; sin calificar es una tautología.
        self.assertEqual(self.codigo.count('= "PECUARIO_COMPRAS"."ID_Organizacion"'), 4)
        self.assertIsNone(re.search(r'\.\s*"ID_Organizacion"\s*=\s*"ID_Organizacion"', self.codigo),
                          "ID_Organizacion sin calificar dentro de un EXISTS (tautología)")

    def test_trigger_copia_galpon_id(self):
        self.assertIn("galpon_id, observaciones", self.codigo)
        self.assertIn("NEW.galpon_id", self.codigo)


@NEEDS_SUPABASE
class TestComprasRlsLive(unittest.TestCase):
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

    # ---- siembra / lectura (service_role) ----

    def _seed(self, tabla, payload):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/{tabla}",
            headers={**_service_headers(), **JSON, "Prefer": "return=representation"}, json=payload, timeout=30,
        )
        res.raise_for_status()
        id_ = res.json()[0]["id"]
        self._cleanup.append((tabla, "id", id_))
        return id_

    def _seed_insumo(self, org):
        id_ = self._seed(T_INS, {"ID_Organizacion": org, "nombre": f"TEST-COM-{org}-{self.sfx}", "categoria": "alimento", "unidad_medida": "kg"})
        # Las entradas automáticas de las compras de insumo cuelgan de él (FK
        # RESTRICT): se borran ANTES que el insumo (LIFO).
        self._cleanup.append((T_MOV, "insumo_id", id_))
        return id_

    def _seed_galpon(self, org):
        return self._seed(T_GAL, {"ID_Organizacion": org, "codigo_galpon": f"TEST-COM-{self.sfx}"})

    def _payload_servicio(self, org=ORG, tag="x"):
        return {"ID_Organizacion": org, "concepto": "servicio_otro", "categoria_gasto": "otro",
                "descripcion": f"TEST-COMPRA-{tag}-{self.sfx}", "monto_servicio": 10}

    def _payload_insumo(self, org, insumo_id, galpon_id):
        return {"ID_Organizacion": org, "concepto": "insumo", "insumo_id": insumo_id,
                "cantidad": 5, "galpon_id": galpon_id, "costo_insumo": 100, "flete": 10}

    def _seed_compra_servicio(self, org=ORG, tag="seed"):
        return self._seed(T_COM, self._payload_servicio(org, tag))

    def _fila(self, tabla, id_):
        res = httpx.get(f"{SUPABASE_URL}/rest/v1/{tabla}", headers=_service_headers(), params={"id": f"eq.{id_}", "select": "*"}, timeout=30)
        res.raise_for_status()
        rows = res.json()
        return rows[0] if rows else None

    def _filas_por(self, tabla, campo, valor):
        res = httpx.get(f"{SUPABASE_URL}/rest/v1/{tabla}", headers=_service_headers(), params={campo: f"eq.{valor}", "select": "*"}, timeout=30)
        res.raise_for_status()
        return res.json()

    # ---- llamadas con sesión real ----

    def _post(self, token, payload):
        return httpx.post(f"{SUPABASE_URL}/rest/v1/{T_COM}", headers={**_session_headers(token), **JSON, "Prefer": "return=representation"}, json=payload, timeout=30)

    def _patch(self, token, id_, payload):
        return httpx.patch(f"{SUPABASE_URL}/rest/v1/{T_COM}", headers={**_session_headers(token), **JSON, "Prefer": "return=representation"}, params={"id": f"eq.{id_}"}, json=payload, timeout=30)

    def _delete(self, token, id_):
        return httpx.delete(f"{SUPABASE_URL}/rest/v1/{T_COM}", headers={**_session_headers(token), "Prefer": "return=representation"}, params={"id": f"eq.{id_}"}, timeout=30)

    def _get(self, token, id_):
        return httpx.get(f"{SUPABASE_URL}/rest/v1/{T_COM}", headers=_session_headers(token), params={"id": f"eq.{id_}"}, timeout=30)

    def _registrar(self, res):
        """Si un INSERT que debía fallar prosperó, igual se limpia."""
        if res.status_code == 201:
            self._cleanup.append((T_COM, "id", res.json()[0]["id"]))

    # ---- (a) SELECT ----

    def test_select_cada_rol_lee_sus_compras(self):
        c_org = self._seed_compra_servicio(ORG, "lee-org")
        c_demo = self._seed_compra_servicio(ORG_DEMO, "lee-demo")
        for rol, token, id_ in (("admin", self.admin, c_org), ("tecnico_campo", self.tecnico, c_org), ("auditor_qc", self.auditor, c_demo)):
            with self.subTest(rol=rol):
                res = self._get(token, id_)
                self.assertEqual(res.status_code, 200)
                self.assertEqual(len(res.json()), 1, f"{rol} debe leer las compras de su organización")

    def test_select_cross_org_ningun_rol_lee_otra_organizacion(self):
        c_b = self._seed_compra_servicio(ORG_AJENA, "ajena")
        for rol, token in (("admin", self.admin), ("tecnico_campo", self.tecnico), ("auditor_qc", self.auditor)):
            with self.subTest(rol=rol):
                res = self._get(token, c_b)
                self.assertEqual(res.status_code, 200)
                self.assertEqual(res.json(), [], f"{rol} ve compras de {ORG_AJENA}")

    # ---- (b) INSERT por rol (concepto servicio) ----

    def test_insert_servicio_admin_permitido(self):
        res = self._post(self.admin, self._payload_servicio(ORG, "adm"))
        self._registrar(res)
        self.assertEqual(res.status_code, 201, res.text)
        self.assertEqual(float(res.json()[0]["monto_total"]), 10.0)

    def test_insert_tecnico_y_auditor_bloqueados(self):
        for rol, token, org in (("tecnico_campo", self.tecnico, ORG), ("auditor_qc", self.auditor, ORG_DEMO)):
            with self.subTest(rol=rol):
                res = self._post(token, self._payload_servicio(org, rol))
                self._registrar(res)
                self.assertEqual(res.status_code, 403, f"{rol} NO debe insertar compras. body={res.text}")

    # ---- (c) INSERT concepto insumo con FK de la propia organización ----

    def test_insert_insumo_admin_con_fks_propias(self):
        insumo, galpon = self._seed_insumo(ORG), self._seed_galpon(ORG)
        res = self._post(self.admin, self._payload_insumo(ORG, insumo, galpon))
        self._registrar(res)
        self.assertEqual(res.status_code, 201, res.text)
        self.assertEqual(float(res.json()[0]["monto_total"]), 110.0)

    # ---- (d) caso crítico: FKs de OTRA organización deben ser rechazadas ----

    def test_insert_insumo_de_otra_organizacion_rechazado(self):
        insumo_b, galpon_b = self._seed_insumo(ORG_AJENA), self._seed_galpon(ORG_AJENA)
        insumo_a, galpon_a = self._seed_insumo(ORG), self._seed_galpon(ORG)
        casos = {
            "insumo ajeno": self._payload_insumo(ORG, insumo_b, galpon_a),
            "galpon ajeno": self._payload_insumo(ORG, insumo_a, galpon_b),
            "ambos ajenos": self._payload_insumo(ORG, insumo_b, galpon_b),
        }
        for nombre, payload in casos.items():
            with self.subTest(caso=nombre):
                res = self._post(self.admin, payload)
                self._registrar(res)
                self.assertEqual(res.status_code, 403,
                                 f"admin de {ORG} creó una compra con {nombre} de {ORG_AJENA} (bug de scoping). body={res.text}")

    # ---- (e) UPDATE ----

    def test_update_admin_permitido_en_su_organizacion(self):
        c = self._seed_compra_servicio(ORG, "upd")
        res = self._patch(self.admin, c, {"descripcion": f"TEST-EDITADA-{self.sfx}"})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(self._fila(T_COM, c)["descripcion"], f"TEST-EDITADA-{self.sfx}")

    def test_update_tecnico_y_auditor_bloqueados(self):
        for rol, token, org in (("tecnico_campo", self.tecnico, ORG), ("auditor_qc", self.auditor, ORG_DEMO)):
            with self.subTest(rol=rol):
                c = self._seed_compra_servicio(org, f"upd-{rol}")
                original = self._fila(T_COM, c)["descripcion"]
                self._patch(token, c, {"descripcion": f"HACK-{rol}"})
                self.assertEqual(self._fila(T_COM, c)["descripcion"], original, f"{rol} modificó una compra")

    def test_update_admin_hacia_insumo_o_galpon_de_otra_organizacion_rechazado(self):
        insumo_a, galpon_a = self._seed_insumo(ORG), self._seed_galpon(ORG)
        insumo_b, galpon_b = self._seed_insumo(ORG_AJENA), self._seed_galpon(ORG_AJENA)
        c = self._seed(T_COM, self._payload_insumo(ORG, insumo_a, galpon_a))
        for campo, valor in (("insumo_id", insumo_b), ("galpon_id", galpon_b)):
            with self.subTest(campo=campo):
                res = self._patch(self.admin, c, {campo: valor})
                self.assertEqual(res.status_code, 403, f"admin re-apuntó {campo} a otra organización. body={res.text}")
                fila = self._fila(T_COM, c)
                self.assertEqual(fila["insumo_id"], insumo_a)
                self.assertEqual(fila["galpon_id"], galpon_a)

    def test_update_admin_no_puede_mover_compra_a_otra_organizacion(self):
        c = self._seed_compra_servicio(ORG, "mover")
        res = self._patch(self.admin, c, {"ID_Organizacion": ORG_AJENA})
        self.assertEqual(res.status_code, 403, res.text)
        self.assertEqual(self._fila(T_COM, c)["ID_Organizacion"], ORG)

    def test_update_cross_org_ningun_rol_toca_compras_ajenas(self):
        c_b = self._seed_compra_servicio(ORG_AJENA, "upd-ajena")
        original = self._fila(T_COM, c_b)["descripcion"]
        for rol, token in (("admin", self.admin), ("tecnico_campo", self.tecnico)):
            with self.subTest(rol=rol):
                self._patch(token, c_b, {"descripcion": f"HACK-{rol}"})
                self.assertEqual(self._fila(T_COM, c_b)["descripcion"], original, f"{rol} alteró una compra ajena")

    # ---- (f) DELETE ----

    def test_delete_admin_permitido_en_su_organizacion(self):
        c = self._seed_compra_servicio(ORG, "del")
        self._delete(self.admin, c)
        self.assertIsNone(self._fila(T_COM, c), "admin debe poder borrar una compra de su organización")

    def test_delete_tecnico_y_auditor_bloqueados(self):
        for rol, token, org in (("tecnico_campo", self.tecnico, ORG), ("auditor_qc", self.auditor, ORG_DEMO)):
            with self.subTest(rol=rol):
                c = self._seed_compra_servicio(org, f"del-{rol}")
                self._delete(token, c)
                self.assertIsNotNone(self._fila(T_COM, c), f"{rol} borró una compra")

    def test_delete_cross_org_ningun_rol_borra_compras_ajenas(self):
        c_b = self._seed_compra_servicio(ORG_AJENA, "del-ajena")
        for rol, token in (("admin", self.admin), ("tecnico_campo", self.tecnico)):
            with self.subTest(rol=rol):
                self._delete(token, c_b)
                self.assertIsNotNone(self._fila(T_COM, c_b), f"{rol} borró una compra ajena")

    # ---- cross-org INSERT con ID_Organizacion ajeno ----

    def test_insert_con_organizacion_ajena_rechazado(self):
        for rol, token in (("admin", self.admin), ("tecnico_campo", self.tecnico)):
            with self.subTest(rol=rol):
                res = self._post(token, self._payload_servicio(ORG_AJENA, f"x-{rol}"))
                self._registrar(res)
                self.assertEqual(res.status_code, 403, f"{rol}: compra en org ajena. body={res.text}")

    # ---- (g) trigger: la entrada automática trae el galpon_id de la compra ----

    def test_trigger_entrada_automatica_copia_galpon_id(self):
        insumo, galpon = self._seed_insumo(ORG), self._seed_galpon(ORG)
        res = self._post(self.admin, self._payload_insumo(ORG, insumo, galpon))
        self._registrar(res)
        self.assertEqual(res.status_code, 201, res.text)
        compra = res.json()[0]
        movs = self._filas_por(T_MOV, "insumo_id", insumo)
        self.assertEqual(len(movs), 1, "una compra de insumo debe generar exactamente 1 entrada")
        m = movs[0]
        self.assertEqual(m["tipo_movimiento"], "entrada")
        self.assertEqual(float(m["cantidad"]), 5.0)
        self.assertEqual(m["galpon_id"], galpon, "la entrada automática no trae el galpon_id de la compra")
        self.assertEqual(m["ID_Organizacion"], ORG)
        self.assertIn(compra["id"], m["observaciones"])

    def test_trigger_servicio_no_genera_movimiento(self):
        res = self._post(self.admin, self._payload_servicio(ORG, "sin-mov"))
        self._registrar(res)
        self.assertEqual(res.status_code, 201, res.text)
        # No hay insumo asociado; se verifica por observación generada con el id de la compra.
        movs = httpx.get(f"{SUPABASE_URL}/rest/v1/{T_MOV}", headers=_service_headers(),
                         params={"observaciones": f"like.*{res.json()[0]['id']}*", "select": "id"}, timeout=30).json()
        self.assertEqual(movs, [], "un servicio_otro no debe generar movimientos de stock")


if __name__ == "__main__":
    unittest.main()
