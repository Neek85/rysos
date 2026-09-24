"""
Test de integración para el traslado interno entre pozas/jaulas
(Pecuario Cuyes) — PECUARIO_TRASLADOS + trigger BEFORE INSERT
trg_procesar_traslado, que aplica el efecto real (mover un lote completo
o parcial con split, o un reproductor identificado) en la misma
transacción que el registro de auditoría.

Ver supabase/migrations/20260924100000_pecuario_traslado_interno.sql
(specs/pecuario_traslado_interno.md no existe en este repo -- solo
referenciada por la migración/el prompt, nunca comiteada; mismo
hallazgo que Compras/Guano/Mortalidad-fotos/Sanidad. La migración trae
suficiente contexto en su propia cabecera para verificar sin ella).

Usa el organización real GRANJA-VALENCIA (es_organizacion_prueba=false,
pedido explícito) para los casos de lógica de negocio -- confirmado
antes de escribir este archivo que esa organización no tiene ninguna
fila real en PECUARIO_JAULAS/PECUARIO_LOTES/PECUARIO_REPRODUCTORES hoy,
así que todas las filas que crean estos tests son descartables, con
prefijo TEST-, limpiadas al final de cada test -- nunca se toca una fila
preexistente. El aislamiento RLS cruzado usa ORG-TEST-DEMO como "otra
organización" (mismo patrón del resto de la suite) leyendo contra una
fila sembrada en GRANJA-VALENCIA.

La migración NO se aplica desde este archivo ni desde ningún script de
este repo -- ninguna migración SQL se aplica automáticamente contra la
base real (system prompt / docs/RYZOS_ORQUESTADOR_V3.1.md §4.1.4). Este
archivo verifica el contenido estático de la migración y del contrato
Zod siempre, y sus casos en vivo solo cuando la tabla ya existe
(aplicada a mano en Supabase Studio) -- `unittest.SkipTest` explícito en
caso contrario, sin fallar la suite.
"""

import os
import time
import unittest
from pathlib import Path

import httpx
import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase" / "migrations" / "20260924100000_pecuario_traslado_interno.sql"
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

NEEDS_SUPABASE = pytest.mark.skipif(
    not SUPABASE_URL or not SUPABASE_ANON_KEY or not SUPABASE_SERVICE_ROLE_KEY,
    reason="SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY no configuradas — test requiere Supabase Live",
)

ORG_A = "GRANJA-VALENCIA"     # organización real, pedida explícitamente
ORG_B = "ORG-TEST-DEMO"       # "otra organización" para el aislamiento RLS
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
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_TRASLADOS",
            headers=_service_headers(), params={"select": "id", "limit": 1}, timeout=15,
        )
    except Exception:
        return False
    return res.status_code == 200


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

    def test_una_sola_columna_destino_jaula_misma_tabla(self):
        # Hallazgo de esquema: poza y jaula son la misma tabla
        # (PECUARIO_JAULAS) -- por eso un solo par origen/destino_jaula_id,
        # no poza_origen_id/jaula_origen_id duplicados.
        self.assertIn("origen_jaula_id UUID", self.sql)
        self.assertIn("destino_jaula_id UUID NOT NULL", self.sql)
        self.assertNotIn("poza_origen_id UUID", self.sql)
        self.assertNotIn("jaula_origen_id UUID", self.sql)

    def test_enums_nuevos(self):
        self.assertIn("CREATE TYPE tipo_origen_traslado AS ENUM ('lote', 'reproductor')", self.sql)
        self.assertIn("CREATE TYPE alcance_traslado_lote AS ENUM ('completo', 'parcial')", self.sql)
        self.assertIn(
            "CREATE TYPE motivo_traslado_pecuario AS ENUM "
            "('enfermedad_aislamiento', 'recomposicion_poza', 'sobrepoblacion', 'otro')",
            self.sql,
        )

    def test_checks_de_consistencia_presentes(self):
        for chk in (
            "chk_traslados_tipo_origen_coherente",
            "chk_traslados_alcance_solo_lote",
            "chk_traslados_parcial_requiere_datos",
            "chk_traslados_origen_destino_distintos",
        ):
            with self.subTest(chk=chk):
                self.assertIn(chk, self.sql)

    def test_trigger_before_insert_no_after(self):
        self.assertIn("CREATE TRIGGER trg_traslados_procesar", self.sql)
        self.assertIn("BEFORE INSERT ON public.\"PECUARIO_TRASLADOS\"", self.sql)

    def test_trigger_no_confia_origen_jaula_id_del_cliente(self):
        # El trigger sobreescribe NEW.origen_jaula_id siempre, leyendo el
        # estado real -- no usa NEW.origen_jaula_id como fuente en ningún
        # INSERT/SELECT (solo lo asigna, nunca lo lee de vuelta).
        self.assertIn("INTO v_org_lote, v_cantidad_actual, NEW.origen_jaula_id", self.sql)
        self.assertIn("INTO v_org_animal, NEW.origen_jaula_id", self.sql)

    def test_rls_habilitado(self):
        self.assertIn('ALTER TABLE public."PECUARIO_TRASLADOS" ENABLE ROW LEVEL SECURITY', self.sql)
        self.assertIn("auth_org_id()", self.sql)

    def test_preflight_exige_dependencias(self):
        self.assertIn('to_regclass(\'public."PECUARIO_LOTES"\')', self.sql)
        self.assertIn('to_regclass(\'public."PECUARIO_JAULAS"\')', self.sql)
        self.assertIn('to_regclass(\'public."PECUARIO_REPRODUCTORES"\')', self.sql)
        self.assertIn("proname = 'auth_org_id'", self.sql)


class TestZodContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parent.parent / "lib" / "validations" / "pecuario.ts"
        if not path.exists():
            raise AssertionError(f"No existe {path}")
        cls.ts = path.read_text(encoding="utf-8")
        start = cls.ts.index("export const TrasladoRegistroSchema")
        end = cls.ts.index("export type TrasladoRegistroInput")
        cls.body = cls.ts[start:end]

    def test_schema_exportado(self):
        self.assertIn("export const TrasladoRegistroSchema", self.ts)
        self.assertIn("export type TrasladoRegistroInput", self.ts)

    def test_no_incluye_campos_calculados_por_el_servidor(self):
        # origen_jaula_id y lote_nuevo_id los calcula el trigger -- el
        # cliente nunca los manda, no deben estar en el schema de entrada.
        self.assertNotIn("origen_jaula_id:", self.body)
        self.assertNotIn("lote_nuevo_id:", self.body)

    def test_refines_reglas_cruzadas_presentes(self):
        self.assertIn("data.tipo_origen !== 'lote' || (data.lote_id != null && data.animal_id == null)", self.body)
        self.assertIn("data.tipo_origen !== 'reproductor' || (data.animal_id != null && data.lote_id == null)", self.body)
        self.assertIn("data.alcance !== 'parcial' || (data.cantidad != null && data.cantidad > 0 && !!data.codigo_lote_nuevo)", self.body)


