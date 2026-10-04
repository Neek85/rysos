"""
Aislamiento RLS por rol de PECUARIO_SUGERENCIAS_REEMPLAZO + trigger que
bloquea cambios de columna. Verifica
supabase/migrations/20261004120000_fix_rls_sugerencias_reemplazo_por_rol.sql
(aplicada manualmente por Neyser en Studio):

  SELECT: toda la organización | INSERT/UPDATE: admin + tecnico_campo
  DELETE: solo admin
  UPDATE: solo puede cambiar `estado` (trigger fn_sugerencia_reemplazo_bloquear_cambio_campos)

Las sugerencias las crea SIEMPRE el trigger trg_partos_evaluar_sugerencia_reemplazo
(AFTER INSERT ON PECUARIO_PARTOS, no SECURITY DEFINER: corre con los permisos de
quien registra el parto). Por eso el INSERT se prueba registrando un parto real
con la sesión de admin y de tecnico_campo, no con un INSERT manual.

Mismo patrón que tests/test_pecuario_compras_rls.py: sesiones REALES (magic link)
para las llamadas "de usuario"; service_role solo siembra, limpia y re-lee. Un
UPDATE/DELETE que el USING descarta no da error (0 filas) -> se confirma
releyendo con service_role; un INSERT bloqueado da 403; la excepción del trigger
de columnas llega como 400 con su mensaje.

Cuentas: GRANJA-TEST admin (dneyser5+test) y tecnico_campo (dneyser5+tecnico);
auditor demo de ORG-TEST-DEMO. Org ajena: COOP-AROMAS-VALLE. Todo lo sembrado lleva
prefijo TEST- y se borra en tearDown. Las sugerencias caen en cascada al borrar
el reproductor; los partos se borran antes. Sin credenciales, los casos en vivo
se saltan.
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
    / "supabase" / "migrations" / "20261004120000_fix_rls_sugerencias_reemplazo_por_rol.sql"
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

T_SUG = "PECUARIO_SUGERENCIAS_REEMPLAZO"
T_PAR = "PECUARIO_PARTOS"
T_JAU = "PECUARIO_JAULAS"
T_REP = "PECUARIO_REPRODUCTORES"
JSON = {"Content-Type": "application/json"}
MSG_TRIGGER = "Solo se puede modificar el estado de una sugerencia de reemplazo"


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
    """Sin Supabase: el archivo dice lo que el negocio decidió."""

    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION_PATH.read_text(encoding="utf-8")
        cls.codigo = "\n".join(l for l in cls.sql.splitlines() if not l.lstrip().startswith("--"))

    def test_cuatro_politicas_y_all_reemplazada(self):
        self.assertEqual(len(re.findall(r"^CREATE POLICY", self.codigo, flags=re.M)), 4)
        self.assertIn('DROP POLICY IF EXISTS "rls_all_pecuario_sugerencias_reemplazo"', self.codigo)
        self.assertNotIn("FOR ALL", self.codigo)

    def test_roles_por_comando(self):
        for cmd in ("insert", "update"):
            with self.subTest(cmd=cmd):
                b = _bloque_politica(self.sql, f"rls_{cmd}_pecuario_sugerencias_reemplazo")
                self.assertIn("auth_role() IN ('admin', 'tecnico_campo')", b)
        b = _bloque_politica(self.sql, "rls_delete_pecuario_sugerencias_reemplazo")
        self.assertIn("auth_role() = 'admin'", b)
        self.assertNotIn("tecnico_campo", b)
        self.assertNotIn("auth_role()", _bloque_politica(self.sql, "rls_select_pecuario_sugerencias_reemplazo"))

    def test_trigger_de_columnas_cubre_todas_las_columnas_protegidas(self):
        for col in ("reproductor_id", "motivo", "parto_id", "detalle", '"ID_Organizacion"', "creada_en"):
            with self.subTest(col=col):
                self.assertIn(f"NEW.{col} IS DISTINCT FROM OLD.{col}", self.codigo)
        self.assertIn("BEFORE UPDATE ON", self.codigo)
        self.assertIn("auth.role() = 'service_role' OR CURRENT_USER = 'postgres'", self.codigo)


@NEEDS_SUPABASE
class TestSugerenciasReemplazoRlsLive(unittest.TestCase):
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
        return f"TEST-SUGREEMP-{self.sfx}-{self._n}"

    def _jaula(self, org):
        return self._seed(T_JAU, {"ID_Organizacion": org, "codigo_poza": self._nombre()})

    def _hembra(self, org):
        return self._seed(T_REP, {"ID_Organizacion": org, "codigo_arete": self._nombre(), "sexo": "hembra"})

    def _sugerencia(self, org, motivo="max_partos_alcanzado"):
        """Siembra una sugerencia pendiente (con su propia hembra); devuelve (sugerencia_id, reproductor_id)."""
        repro = self._hembra(org)
        sug = self._seed(T_SUG, {"ID_Organizacion": org, "reproductor_id": repro, "motivo": motivo, "detalle": "TEST detalle original"})
        return sug, repro

    def _fila(self, tabla, id_):
        res = httpx.get(f"{SUPABASE_URL}/rest/v1/{tabla}", headers=_service_headers(), params={"id": f"eq.{id_}", "select": "*"}, timeout=30)
        res.raise_for_status()
        rows = res.json()
        return rows[0] if rows else None

    def _sugerencias_de(self, reproductor_id):
        res = httpx.get(f"{SUPABASE_URL}/rest/v1/{T_SUG}", headers=_service_headers(), params={"reproductor_id": f"eq.{reproductor_id}", "select": "*"}, timeout=30)
        res.raise_for_status()
        return res.json()

    # ---- llamadas con sesión real ----

    def _post(self, token, tabla, payload):
        return httpx.post(f"{SUPABASE_URL}/rest/v1/{tabla}", headers={**_session_headers(token), **JSON, "Prefer": "return=representation"}, json=payload, timeout=30)

    def _patch(self, token, id_, payload, tabla=T_SUG):
        return httpx.patch(f"{SUPABASE_URL}/rest/v1/{tabla}", headers={**_session_headers(token), **JSON, "Prefer": "return=representation"}, params={"id": f"eq.{id_}"}, json=payload, timeout=30)

    def _delete(self, token, id_):
        return httpx.delete(f"{SUPABASE_URL}/rest/v1/{T_SUG}", headers={**_session_headers(token), "Prefer": "return=representation"}, params={"id": f"eq.{id_}"}, timeout=30)

    def _get(self, token, id_):
        return httpx.get(f"{SUPABASE_URL}/rest/v1/{T_SUG}", headers=_session_headers(token), params={"id": f"eq.{id_}"}, timeout=30)

    def _registrar(self, tabla, res):
        if res.status_code == 201:
            self._cleanup.append((tabla, res.json()[0]["id"]))

    def _por_cada_rol_escritor(self):
        return (("admin", self.admin), ("tecnico_campo", self.tecnico))

    # ---- SELECT ----

    def test_select_cada_rol_lee_sus_sugerencias(self):
        s_org, _ = self._sugerencia(ORG)
        s_demo, _ = self._sugerencia(ORG_DEMO)
        for rol, token, id_ in (("admin", self.admin, s_org), ("tecnico_campo", self.tecnico, s_org), ("auditor_qc", self.auditor, s_demo)):
            with self.subTest(rol=rol):
                res = self._get(token, id_)
                self.assertEqual(res.status_code, 200)
                self.assertEqual(len(res.json()), 1, f"{rol} debe leer las sugerencias de su organización")

    def test_select_cross_org_ningun_rol_lee_sugerencias_ajenas(self):
        s_b, _ = self._sugerencia(ORG_AJENA)
        for rol, token in (("admin", self.admin), ("tecnico_campo", self.tecnico), ("auditor_qc", self.auditor)):
            with self.subTest(rol=rol):
                res = self._get(token, s_b)
                self.assertEqual(res.status_code, 200)
                self.assertEqual(res.json(), [], f"{rol} ve sugerencias de {ORG_AJENA}")

    # ---- INSERT: vía el trigger de PECUARIO_PARTOS ----

    def test_insert_disparado_por_el_trigger_pasa_para_admin_y_tecnico(self):
        for rol, token in self._por_cada_rol_escritor():
            with self.subTest(rol=rol):
                poza, madre = self._jaula(ORG), self._hembra(ORG)
                # 1 cría viva (< mínimo por defecto 2) en su 1er parto => camada_chica_parto_temprano
                res = self._post(token, T_PAR, {"ID_Organizacion": ORG, "poza_id": poza, "madre_id": madre, "n_vivos": 1, "n_muertos": 0})
                self._registrar(T_PAR, res)
                self.assertEqual(res.status_code, 201, f"{rol}: el parto (y la sugerencia que dispara) debe pasar. body={res.text}")
                sugs = self._sugerencias_de(madre)
                self.assertEqual(len(sugs), 1, f"{rol}: el trigger debió crear la sugerencia")
                self.assertEqual(sugs[0]["motivo"], "camada_chica_parto_temprano")
                self.assertEqual(sugs[0]["estado"], "pendiente")
                self.assertEqual(sugs[0]["parto_id"], res.json()[0]["id"])

    def test_insert_auditor_no_puede_registrar_parto_ni_generar_sugerencia(self):
        poza, madre = self._jaula(ORG_DEMO), self._hembra(ORG_DEMO)
        res = self._post(self.auditor, T_PAR, {"ID_Organizacion": ORG_DEMO, "poza_id": poza, "madre_id": madre, "n_vivos": 1, "n_muertos": 0})
        self._registrar(T_PAR, res)
        self.assertEqual(res.status_code, 403, res.text)
        self.assertEqual(self._sugerencias_de(madre), [], "no debe quedar ninguna sugerencia")

    def test_insert_manual_directo_auditor_y_organizacion_ajena_bloqueados(self):
        # No es un flujo de la app: solo comprueba que la policy de INSERT no queda abierta.
        repro_demo, repro_b = self._hembra(ORG_DEMO), self._hembra(ORG_AJENA)
        casos = (
            ("auditor_qc", self.auditor, ORG_DEMO, repro_demo),
            ("admin -> org ajena", self.admin, ORG_AJENA, repro_b),
            ("tecnico_campo -> org ajena", self.tecnico, ORG_AJENA, repro_b),
        )
        for nombre, token, org, repro in casos:
            with self.subTest(caso=nombre):
                res = self._post(token, T_SUG, {"ID_Organizacion": org, "reproductor_id": repro, "motivo": "max_partos_alcanzado", "detalle": "TEST"})
                self._registrar(T_SUG, res)
                self.assertEqual(res.status_code, 403, f"{nombre}: INSERT manual. body={res.text}")

    # ---- UPDATE de estado ----

    def test_update_estado_admin_y_tecnico_permitido(self):
        for rol, token in self._por_cada_rol_escritor():
            with self.subTest(rol=rol):
                s, _ = self._sugerencia(ORG)
                res = self._patch(token, s, {"estado": "ignorada"})
                self.assertEqual(res.status_code, 200, res.text)
                fila = self._fila(T_SUG, s)
                self.assertEqual(fila["estado"], "ignorada")
                self.assertIsNotNone(fila["resuelta_en"], "el trigger resuelta_en debe fijar la fecha")

    def test_confirmar_marca_descarte_en_el_reproductor_con_cualquier_rol_escritor(self):
        for rol, token in self._por_cada_rol_escritor():
            with self.subTest(rol=rol):
                s, repro = self._sugerencia(ORG)
                res = self._patch(token, s, {"estado": "confirmada"})
                self.assertEqual(res.status_code, 200, res.text)
                self.assertEqual(self._fila(T_REP, repro)["proposito"], "descarte")

    # ---- UPDATE en bloque por reproductor: la forma exacta de la spec de la pantalla
    # (specs/app_granja_valencia_reemplazo.md). El test de arriba actualiza por id de
    # sugerencia; la pantalla usa .eq('reproductor_id').eq('ID_Organizacion').eq('estado','pendiente').select('id')

    def _resolver_en_bloque(self, token, reproductor_id, estado, org=ORG):
        return httpx.patch(
            f"{SUPABASE_URL}/rest/v1/{T_SUG}",
            headers={**_session_headers(token), **JSON, "Prefer": "return=representation"},
            params={"reproductor_id": f"eq.{reproductor_id}", "ID_Organizacion": f"eq.{org}", "estado": "eq.pendiente", "select": "id"},
            json={"estado": estado}, timeout=30,
        )

    def _animal_con_dos_sugerencias(self):
        repro = self._hembra(ORG)
        s1 = self._seed(T_SUG, {"ID_Organizacion": ORG, "reproductor_id": repro, "motivo": "max_partos_alcanzado", "detalle": "TEST detalle 1"})
        s2 = self._seed(T_SUG, {"ID_Organizacion": ORG, "reproductor_id": repro, "motivo": "camada_chica_parto_temprano", "detalle": "TEST detalle 2"})
        return repro, s1, s2

    def test_resolver_en_bloque_confirmar_resuelve_todas_y_repetir_devuelve_cero_filas(self):
        for rol, token in self._por_cada_rol_escritor():
            with self.subTest(rol=rol):
                repro, s1, s2 = self._animal_con_dos_sugerencias()
                otra, otro_repro = self._sugerencia(ORG)  # otro animal: NO debe tocarse
                res = self._resolver_en_bloque(token, repro, "confirmada")
                self.assertEqual(res.status_code, 200, res.text)
                self.assertEqual({r["id"] for r in res.json()}, {s1, s2}, "debe devolver las 2 sugerencias pendientes del animal")
                for s in (s1, s2):
                    fila = self._fila(T_SUG, s)
                    self.assertEqual(fila["estado"], "confirmada")
                    self.assertIsNotNone(fila["resuelta_en"])
                self.assertEqual(self._fila(T_REP, repro)["proposito"], "descarte")
                self.assertEqual(self._fila(T_SUG, otra)["estado"], "pendiente", "otro animal no debe cambiar")
                # Segunda llamada con el mismo filtro: ya no hay pendientes => 0 filas (la UI muestra
                # "Estas sugerencias ya fueron resueltas"), sin error y sin tocar nada.
                res2 = self._resolver_en_bloque(token, repro, "ignorada")
                self.assertEqual(res2.status_code, 200, res2.text)
                self.assertEqual(res2.json(), [])
                self.assertEqual(self._fila(T_SUG, s1)["estado"], "confirmada", "una resuelta no se puede reabrir con el mismo filtro")

    def test_resolver_en_bloque_ignorar_resuelve_todas_sin_tocar_el_proposito(self):
        for rol, token in self._por_cada_rol_escritor():
            with self.subTest(rol=rol):
                repro, s1, s2 = self._animal_con_dos_sugerencias()
                res = self._resolver_en_bloque(token, repro, "ignorada")
                self.assertEqual(res.status_code, 200, res.text)
                self.assertEqual({r["id"] for r in res.json()}, {s1, s2})
                for s in (s1, s2):
                    fila = self._fila(T_SUG, s)
                    self.assertEqual(fila["estado"], "ignorada")
                    self.assertIsNotNone(fila["resuelta_en"])
                self.assertEqual(self._fila(T_REP, repro)["proposito"], "reproductor", "ignorar no debe marcar descarte")

    def test_resolver_en_bloque_auditor_no_resuelve_nada(self):
        s, repro = self._sugerencia(ORG_DEMO)
        res = self._resolver_en_bloque(self.auditor, repro, "confirmada", org=ORG_DEMO)
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json(), [], "auditor_qc no debe actualizar ninguna fila")
        self.assertEqual(self._fila(T_SUG, s)["estado"], "pendiente")
        self.assertEqual(self._fila(T_REP, repro)["proposito"], "reproductor")

    def test_update_auditor_bloqueado(self):
        s, repro = self._sugerencia(ORG_DEMO)
        self._patch(self.auditor, s, {"estado": "confirmada"})
        self.assertEqual(self._fila(T_SUG, s)["estado"], "pendiente", "auditor_qc cambió el estado")
        self.assertEqual(self._fila(T_REP, repro)["proposito"], "reproductor", "auditor_qc disparó un descarte")

    def test_update_cross_org_ningun_rol_toca_sugerencias_ajenas(self):
        s_b, _ = self._sugerencia(ORG_AJENA)
        for rol, token in self._por_cada_rol_escritor():
            with self.subTest(rol=rol):
                self._patch(token, s_b, {"estado": "ignorada"})
                self.assertEqual(self._fila(T_SUG, s_b)["estado"], "pendiente", f"{rol} alteró una sugerencia ajena")

    # ---- UPDATE de otras columnas: lo rechaza el trigger, incluso siendo admin ----

    def test_update_de_columnas_distintas_de_estado_rechazado_por_el_trigger(self):
        poza = self._jaula(ORG)
        parto = self._seed(T_PAR, {"ID_Organizacion": ORG, "poza_id": poza, "n_vivos": 3, "n_muertos": 0})
        otro_repro = self._hembra(ORG)
        for rol, token in self._por_cada_rol_escritor():
            s, _ = self._sugerencia(ORG)
            original = self._fila(T_SUG, s)
            cambios = (
                ("reproductor_id", otro_repro),
                ("motivo", "camada_chica_parto_temprano"),
                ("parto_id", parto),
                ("detalle", "HACK detalle"),
                ("ID_Organizacion", ORG_AJENA),
                ("creada_en", "2020-01-01T00:00:00+00:00"),
            )
            for campo, valor in cambios:
                with self.subTest(rol=rol, campo=campo):
                    res = self._patch(token, s, {campo: valor})
                    self.assertEqual(res.status_code, 400, f"{rol}: cambiar {campo} debe lanzar la excepción del trigger. body={res.text}")
                    self.assertIn(MSG_TRIGGER, res.text)
                    self.assertEqual(self._fila(T_SUG, s)[campo], original[campo], f"{rol} logró cambiar {campo}")

    def test_update_mixto_estado_mas_columna_protegida_tambien_se_rechaza(self):
        s, _ = self._sugerencia(ORG)
        res = self._patch(self.tecnico, s, {"estado": "ignorada", "detalle": "HACK mixto"})
        self.assertEqual(res.status_code, 400, res.text)
        fila = self._fila(T_SUG, s)
        self.assertEqual(fila["estado"], "pendiente")
        self.assertEqual(fila["detalle"], "TEST detalle original")

    def test_service_role_conserva_el_bypass_del_trigger(self):
        # Control positivo: la corrección administrativa legítima por la API con la
        # service_role key sigue siendo posible (el bypass de CURRENT_USER='postgres'
        # solo se ejerce desde una sesión directa en Studio y no se puede simular acá).
        s, _ = self._sugerencia(ORG)
        res = httpx.patch(f"{SUPABASE_URL}/rest/v1/{T_SUG}", headers={**_service_headers(), **JSON, "Prefer": "return=representation"},
                          params={"id": f"eq.{s}"}, json={"detalle": "corregido por service_role"}, timeout=30)
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(self._fila(T_SUG, s)["detalle"], "corregido por service_role")

    # ---- DELETE ----

    def test_delete_solo_admin(self):
        s, _ = self._sugerencia(ORG)
        self._delete(self.tecnico, s)
        self.assertIsNotNone(self._fila(T_SUG, s), "tecnico_campo borró una sugerencia")
        self._delete(self.admin, s)
        self.assertIsNone(self._fila(T_SUG, s), "admin debe poder borrar una sugerencia")

    def test_delete_auditor_bloqueado(self):
        s, _ = self._sugerencia(ORG_DEMO)
        self._delete(self.auditor, s)
        self.assertIsNotNone(self._fila(T_SUG, s), "auditor_qc borró una sugerencia")

    def test_delete_cross_org_ningun_rol_borra_sugerencias_ajenas(self):
        s_b, _ = self._sugerencia(ORG_AJENA)
        for rol, token in self._por_cada_rol_escritor():
            with self.subTest(rol=rol):
                self._delete(token, s_b)
                self.assertIsNotNone(self._fila(T_SUG, s_b), f"{rol} borró una sugerencia ajena")


if __name__ == "__main__":
    unittest.main()
