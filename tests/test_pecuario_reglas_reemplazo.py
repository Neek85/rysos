"""
Test de integración para las reglas configurables de reemplazo/descarte
de reproductoras (ítem 8 del roadmap Pecuario): sugerencia automática
(nunca acción automática) cuando una reproductora identificada alcanza
el máximo de partos configurado, o tiene una camada chica en su 1er o
2do parto.

Ver supabase/migrations/20260927090000_pecuario_reglas_reemplazo_reproductoras.sql
(specs/pecuario_reglas_reemplazo_reproductoras.md referenciada, no
existe en este repo -- mismo hallazgo recurrente de toda esta ronda, no
se fabrica).

Usa la organización real GRANJA-VALENCIA (mismo criterio que el resto
de la suite) para los casos de negocio -- todas las filas de estos
tests son descartables, con prefijo TEST-, creadas y borradas dentro de
cada test. El aislamiento cruzado usa ORG-TEST-DEMO.

PECUARIO_CONFIGURACION tiene UNIQUE(ID_Organizacion) -- cada test que
necesita una config puntual (max_partos_madre/min_crias_vivas_parto_temprano
bajos, para no tener que crear muchos partos reales) crea su propia fila
en setUp y la borra en tearDown, nunca deja una fila de config huérfana
entre tests.

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
    / "supabase" / "migrations" / "20260927090000_pecuario_reglas_reemplazo_reproductoras.sql"
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
        for tabla_o_vista in ("PECUARIO_SUGERENCIAS_REEMPLAZO", "vw_pecuario_sugerencias_reemplazo"):
            res = httpx.get(
                f"{SUPABASE_URL}/rest/v1/{tabla_o_vista}",
                headers=_service_headers(), params={"select": "*", "limit": 1}, timeout=15,
            )
            if res.status_code != 200:
                return False
        # min_crias_vivas_parto_temprano es la señal de que el rename ya se aplicó.
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_CONFIGURACION",
            headers=_service_headers(), params={"select": "min_crias_vivas_parto_temprano", "limit": 1}, timeout=15,
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

    def test_rename_columna_idempotente(self):
        self.assertIn("RENAME COLUMN min_promedio_crias_vivas TO min_crias_vivas_parto_temprano", self.sql)

    def test_tabla_sugerencias_nueva(self):
        self.assertIn('CREATE TABLE IF NOT EXISTS public."PECUARIO_SUGERENCIAS_REEMPLAZO"', self.sql)

    def test_unique_reproductor_motivo(self):
        self.assertIn("uq_sugerencia_reemplazo_reproductor_motivo UNIQUE (reproductor_id, motivo)", self.sql)

    def test_check_resuelta_coherente(self):
        self.assertIn("chk_sugerencia_reemplazo_resuelta_coherente", self.sql)

    def test_resuelta_en_calculado_por_trigger_no_por_cliente(self):
        self.assertIn("NEW.resuelta_en := now()", self.sql)

    def test_confirmar_descarte_es_el_unico_trigger_que_toca_proposito(self):
        self.assertIn("SET proposito = 'descarte'", self.sql)
        # No debe existir ningún trigger sobre PECUARIO_PARTOS que toque
        # proposito directamente -- solo el de confirmación explícita.
        motor_start = self.sql.index("CREATE OR REPLACE FUNCTION public.trg_partos_evaluar_sugerencia_reemplazo()")
        motor_end = self.sql.index("CREATE OR REPLACE VIEW public.vw_pecuario_sugerencias_reemplazo")
        self.assertNotIn("proposito", self.sql[motor_start:motor_end])

    def test_on_conflict_do_nothing_evita_duplicados(self):
        self.assertEqual(self.sql.count("ON CONFLICT (reproductor_id, motivo) DO NOTHING"), 2)

    def test_solo_cuenta_n_vivos_nunca_n_muertos(self):
        motor_start = self.sql.index("CREATE OR REPLACE FUNCTION public.trg_partos_evaluar_sugerencia_reemplazo()")
        motor_end = self.sql.index("CREATE OR REPLACE VIEW public.vw_pecuario_sugerencias_reemplazo")
        cuerpo = self.sql[motor_start:motor_end]
        self.assertIn("n_vivos", cuerpo)
        self.assertNotIn("n_muertos", cuerpo)

    def test_alcance_solo_madre_identificada(self):
        self.assertIn("WHEN (NEW.madre_id IS NOT NULL)", self.sql)

    def test_validar_madre_sexo_y_organizacion(self):
        self.assertIn("v_sexo_madre <> 'hembra'", self.sql)
        self.assertIn("v_org_madre <> NEW.\"ID_Organizacion\"", self.sql)

    def test_rls_habilitado(self):
        self.assertIn('ALTER TABLE public."PECUARIO_SUGERENCIAS_REEMPLAZO" ENABLE ROW LEVEL SECURITY', self.sql)


class TestZodContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parent.parent / "lib" / "validations" / "pecuario.ts"
        if not path.exists():
            raise AssertionError(f"No existe {path}")
        cls.ts = path.read_text(encoding="utf-8")

    def test_schema_y_type_existen(self):
        self.assertIn("export const SugerenciaReemplazoAccionSchema", self.ts)
        self.assertIn("export type SugerenciaReemplazoAccionInput", self.ts)

    def test_schema_forma_exacta(self):
        start = self.ts.index("export const SugerenciaReemplazoAccionSchema")
        end = self.ts.index("export type SanidadActividadInput")
        body = self.ts[start:end]
        self.assertIn("reproductor_id: z.string().uuid()", body)
        self.assertIn("ID_Organizacion: IdOrganizacionSchema", body)


@NEEDS_SUPABASE
class TestReglasReemplazoLive(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not _migracion_aplicada():
            raise unittest.SkipTest(
                "PECUARIO_SUGERENCIAS_REEMPLAZO/vw_pecuario_sugerencias_reemplazo/"
                "min_crias_vivas_parto_temprano no existen todavía -- "
                "20260927090000_pecuario_reglas_reemplazo_reproductoras.sql "
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
            json={"ID_Organizacion": org, "codigo_poza": f"TEST-REEMPLAZO-{self.suffix}-{len(self._cleanup)}"},
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
            json={"ID_Organizacion": org, "codigo_arete": f"TEST-REEMPLAZO-{self.suffix}-{len(self._cleanup)}", "sexo": sexo},
            timeout=30,
        )
        res.raise_for_status()
        animal_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_REPRODUCTORES", "id", animal_id))
        return animal_id

    def _crear_parto(self, poza_id, n_vivos, madre_id=None, n_muertos=0, org=ORG_A, fecha_parto=None):
        payload = {"ID_Organizacion": org, "poza_id": poza_id, "n_vivos": n_vivos, "n_muertos": n_muertos}
        if madre_id is not None:
            payload["madre_id"] = madre_id
        if fecha_parto is not None:
            payload["fecha_parto"] = fecha_parto
        return httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_PARTOS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json=payload, timeout=30,
        )

    def _set_config(self, org=ORG_A, max_partos_madre=None, min_crias=None):
        payload = {"ID_Organizacion": org}
        if max_partos_madre is not None:
            payload["max_partos_madre"] = max_partos_madre
        if min_crias is not None:
            payload["min_crias_vivas_parto_temprano"] = min_crias
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_CONFIGURACION",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json=payload, timeout=30,
        )
        res.raise_for_status()
        self._cleanup.append(("PECUARIO_CONFIGURACION", "ID_Organizacion", org))
        return res.json()[0]

    def _get_sugerencias(self, reproductor_id, motivo=None):
        params = {"reproductor_id": f"eq.{reproductor_id}"}
        if motivo is not None:
            params["motivo"] = f"eq.{motivo}"
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_SUGERENCIAS_REEMPLAZO", headers=_service_headers(),
            params=params, timeout=30,
        )
        res.raise_for_status()
        return res.json()

    def _resolver_sugerencia(self, sugerencia_id, estado):
        return httpx.patch(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_SUGERENCIAS_REEMPLAZO",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            params={"id": f"eq.{sugerencia_id}"},
            json={"estado": estado},
            timeout=30,
        )

    def _get_reproductor(self, reproductor_id):
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_REPRODUCTORES", headers=_service_headers(),
            params={"id": f"eq.{reproductor_id}"}, timeout=30,
        )
        res.raise_for_status()
        rows = res.json()
        self.assertEqual(len(rows), 1)
        return rows[0]

    def _get_vista_sugerencias(self, reproductor_id):
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/vw_pecuario_sugerencias_reemplazo", headers=_service_headers(),
            params={"reproductor_id": f"eq.{reproductor_id}"}, timeout=30,
        )
        res.raise_for_status()
        return res.json()

    # ---- Rename de columna ----

    def test_columna_vieja_no_existe_nueva_si_con_default_2(self):
        vieja = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_CONFIGURACION", headers=_service_headers(),
            params={"select": "min_promedio_crias_vivas", "limit": 1}, timeout=30,
        )
        self.assertEqual(vieja.status_code, 400, "min_promedio_crias_vivas ya no debe existir -- fue renombrada.")

        config = self._set_config()  # sin especificar min_crias -- debe usar el default de columna
        self.assertEqual(float(config["min_crias_vivas_parto_temprano"]), 2.0)

    # ---- Regla 1: máximo de partos alcanzado ----

    def test_parto_que_alcanza_max_partos_madre_crea_sugerencia(self):
        self._set_config(max_partos_madre=1)
        jaula = self._crear_jaula()
        madre = self._crear_reproductor("hembra")

        res = self._crear_parto(jaula, n_vivos=10, madre_id=madre)
        self.assertEqual(res.status_code, 201, res.text)
        parto_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_PARTOS", "id", parto_id))

        sugerencias = self._get_sugerencias(madre, motivo="max_partos_alcanzado")
        self.assertEqual(len(sugerencias), 1)
        s = sugerencias[0]
        self._cleanup.append(("PECUARIO_SUGERENCIAS_REEMPLAZO", "id", s["id"]))
        self.assertEqual(s["estado"], "pendiente")
        self.assertIsNone(s["resuelta_en"])

    # ---- Regla 2: camada chica en el 1er o 2do parto ----

    def test_primer_parto_con_camada_chica_dispara_sugerencia(self):
        self._set_config(min_crias=5)
        jaula = self._crear_jaula()
        madre = self._crear_reproductor("hembra")

        res = self._crear_parto(jaula, n_vivos=2, madre_id=madre)
        self.assertEqual(res.status_code, 201, res.text)
        parto_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_PARTOS", "id", parto_id))

        sugerencias = self._get_sugerencias(madre, motivo="camada_chica_parto_temprano")
        self.assertEqual(len(sugerencias), 1)
        self._cleanup.append(("PECUARIO_SUGERENCIAS_REEMPLAZO", "id", sugerencias[0]["id"]))

    def test_segundo_parto_con_camada_chica_dispara_sugerencia(self):
        self._set_config(min_crias=5)
        jaula = self._crear_jaula()
        madre = self._crear_reproductor("hembra")

        primero = self._crear_parto(jaula, n_vivos=10, madre_id=madre, fecha_parto="2026-01-01")
        primero.raise_for_status()
        self._cleanup.append(("PECUARIO_PARTOS", "id", primero.json()[0]["id"]))

        segundo = self._crear_parto(jaula, n_vivos=2, madre_id=madre, fecha_parto="2026-06-01")
        self.assertEqual(segundo.status_code, 201, segundo.text)
        self._cleanup.append(("PECUARIO_PARTOS", "id", segundo.json()[0]["id"]))

        sugerencias = self._get_sugerencias(madre, motivo="camada_chica_parto_temprano")
        self.assertEqual(len(sugerencias), 1)
        self._cleanup.append(("PECUARIO_SUGERENCIAS_REEMPLAZO", "id", sugerencias[0]["id"]))
        self.assertIn("parto #2", sugerencias[0]["detalle"])

    def test_tercer_parto_con_camada_chica_no_dispara_nada_nuevo(self):
        self._set_config(min_crias=5)
        jaula = self._crear_jaula()
        madre = self._crear_reproductor("hembra")

        p1 = self._crear_parto(jaula, n_vivos=10, madre_id=madre, fecha_parto="2026-01-01")
        p1.raise_for_status()
        self._cleanup.append(("PECUARIO_PARTOS", "id", p1.json()[0]["id"]))

        p2 = self._crear_parto(jaula, n_vivos=10, madre_id=madre, fecha_parto="2026-03-01")
        p2.raise_for_status()
        self._cleanup.append(("PECUARIO_PARTOS", "id", p2.json()[0]["id"]))

        antes = self._get_sugerencias(madre, motivo="camada_chica_parto_temprano")
        self.assertEqual(antes, [], "Ni el 1er ni el 2do parto tuvieron camada chica -- todavía no debe haber sugerencia.")

        p3 = self._crear_parto(jaula, n_vivos=2, madre_id=madre, fecha_parto="2026-06-01")
        self.assertEqual(p3.status_code, 201, p3.text)
        self._cleanup.append(("PECUARIO_PARTOS", "id", p3.json()[0]["id"]))

        despues = self._get_sugerencias(madre, motivo="camada_chica_parto_temprano")
        self.assertEqual(despues, [], "Un 3er parto con camada chica no debe disparar nada -- la regla es solo 1er/2do.")

    def test_solo_cuenta_n_vivos_nunca_n_muertos(self):
        self._set_config(min_crias=5)
        jaula = self._crear_jaula()
        madre = self._crear_reproductor("hembra")

        res = self._crear_parto(jaula, n_vivos=6, n_muertos=20, madre_id=madre)
        self.assertEqual(res.status_code, 201, res.text)
        self._cleanup.append(("PECUARIO_PARTOS", "id", res.json()[0]["id"]))

        sugerencias = self._get_sugerencias(madre, motivo="camada_chica_parto_temprano")
        self.assertEqual(sugerencias, [], "n_vivos=6 >= min_crias=5 -- no debe disparar, sin importar cuántos n_muertos tenga.")

    def test_segundo_parto_no_duplica_motivo_si_ya_pendiente(self):
        self._set_config(min_crias=5)
        jaula = self._crear_jaula()
        madre = self._crear_reproductor("hembra")

        p1 = self._crear_parto(jaula, n_vivos=1, madre_id=madre, fecha_parto="2026-01-01")
        p1.raise_for_status()
        self._cleanup.append(("PECUARIO_PARTOS", "id", p1.json()[0]["id"]))
        primera_tanda = self._get_sugerencias(madre, motivo="camada_chica_parto_temprano")
        self.assertEqual(len(primera_tanda), 1)
        self._cleanup.append(("PECUARIO_SUGERENCIAS_REEMPLAZO", "id", primera_tanda[0]["id"]))

        p2 = self._crear_parto(jaula, n_vivos=1, madre_id=madre, fecha_parto="2026-03-01")
        self.assertEqual(p2.status_code, 201, p2.text)
        self._cleanup.append(("PECUARIO_PARTOS", "id", p2.json()[0]["id"]))

        segunda_tanda = self._get_sugerencias(madre, motivo="camada_chica_parto_temprano")
        self.assertEqual(len(segunda_tanda), 1, "UNIQUE(reproductor_id, motivo) + ON CONFLICT DO NOTHING -- no debe duplicarse.")
        self.assertEqual(segunda_tanda[0]["id"], primera_tanda[0]["id"])
        self.assertIn("parto #1", segunda_tanda[0]["detalle"], "El registro original (parto #1) no debe pisarse por el DO NOTHING.")

    # ---- Confirmar descarte / ignorar ----

    def test_confirmar_descarte_setea_resuelta_en_y_marca_proposito_descarte(self):
        self._set_config(max_partos_madre=1)
        jaula = self._crear_jaula()
        madre = self._crear_reproductor("hembra")
        parto = self._crear_parto(jaula, n_vivos=8, madre_id=madre)
        parto.raise_for_status()
        self._cleanup.append(("PECUARIO_PARTOS", "id", parto.json()[0]["id"]))
        sugerencia = self._get_sugerencias(madre, motivo="max_partos_alcanzado")[0]
        self._cleanup.append(("PECUARIO_SUGERENCIAS_REEMPLAZO", "id", sugerencia["id"]))

        res = self._resolver_sugerencia(sugerencia["id"], "confirmada")
        self.assertEqual(res.status_code, 200, res.text)
        actualizada = res.json()[0]
        self.assertEqual(actualizada["estado"], "confirmada")
        self.assertIsNotNone(actualizada["resuelta_en"])

        self.assertEqual(self._get_reproductor(madre)["proposito"], "descarte")

    def test_ignorar_setea_resuelta_en_pero_no_toca_proposito(self):
        self._set_config(max_partos_madre=1)
        jaula = self._crear_jaula()
        madre = self._crear_reproductor("hembra")
        proposito_original = self._get_reproductor(madre)["proposito"]
        parto = self._crear_parto(jaula, n_vivos=8, madre_id=madre)
        parto.raise_for_status()
        self._cleanup.append(("PECUARIO_PARTOS", "id", parto.json()[0]["id"]))
        sugerencia = self._get_sugerencias(madre, motivo="max_partos_alcanzado")[0]
        self._cleanup.append(("PECUARIO_SUGERENCIAS_REEMPLAZO", "id", sugerencia["id"]))

        res = self._resolver_sugerencia(sugerencia["id"], "ignorada")
        self.assertEqual(res.status_code, 200, res.text)
        actualizada = res.json()[0]
        self.assertEqual(actualizada["estado"], "ignorada")
        self.assertIsNotNone(actualizada["resuelta_en"])

        self.assertEqual(self._get_reproductor(madre)["proposito"], proposito_original)

    def test_insert_directo_confirmada_sin_resuelta_en_falla_check(self):
        jaula = self._crear_jaula()
        madre = self._crear_reproductor("hembra")

        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_SUGERENCIAS_REEMPLAZO",
            headers={**_service_headers(), "Content-Type": "application/json"},
            json={
                "ID_Organizacion": ORG_A, "reproductor_id": madre, "motivo": "max_partos_alcanzado",
                "detalle": "insert directo de test", "estado": "confirmada",
            },
            timeout=30,
        )
        self.assertEqual(res.status_code, 400, res.text)

    # ---- Validación de madre_id ----

    def test_madre_id_de_otra_organizacion_falla(self):
        jaula = self._crear_jaula()
        madre_otra_org = self._crear_reproductor("hembra", org=ORG_B)

        res = self._crear_parto(jaula, n_vivos=5, madre_id=madre_otra_org)
        self.assertEqual(res.status_code, 400, res.text)

    def test_madre_id_de_sexo_macho_falla(self):
        jaula = self._crear_jaula()
        macho = self._crear_reproductor("macho")

        res = self._crear_parto(jaula, n_vivos=5, madre_id=macho)
        self.assertEqual(res.status_code, 400, res.text)

    # ---- Modo poblacional: sin madre_id, no dispara nada ----

    def test_parto_sin_madre_id_no_dispara_nada(self):
        self._set_config(max_partos_madre=1)
        jaula = self._crear_jaula()

        res = self._crear_parto(jaula, n_vivos=1)  # sin madre_id -- modo poblacional
        self.assertEqual(res.status_code, 201, res.text)
        self._cleanup.append(("PECUARIO_PARTOS", "id", res.json()[0]["id"]))

        check = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_SUGERENCIAS_REEMPLAZO", headers=_service_headers(),
            params={"parto_id": f"eq.{res.json()[0]['id']}"}, timeout=30,
        )
        check.raise_for_status()
        self.assertEqual(check.json(), [])

    # ---- Aislamiento RLS cruzado ----

    def test_aislamiento_cruzado_vista_sugerencias(self):
        self._set_config(max_partos_madre=1)
        jaula = self._crear_jaula()
        madre = self._crear_reproductor("hembra")
        parto = self._crear_parto(jaula, n_vivos=8, madre_id=madre)
        parto.raise_for_status()
        self._cleanup.append(("PECUARIO_PARTOS", "id", parto.json()[0]["id"]))
        sugerencia = self._get_sugerencias(madre, motivo="max_partos_alcanzado")[0]
        self._cleanup.append(("PECUARIO_SUGERENCIAS_REEMPLAZO", "id", sugerencia["id"]))

        read = httpx.get(
            f"{SUPABASE_URL}/rest/v1/vw_pecuario_sugerencias_reemplazo",
            headers=_session_headers(self.otra_org_token), params={"id": f"eq.{sugerencia['id']}"}, timeout=30,
        )
        self.assertEqual(read.status_code, 200)
        self.assertEqual(read.json(), [], f"Una sesión de {ORG_B} no debe ver sugerencias de {ORG_A}.")


if __name__ == "__main__":
    unittest.main(verbosity=2)
