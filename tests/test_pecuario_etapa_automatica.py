"""
Test de integración para la vista `vw_pecuario_lotes_etapa` (corte
automático Recría -> Engorde a las 8 semanas / 56 días).

Ver supabase/migrations/20260922100000_pecuario_vista_etapa_automatica.sql
y specs/pecuario_etapa_automatica_8_semanas.md (sección 7, casos exigidos).

La migración NO se aplica desde este archivo ni desde ningún script de este
repo -- ninguna migración SQL se aplica automáticamente contra la base real
(system prompt / docs/RYZOS_ORQUESTADOR_V3.1.md §4.1.4). Este archivo
verifica el contenido estático de la migración siempre, y sus casos en vivo
solo cuando la vista ya existe (aplicada a mano en Supabase Studio) --
`unittest.SkipTest` explícito en caso contrario, sin fallar la suite.
"""

import os
import time
import unittest
from datetime import date, timedelta
from pathlib import Path

import httpx
import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase" / "migrations" / "20260922100000_pecuario_vista_etapa_automatica.sql"
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


def _vista_aplicada():
    try:
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/vw_pecuario_lotes_etapa",
            headers=_service_headers(),
            params={"select": "etapa_calculada,dias_para_engorde", "limit": 1},
            timeout=15,
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

    def test_view_created_or_replace_idempotent(self):
        self.assertIn("CREATE OR REPLACE VIEW public.vw_pecuario_lotes_etapa", self.sql)

    def test_regla_56_dias_recria_a_engorde(self):
        self.assertIn(">= 56", self.sql)
        self.assertIn("'engorde'::etapa_productiva", self.sql)

    def test_no_muta_columna_base_etapa(self):
        # Aditiva: no debe haber ningún UPDATE/ALTER sobre PECUARIO_LOTES.etapa.
        self.assertNotIn('UPDATE public."PECUARIO_LOTES"', self.sql)
        self.assertNotIn('ALTER TABLE public."PECUARIO_LOTES"', self.sql)

    def test_filtro_organizacion_escrito_a_mano(self):
        # Lección ADR-001: la vista no hereda RLS de la tabla base, el
        # filtro de organización debe estar explícito en el WHERE.
        self.assertIn("auth_org_id()", self.sql)
        self.assertIn("WHERE", self.sql)

    def test_grant_select_authenticated(self):
        self.assertIn("GRANT SELECT ON public.vw_pecuario_lotes_etapa TO authenticated", self.sql)


@NEEDS_SUPABASE
class TestVistaEtapaLive(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not _vista_aplicada():
            raise unittest.SkipTest(
                "vw_pecuario_lotes_etapa no existe todavía -- migración "
                "20260922100000_pecuario_vista_etapa_automatica.sql no aplicada "
                "(aplicación manual pendiente, ver §4.1.4)."
            )
        cls.admin_token = _magic_link_access_token(ADMIN_EMAIL)

    def setUp(self):
        self.suffix = str(int(time.time() * 1000))
        self._cleanup = []  # list of (table, field, value), LIFO en tearDown

    def tearDown(self):
        for table, field, value in reversed(self._cleanup):
            httpx.delete(f"{SUPABASE_URL}/rest/v1/{table}", headers=_service_headers(), params={field: f"eq.{value}"}, timeout=30)

    def _crear_lote(self, org, dias_desde_destete, etapa="recria", estado="activo"):
        fecha_destete = (date.today() - timedelta(days=dias_desde_destete)).isoformat()
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_LOTES",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={
                "ID_Organizacion": org,
                "codigo_lote": f"TEST-ETAPA-{self.suffix}-{dias_desde_destete}",
                "fecha_destete": fecha_destete,
                "etapa": etapa,
                "estado": estado,
            },
            timeout=30,
        )
        res.raise_for_status()
        lote_id = res.json()[0]["id"]
        self._cleanup.append(("PECUARIO_LOTES", "id", lote_id))
        return lote_id

    def _leer_vista(self, lote_id):
        res = httpx.get(
            f"{SUPABASE_URL}/rest/v1/vw_pecuario_lotes_etapa",
            headers=_service_headers(),
            params={"id": f"eq.{lote_id}", "select": "etapa_calculada,dias_para_engorde"},
            timeout=30,
        )
        res.raise_for_status()
        rows = res.json()
        self.assertEqual(len(rows), 1, f"Esperaba exactamente 1 fila para lote {lote_id}")
        return rows[0]

    def test_recria_antes_de_las_8_semanas(self):
        lote_id = self._crear_lote(ORG_A, dias_desde_destete=40, etapa="recria", estado="activo")
        row = self._leer_vista(lote_id)
        self.assertEqual(row["etapa_calculada"], "recria")
        self.assertEqual(row["dias_para_engorde"], 16)

    def test_exactamente_a_las_8_semanas(self):
        lote_id = self._crear_lote(ORG_A, dias_desde_destete=56, etapa="recria", estado="activo")
        row = self._leer_vista(lote_id)
        self.assertEqual(row["etapa_calculada"], "engorde")
        self.assertIsNone(row["dias_para_engorde"])

    def test_reproductor_fijado_a_mano_no_se_pisa(self):
        lote_id = self._crear_lote(ORG_A, dias_desde_destete=90, etapa="reproductor", estado="activo")
        row = self._leer_vista(lote_id)
        self.assertEqual(
            row["etapa_calculada"], "reproductor",
            "La regla automática (recría->engorde) nunca debe pisar un lote fijado a mano como reproductor.",
        )
        self.assertIsNone(row["dias_para_engorde"])

    def test_lote_no_activo_no_se_recalcula(self):
        lote_id = self._crear_lote(ORG_A, dias_desde_destete=90, etapa="recria", estado="vendido")
        row = self._leer_vista(lote_id)
        self.assertEqual(
            row["etapa_calculada"], "recria",
            "Un lote que ya no está activo no debe recalcularse a 'engorde' aunque pasaran las 8 semanas.",
        )
        self.assertIsNone(row["dias_para_engorde"])

    def test_cross_org_read_isolation(self):
        lote_b = self._crear_lote(ORG_B, dias_desde_destete=56, etapa="recria", estado="activo")
        read = httpx.get(
            f"{SUPABASE_URL}/rest/v1/vw_pecuario_lotes_etapa",
            headers=_session_headers(self.admin_token),
            params={"id": f"eq.{lote_b}"},
            timeout=30,
        )
        self.assertEqual(read.status_code, 200)
        self.assertEqual(
            read.json(), [],
            "Una sesión autenticada de ORG_A no debe ver, vía vw_pecuario_lotes_etapa, "
            "ningún lote de ORG_B -- ni siquiera uno cuya etapa_calculada ya sea 'engorde'.",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
