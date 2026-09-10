"""
Test de integración para el módulo Pecuario Cuyes MVP
(supabase/migrations/20260910160000_pecuario_cuyes_core.sql,
specs/pecuario_cuyes_mvp.md). Mismo patrón NEEDS_SUPABASE +
_migration_is_applied que tests/test_fix_id_parcela_fija_guid_qfield.py.

CONTEXTO IMPORTANTE (verificado en vivo en esta tarea, ver
specs/pecuario_cuyes_mvp.md "Verificación pendiente" y
docs/schema_live_pecuario.md): la premisa de que PECUARIO_GALPONES,
PECUARIO_JAULAS, PECUARIO_LOTES y PECUARIO_PESAJE_ALIMENTACION "ya
existen en producción (Granja Valencia activa)" era FALSA -- ninguna
de las 5 tablas (las 4 anteriores + TAREAS) existe hoy en la instancia
real (jhtocgxlozfuzullrtol), confirmado por 3 vías independientes
(OpenAPI schema de PostgREST, PGRST205 en un GET directo a cada tabla,
y ORGANIZACIONES no tiene ninguna fila "Granja Valencia" -- solo
COOP-AROMAS-VALLE y ORG-TEST-DEMO existen). La migración, al estar
escrita defensivamente (CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT
EXISTS + chequeos information_schema antes de cada FK condicional),
sigue siendo segura de aplicar tal cual bajo el estado real: crea las 6
tablas desde cero en el orden correcto (cada FK condicional encuentra
su tabla ya creada más arriba en la misma transacción), excepto
PECUARIO_GALPONES, que nunca se crea en este archivo (se referencia
solo por FK) -- queda como columna sin restricción (galpon_id) hasta
que exista una spec propia para esa tabla. El trigger de destete
verifica TAREAS con to_regclass() y no rompe el INSERT del parto si no
existe (emite RAISE WARNING) -- TAREAS tampoco existe hoy.

Se omiten automáticamente (pytest.skip) cuando las credenciales no
están disponibles, y también hasta que la migración se aplique
manualmente en Supabase Studio (_migration_is_applied) -- el usuario
decide cuándo, este repo nunca la aplica solo.
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
    / "supabase"
    / "migrations"
    / "20260910160000_pecuario_cuyes_core.sql"
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
ADMIN_EMAIL = "admin-demo@ryzos-demo.test"  # sesión real, ORG_A


def _service_headers():
    return {"apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"}


def _anon_headers():
    return {"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {SUPABASE_ANON_KEY}"}


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


def _migration_is_applied():
    """Chequeo no destructivo: PECUARIO_CONFIGURACION es la primera tabla
    que crea la migración -- si PostgREST la resuelve (200, no PGRST205),
    la migración ya se aplicó en la instancia real."""
    try:
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_CONFIGURACION",
            headers=_service_headers(),
            params={"limit": 1},
            timeout=15,
        )
    except Exception:
        return False
    return res.status_code == 200


class TestMigrationFileStatic(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not MIGRATION_PATH.exists():
            raise AssertionError(f"No existe {MIGRATION_PATH}")
        cls.sql = MIGRATION_PATH.read_text(encoding="utf-8")

    def test_file_exists(self):
        self.assertTrue(MIGRATION_PATH.exists())

    def test_all_new_tables_create_table_if_not_exists(self):
        for table in (
            "PECUARIO_CONFIGURACION",
            "PECUARIO_JAULAS",
            "PECUARIO_PARTOS",
            "PECUARIO_LOTES",
            "PECUARIO_PESAJES",
            "PECUARIO_MORTALIDAD",
            "PECUARIO_VENTAS",
        ):
            with self.subTest(table=table):
                self.assertIn(f'CREATE TABLE IF NOT EXISTS public."{table}"', self.sql)

    def test_pecuario_galpones_never_created_only_referenced(self):
        """Regresión de documentación: PECUARIO_GALPONES se referencia por FK
        condicional pero esta migración nunca la crea -- confirmado en vivo
        que tampoco existe hoy en producción. Si algún día se agrega un
        CREATE TABLE para ella, este test debe actualizarse a propósito."""
        self.assertNotIn('CREATE TABLE IF NOT EXISTS public."PECUARIO_GALPONES"', self.sql)
        self.assertIn("PECUARIO_GALPONES", self.sql)

    def test_every_new_table_has_rls_enabled_and_policy(self):
        for table in (
            "PECUARIO_CONFIGURACION",
            "PECUARIO_JAULAS",
            "PECUARIO_PARTOS",
            "PECUARIO_LOTES",
            "PECUARIO_PESAJES",
            "PECUARIO_MORTALIDAD",
            "PECUARIO_VENTAS",
        ):
            with self.subTest(table=table):
                self.assertIn(f'ALTER TABLE public."{table}"', self.sql)
        self.assertEqual(self.sql.count("ENABLE ROW LEVEL SECURITY"), 7)
        self.assertEqual(self.sql.count("TO authenticated"), 7)

    def test_rls_policy_scopes_by_org_not_role(self):
        """A diferencia de PADRON_SOCIOS/INSPECCIONES, este módulo no exige
        rol -- cualquier authenticated de la organización puede escribir
        (spec: app móvil de campo, un solo tipo de usuario interno)."""
        policy_blocks = re.findall(r'CREATE POLICY.*?WITH CHECK \((.*?)\);', self.sql, re.DOTALL)
        self.assertEqual(len(policy_blocks), 7)
        for block in policy_blocks:
            self.assertIn('"ID_Organizacion" = public.auth_org_id()', block)
            self.assertIn("auth.role() = 'service_role'", block)

    def test_destete_trigger_checks_tareas_exists_before_insert(self):
        self.assertIn("to_regclass('public.\"TAREAS\"') IS NULL", self.sql)
        self.assertIn("RAISE WARNING", self.sql)

    def test_conditional_fks_check_information_schema_first(self):
        self.assertGreaterEqual(self.sql.count("FROM information_schema.columns"), 3)
        self.assertIn("RAISE NOTICE 'VERIFICAR MANUAL", self.sql)


class TestValidationsFileStatic(unittest.TestCase):
    """Regresión de la ruta corregida: el diseño original citaba
    lib/validators/pecuario.ts (no existe) -- el real es
    lib/validations/pecuario.ts."""

    def test_validations_file_exists_at_corrected_path(self):
        path = Path(__file__).resolve().parent.parent / "lib" / "validations" / "pecuario.ts"
        self.assertTrue(path.exists())

    def test_validators_typo_path_does_not_exist(self):
        path = Path(__file__).resolve().parent.parent / "lib" / "validators" / "pecuario.ts"
        self.assertFalse(path.exists())


@NEEDS_SUPABASE
class TestPecuarioRlsLive(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not _migration_is_applied():
            raise unittest.SkipTest(
                "supabase/migrations/20260910160000_pecuario_cuyes_core.sql todavía no "
                "se aplicó manualmente en Supabase Studio contra jhtocgxlozfuzullrtol — "
                "se salta hasta que el usuario la aplique."
            )
        cls.admin_token = _magic_link_access_token(ADMIN_EMAIL)

    def setUp(self):
        self.suffix = str(int(time.time() * 1000))
        self._created_ids = []

    def tearDown(self):
        for row_id in self._created_ids:
            httpx.delete(
                f"{SUPABASE_URL}/rest/v1/PECUARIO_JAULAS",
                headers=_service_headers(),
                params={"id": f"eq.{row_id}"},
                timeout=30,
            )

    def test_authenticated_session_can_write_own_org(self):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_JAULAS",
            headers={**_session_headers(self.admin_token), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={
                "ID_Organizacion": ORG_A,
                "codigo_poza": f"TEST-RLS-{self.suffix}",
            },
            timeout=30,
        )
        self.assertEqual(res.status_code, 201, res.text)
        row = res.json()[0]
        self._created_ids.append(row["id"])
        self.assertEqual(row["ID_Organizacion"], ORG_A)

    def test_cross_org_read_isolation(self):
        """El caso explícitamente pedido: una organización no debe poder
        leer filas PECUARIO_* de otra."""
        seed = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_JAULAS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={
                "ID_Organizacion": ORG_B,
                "codigo_poza": f"TEST-RLS-CROSSORG-{self.suffix}",
            },
            timeout=30,
        )
        seed.raise_for_status()
        seeded_id = seed.json()[0]["id"]
        self._created_ids.append(seeded_id)

        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_JAULAS",
            headers=_session_headers(self.admin_token),
            params={"id": f"eq.{seeded_id}"},
            timeout=30,
        )
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json(), [], "RLS debe ocultar filas de otra organización, no solo bloquear escrituras")

    def test_anon_without_session_cannot_read(self):
        """Las políticas son TO authenticated únicamente -- sin sesión real,
        anon no tiene ninguna política que le devuelva filas."""
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_JAULAS",
            headers=_anon_headers(),
            params={"limit": 1},
            timeout=30,
        )
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json(), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
