"""
Test de integración para PECUARIO_MORTALIDAD_FOTOS (evidencia fotográfica
en registros de mortalidad) y el bucket privado `evidencias_pecuario`
(Storage), con políticas RLS por organización -- mismo patrón que
`evidencias_eudr`.

Ver supabase/migrations/20260923120000_pecuario_mortalidad_evidencia_fotografica.sql
(specs/pecuario_mortalidad_evidencia_fotografica.md no existe en este
repo -- solo referenciada por la migración, nunca comiteada; la
migración trae suficiente contexto en su propia cabecera para verificar
sin ella, mismo hallazgo que la migración de Guano).

La migración NO se aplica desde este archivo ni desde ningún script de este
repo -- ninguna migración SQL se aplica automáticamente contra la base real
(system prompt / docs/RYZOS_ORQUESTADOR_V3.1.md §4.1.4). Este archivo
verifica el contenido estático de la migración y del contrato Zod siempre,
y sus casos en vivo solo cuando la tabla y el bucket ya existen (aplicados
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
    / "supabase" / "migrations" / "20260923120000_pecuario_mortalidad_evidencia_fotografica.sql"
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

NEEDS_SUPABASE = pytest.mark.skipif(
    not SUPABASE_URL or not SUPABASE_ANON_KEY or not SUPABASE_SERVICE_ROLE_KEY,
    reason="SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY no configuradas — test requiere Supabase Live",
)

ORG_A = "ORG-TEST-DEMO"
ORG_B = "COOP-AROMAS-VALLE"
ADMIN_EMAIL = "admin-demo@ryzos-demo.test"
# JPEG mínimo válido (header + EOF), suficiente para pasar allowed_mime_types.
TINY_JPEG = bytes.fromhex("ffd8ffe000104a46494600010100000100010000ffd9")


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
        tabla = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_MORTALIDAD_FOTOS",
            headers=_service_headers(), params={"select": "id", "limit": 1}, timeout=15,
        )
        bucket = httpx.get(
            f"{SUPABASE_URL}/storage/v1/bucket/evidencias_pecuario",
            headers=_service_headers(), timeout=15,
        )
    except Exception:
        return False
    return tabla.status_code == 200 and bucket.status_code == 200


class TestMigrationFileStatic(unittest.TestCase):
    """No requiere Supabase Live -- verifica el contenido de la migración
    en disco, siempre corre."""

    @classmethod
    def setUpClass(cls):
        if not MIGRATION_PATH.exists():
            raise AssertionError(f"No existe {MIGRATION_PATH}")
        cls.sql = MIGRATION_PATH.read_text(encoding="utf-8")

    def test_tabla_una_fila_por_foto_no_array(self):
        self.assertIn('CREATE TABLE IF NOT EXISTS public."PECUARIO_MORTALIDAD_FOTOS"', self.sql)

    def test_storage_path_unico(self):
        self.assertIn("uq_mortalidad_fotos_storage_path", self.sql)
        self.assertIn("UNIQUE (storage_path)", self.sql)

    def test_fk_mortalidad_cascade(self):
        self.assertIn("fk_mortalidad_fotos_mortalidad", self.sql)
        self.assertIn('REFERENCES public."PECUARIO_MORTALIDAD"(id) ON DELETE CASCADE', self.sql)

    def test_rls_tabla_habilitado(self):
        self.assertIn('ALTER TABLE public."PECUARIO_MORTALIDAD_FOTOS" ENABLE ROW LEVEL SECURITY', self.sql)

    def test_bucket_privado_creado(self):
        self.assertIn("INSERT INTO storage.buckets", self.sql)
        self.assertIn("'evidencias_pecuario'", self.sql)
        self.assertIn("false,", self.sql)  # public = false
        self.assertIn("10485760", self.sql)  # 10MB, mismo tope que evidencias_eudr

    def test_bucket_no_reutiliza_evidencias_eudr(self):
        # 'evidencias_eudr' aparece en comentarios explicando el patrón
        # seguido y que NO se reutiliza -- lo que no debe existir es una
        # operación real de bucket/policy sobre ese id.
        self.assertNotIn("'evidencias_eudr'", self.sql)

    def test_4_politicas_storage_objects(self):
        for cmd in ("SELECT", "INSERT", "UPDATE", "DELETE"):
            with self.subTest(cmd=cmd):
                self.assertIn(f"FOR {cmd} TO authenticated", self.sql)
        # SELECT/DELETE solo USING (1 c/u), INSERT solo WITH CHECK (1),
        # UPDATE ambas cláusulas (2) -- 1+1+1+2 = 5 ocurrencias en total.
        self.assertEqual(self.sql.count("bucket_id = 'evidencias_pecuario'"), 5)

    def test_politicas_storage_usan_auth_org_id_por_carpeta(self):
        self.assertIn("(storage.foldername(name))[1] = public.auth_org_id()", self.sql)

    def test_preflight_exige_mortalidad_y_auth_org_id(self):
        self.assertIn('to_regclass(\'public."PECUARIO_MORTALIDAD"\')', self.sql)
        self.assertIn("proname = 'auth_org_id'", self.sql)

    def test_no_agrega_tope_de_fotos_por_registro(self):
        # Decisión explícita: el tope todavía no está confirmado (spec §5)
        # -- no debe haber un CHECK/trigger que cuente fotos por
        # mortalidad_id en esta migración.
        self.assertNotIn("COUNT(*)", self.sql.upper())
        self.assertNotIn("CREATE TRIGGER", self.sql)


class TestZodContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parent.parent / "lib" / "validations" / "pecuario.ts"
        if not path.exists():
            raise AssertionError(f"No existe {path}")
        cls.ts = path.read_text(encoding="utf-8")

    def test_mortalidad_foto_schema_exported(self):
        self.assertIn("export const MortalidadFotoSchema", self.ts)
        self.assertIn("export type MortalidadFotoInput", self.ts)

    def test_campos_minimos_presentes(self):
        start = self.ts.index("export const MortalidadFotoSchema")
        end = self.ts.index("export type MortalidadFotoInput")
        body = self.ts[start:end]
        for campo in ("mortalidad_id", "storage_path"):
            with self.subTest(campo=campo):
                self.assertIn(f"{campo}:", body)


@NEEDS_SUPABASE
class TestMortalidadFotosLive(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not _migracion_aplicada():
            raise unittest.SkipTest(
                "PECUARIO_MORTALIDAD_FOTOS o el bucket evidencias_pecuario no existen "
                "todavía -- 20260923120000_pecuario_mortalidad_evidencia_fotografica.sql "
                "no aplicada (aplicación manual pendiente, ver §4.1.4)."
            )
        cls.admin_token = _magic_link_access_token(ADMIN_EMAIL)

    def setUp(self):
        self.suffix = str(int(time.time() * 1000))
        self._cleanup = []      # list of (table, field, value), LIFO en tearDown
        self._storage_paths = []

    def tearDown(self):
        for table, field, value in reversed(self._cleanup):
            httpx.delete(f"{SUPABASE_URL}/rest/v1/{table}", headers=_service_headers(), params={field: f"eq.{value}"}, timeout=30)
        for path in self._storage_paths:
            httpx.delete(f"{SUPABASE_URL}/storage/v1/object/evidencias_pecuario/{path}", headers=_service_headers(), timeout=30)

    def _crear_mortalidad(self, org=ORG_A):
        lote = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_LOTES",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": org, "codigo_lote": f"TEST-FOTOS-{self.suffix}-{org}"},
            timeout=30,
        )
        lote.raise_for_status()
        lote_id = lote.json()[0]["id"]
        self._cleanup.append(("PECUARIO_LOTES", "id", lote_id))

        mort = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_MORTALIDAD",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": org, "lote_id": lote_id, "fecha_evento": "2026-09-23", "cantidad": 1, "etapa": "recria"},
            timeout=30,
        )
        mort.raise_for_status()
        mort_id = mort.json()[0]["id"]
        self._cleanup.append(("PECUARIO_MORTALIDAD", "id", mort_id))
        return mort_id

    def test_insert_foto_valida(self):
        mort_id = self._crear_mortalidad()
        path = f"{ORG_A}/mortalidad/{mort_id}/foto1-{self.suffix}.jpg"
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_MORTALIDAD_FOTOS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": ORG_A, "mortalidad_id": mort_id, "storage_path": path},
            timeout=30,
        )
        self.assertEqual(res.status_code, 201, res.text)
        row = res.json()[0]
        self._cleanup.append(("PECUARIO_MORTALIDAD_FOTOS", "id", row["id"]))
        self.assertEqual(row["mortalidad_id"], mort_id)
        self.assertEqual(row["storage_path"], path)

    def test_storage_path_duplicado_falla_unique(self):
        mort_id = self._crear_mortalidad()
        path = f"{ORG_A}/mortalidad/{mort_id}/dup-{self.suffix}.jpg"
        first = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_MORTALIDAD_FOTOS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": ORG_A, "mortalidad_id": mort_id, "storage_path": path},
            timeout=30,
        )
        first.raise_for_status()
        self._cleanup.append(("PECUARIO_MORTALIDAD_FOTOS", "id", first.json()[0]["id"]))

        dup = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_MORTALIDAD_FOTOS",
            headers={**_service_headers(), "Content-Type": "application/json"},
            json={"ID_Organizacion": ORG_A, "mortalidad_id": mort_id, "storage_path": path},
            timeout=30,
        )
        self.assertEqual(dup.status_code, 409, dup.text)

    def test_tabla_cross_org_read_isolation(self):
        mort_b_id = self._crear_mortalidad(org=ORG_B)
        seed = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_MORTALIDAD_FOTOS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": ORG_B, "mortalidad_id": mort_b_id, "storage_path": f"{ORG_B}/mortalidad/{mort_b_id}/foto-{self.suffix}.jpg"},
            timeout=30,
        )
        seed.raise_for_status()
        seeded_id = seed.json()[0]["id"]
        self._cleanup.append(("PECUARIO_MORTALIDAD_FOTOS", "id", seeded_id))

        read = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_MORTALIDAD_FOTOS",
            headers=_session_headers(self.admin_token), params={"id": f"eq.{seeded_id}"}, timeout=30,
        )
        self.assertEqual(read.status_code, 200)
        self.assertEqual(read.json(), [], "Una sesión autenticada de ORG_A no debe ver fotos de mortalidad de ORG_B.")

    def test_storage_upload_propia_organizacion_permitido(self):
        mort_id = self._crear_mortalidad()
        path = f"{ORG_A}/mortalidad/{mort_id}/upload-{self.suffix}.jpg"
        self._storage_paths.append(path)
        res = httpx.post(
            f"{SUPABASE_URL}/storage/v1/object/evidencias_pecuario/{path}",
            headers={**_session_headers(self.admin_token), "Content-Type": "image/jpeg"},
            content=TINY_JPEG, timeout=30,
        )
        self.assertEqual(res.status_code, 200, res.text)

    def test_storage_upload_cruzado_rechazado(self):
        mort_b_id = self._crear_mortalidad(org=ORG_B)
        path = f"{ORG_B}/mortalidad/{mort_b_id}/hack-{self.suffix}.jpg"
        res = httpx.post(
            f"{SUPABASE_URL}/storage/v1/object/evidencias_pecuario/{path}",
            headers={**_session_headers(self.admin_token), "Content-Type": "image/jpeg"},
            content=TINY_JPEG, timeout=30,
        )
        self.assertEqual(
            res.status_code, 400,
            "Una sesión autenticada de ORG_A no debe poder subir un objeto a la carpeta de ORG_B "
            f"(la API de Storage devuelve 400 con code=AccessDenied cuando la política RLS rechaza). body={res.text}",
        )
        self.assertIn("AccessDenied", res.text)

    def test_storage_lectura_cruzada_rechazada(self):
        mort_b_id = self._crear_mortalidad(org=ORG_B)
        path = f"{ORG_B}/mortalidad/{mort_b_id}/seed-{self.suffix}.jpg"
        seed = httpx.post(
            f"{SUPABASE_URL}/storage/v1/object/evidencias_pecuario/{path}",
            headers={**_service_headers(), "Content-Type": "image/jpeg"}, content=TINY_JPEG, timeout=30,
        )
        seed.raise_for_status()
        self._storage_paths.append(path)

        read = httpx.get(
            f"{SUPABASE_URL}/storage/v1/object/evidencias_pecuario/{path}",
            headers=_session_headers(self.admin_token), timeout=30,
        )
        self.assertEqual(
            read.status_code, 400,
            "Una sesión autenticada de ORG_A no debe poder leer un objeto de la carpeta de ORG_B "
            f"(RLS lo hace indistinguible de 'no existe': 404/NoSuchKey). body={read.text}",
        )

    def test_storage_lectura_propia_permitida(self):
        mort_id = self._crear_mortalidad()
        path = f"{ORG_A}/mortalidad/{mort_id}/self-read-{self.suffix}.jpg"
        self._storage_paths.append(path)
        up = httpx.post(
            f"{SUPABASE_URL}/storage/v1/object/evidencias_pecuario/{path}",
            headers={**_session_headers(self.admin_token), "Content-Type": "image/jpeg"},
            content=TINY_JPEG, timeout=30,
        )
        up.raise_for_status()

        read = httpx.get(
            f"{SUPABASE_URL}/storage/v1/object/evidencias_pecuario/{path}",
            headers=_session_headers(self.admin_token), timeout=30,
        )
        self.assertEqual(read.status_code, 200)
        self.assertEqual(read.content, TINY_JPEG)


if __name__ == "__main__":
    unittest.main(verbosity=2)