@NEEDS_SUPABASE
class TestTrasladoInternoLive(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not _migracion_aplicada():
            raise unittest.SkipTest(
                "PECUARIO_TRASLADOS no existe todavía -- "
                "20260924100000_pecuario_traslado_interno.sql no aplicada "
                "(aplicación manual pendiente, ver §4.1.4)."
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
            json={"ID_Organizacion": org, "codigo_poza": f"TEST-TRASLADO-{self.suffix}-{len(self._cleanup)}"},
            timeout=30,
        )
        res.raise_for_status()
        jaula_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_JAULAS", "id", jaula_id))
        return jaula_id

    def _crear_lote(self, poza_id, cantidad_actual=20, org=ORG_A):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_LOTES",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={
                "ID_Organizacion": org, "codigo_lote": f"TEST-TRASLADO-{self.suffix}",
                "poza_actual_id": poza_id, "cantidad_inicial": cantidad_actual, "cantidad_actual": cantidad_actual,
            },
            timeout=30,
        )
        res.raise_for_status()
        lote_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_LOTES", "id", lote_id))
        return lote_id

    def _crear_reproductor(self, jaula_id=None, org=ORG_A):
        payload = {"ID_Organizacion": org, "codigo_arete": f"TEST-TRASLADO-{self.suffix}", "sexo": "macho"}
        if jaula_id:
            payload["jaula_actual_id"] = jaula_id
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_REPRODUCTORES",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json=payload, timeout=30,
        )
        res.raise_for_status()
        animal_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_REPRODUCTORES", "id", animal_id))
        return animal_id

    def _get_lote(self, lote_id):
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_LOTES", headers=_service_headers(),
            params={"id": f"eq.{lote_id}"}, timeout=30,
        )
        res.raise_for_status()
        return res.json()[0]

    def _insertar_traslado(self, **kwargs):
        payload = {"ID_Organizacion": ORG_A, "motivo_traslado": "recomposicion_poza"}
        payload.update(kwargs)
        return httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_TRASLADOS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json=payload, timeout=30,
        )

    # ---- Traslado de lote, completo ----

    def test_traslado_completo_cambia_poza_sin_crear_fila_nueva(self):
        origen = self._crear_jaula()
        destino = self._crear_jaula()
        lote_id = self._crear_lote(origen)

        res = self._insertar_traslado(tipo_origen="lote", lote_id=lote_id, destino_jaula_id=destino, alcance="completo")
        self.assertEqual(res.status_code, 201, res.text)
        row = res.json()[0]
        self._cleanup.append(("PECUARIO_TRASLADOS", "id", row["id"]))

        self.assertIsNone(row["lote_nuevo_id"])
        lote = self._get_lote(lote_id)
        self.assertEqual(lote["poza_actual_id"], destino)

        # No debe existir ningún otro lote además del original.
        otros = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_LOTES", headers=_service_headers(),
            params={"codigo_lote": f"eq.TEST-TRASLADO-{self.suffix}"}, timeout=30,
        )
        otros.raise_for_status()
        self.assertEqual(len(otros.json()), 1, "Un traslado completo no debe crear ninguna fila nueva en PECUARIO_LOTES.")

    # ---- Traslado de lote, parcial (split) ----

    def test_traslado_parcial_crea_lote_nuevo_y_descuenta_origen(self):
        origen = self._crear_jaula()
        destino = self._crear_jaula()
        lote_id = self._crear_lote(origen, cantidad_actual=20)

        res = self._insertar_traslado(
            tipo_origen="lote", lote_id=lote_id, destino_jaula_id=destino,
            alcance="parcial", cantidad=8, codigo_lote_nuevo=f"TEST-SPLIT-{self.suffix}",
        )
        self.assertEqual(res.status_code, 201, res.text)
        row = res.json()[0]
        self._cleanup.append(("PECUARIO_TRASLADOS", "id", row["id"]))
        self.assertIsNotNone(row["lote_nuevo_id"])
        self._cleanup.append(("PECUARIO_LOTES", "id", row["lote_nuevo_id"]))

        lote_origen = self._get_lote(lote_id)
        self.assertEqual(lote_origen["cantidad_actual"], 12)  # 20 - 8
        self.assertEqual(lote_origen["poza_actual_id"], origen)  # el origen no se mueve

        lote_nuevo = self._get_lote(row["lote_nuevo_id"])
        self.assertEqual(lote_nuevo["cantidad_actual"], 8)
        self.assertEqual(lote_nuevo["poza_actual_id"], destino)
        self.assertEqual(lote_nuevo["codigo_lote"], f"TEST-SPLIT-{self.suffix}")

    def test_traslado_parcial_cantidad_mayor_a_disponible_falla(self):
        origen = self._crear_jaula()
        destino = self._crear_jaula()
        lote_id = self._crear_lote(origen, cantidad_actual=5)

        res = self._insertar_traslado(
            tipo_origen="lote", lote_id=lote_id, destino_jaula_id=destino,
            alcance="parcial", cantidad=999, codigo_lote_nuevo=f"TEST-SPLIT-FAIL-{self.suffix}",
        )
        self.assertEqual(res.status_code, 400, res.text)

        # La cantidad del lote origen no debe haber cambiado.
        lote_origen = self._get_lote(lote_id)
        self.assertEqual(lote_origen["cantidad_actual"], 5)

    # ---- Validaciones multi-tenant y de coherencia ----

    def test_destino_de_otra_organizacion_falla(self):
        origen = self._crear_jaula()
        lote_id = self._crear_lote(origen)
        destino_otra_org = self._crear_jaula(org=ORG_B)

        res = self._insertar_traslado(tipo_origen="lote", lote_id=lote_id, destino_jaula_id=destino_otra_org, alcance="completo")
        self.assertEqual(res.status_code, 400, res.text)

    def test_origen_igual_a_destino_falla(self):
        jaula = self._crear_jaula()
        lote_id = self._crear_lote(jaula)

        res = self._insertar_traslado(tipo_origen="lote", lote_id=lote_id, destino_jaula_id=jaula, alcance="completo")
        self.assertEqual(res.status_code, 400, res.text)

    def test_origen_jaula_id_calculado_ignora_lo_que_manda_el_cliente(self):
        origen_real = self._crear_jaula()
        destino = self._crear_jaula()
        jaula_falsa = self._crear_jaula()  # el cliente intentará mentir con esta
        lote_id = self._crear_lote(origen_real)

        res = self._insertar_traslado(
            tipo_origen="lote", lote_id=lote_id, destino_jaula_id=destino, alcance="completo",
            origen_jaula_id=jaula_falsa,  # el trigger debe ignorar esto y usar el real
        )
        self.assertEqual(res.status_code, 201, res.text)
        row = res.json()[0]
        self._cleanup.append(("PECUARIO_TRASLADOS", "id", row["id"]))
        self.assertEqual(row["origen_jaula_id"], origen_real, "El trigger debe calcular origen_jaula_id del estado real, ignorando lo que mande el cliente.")
        self.assertNotEqual(row["origen_jaula_id"], jaula_falsa)

    # ---- Traslado de reproductor individual ----

    def test_traslado_reproductor_actualiza_jaula_actual(self):
        origen = self._crear_jaula()
        destino = self._crear_jaula()
        animal_id = self._crear_reproductor(jaula_id=origen)

        res = self._insertar_traslado(tipo_origen="reproductor", animal_id=animal_id, destino_jaula_id=destino, motivo_traslado="enfermedad_aislamiento")
        self.assertEqual(res.status_code, 201, res.text)
        row = res.json()[0]
        self._cleanup.append(("PECUARIO_TRASLADOS", "id", row["id"]))
        self.assertEqual(row["origen_jaula_id"], origen)
        self.assertIsNone(row["lote_nuevo_id"])

        animal = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_REPRODUCTORES", headers=_service_headers(),
            params={"id": f"eq.{animal_id}"}, timeout=30,
        )
        animal.raise_for_status()
        self.assertEqual(animal.json()[0]["jaula_actual_id"], destino)

    # ---- Aislamiento RLS cruzado (pedido explícito) ----

    def test_aislamiento_rls_cruzado_otra_org_no_lee_traslados_de_granja_valencia(self):
        origen = self._crear_jaula()
        destino = self._crear_jaula()
        lote_id = self._crear_lote(origen)

        seed = self._insertar_traslado(tipo_origen="lote", lote_id=lote_id, destino_jaula_id=destino, alcance="completo")
        seed.raise_for_status()
        seeded_id = seed.json()[0]["id"]
        self._cleanup.append(("PECUARIO_TRASLADOS", "id", seeded_id))

        read = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_TRASLADOS",
            headers=_session_headers(self.otra_org_token), params={"id": f"eq.{seeded_id}"}, timeout=30,
        )
        self.assertEqual(read.status_code, 200)
        self.assertEqual(
            read.json(), [],
            f"Una sesión autenticada de {ORG_B} no debe ver, vía PECUARIO_TRASLADOS, ningún registro de {ORG_A}.",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
