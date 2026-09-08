"""
Test de integración para fn_enforce_padron_admin_role (ver
supabase/migrations/20260906220000_enforce_padron_admin_trigger.sql,
specs/rbac_webgis_padron.md). Requiere conexión a Supabase Live —
mismo patrón NEEDS_SUPABASE que tests/test_fase1_sdd.py, extendido con
SUPABASE_ANON_KEY porque acá hace falta simular una sesión real
`authenticated` (magic link), no solo la Service Role Key.

Cierra el bypass confirmado en vivo en AI_STATE.md (2026-09-06,
"Revisión de seguridad de a975a7c"): assertAdminRole()
(lib/actions/sociosActions.js) es una capa de aplicación sin respaldo
de RLS — un tecnico_campo/auditor_qc podía saltarse la Server Action
con un PATCH/POST/DELETE directo a PostgREST. Este trigger cierra esa
brecha a nivel de base de datos.

Se omiten automáticamente (pytest.skip) cuando las credenciales no
están disponibles.
"""

import os
import time
import unittest

import httpx
import pytest

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

NEEDS_SUPABASE = pytest.mark.skipif(
    not SUPABASE_URL or not SUPABASE_ANON_KEY or not SUPABASE_SERVICE_ROLE_KEY,
    reason="SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY no configuradas — test requiere Supabase Live",
)

ORG = "ORG-TEST-DEMO"
TECNICO_EMAIL = "tecnico-campo-demo@ryzos-demo.test"
ADMIN_EMAIL = "admin-demo@ryzos-demo.test"


def _magic_link_access_token(email: str) -> str:
    """Sesión `authenticated` real vía magic link — mismo mecanismo usado en
    toda la verificación funcional de ADR-035 en adelante (Admin API
    generate_link + /auth/v1/verify, sin resetear contraseña)."""
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


def _service_headers():
    return {"apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"}


def _session_headers(access_token):
    return {"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {access_token}"}


@NEEDS_SUPABASE
class TestPadronAdminRoleTrigger(unittest.TestCase):
    def setUp(self):
        suffix = str(int(time.time() * 1000))
        self.socio_id = f"TEST-RBAC-TRIG-{suffix}"
        self.parcela_id = f"TEST-RBAC-TRIG-P-{suffix}"

        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PADRON_SOCIOS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={
                "ID_Socio": self.socio_id,
                "ID_Organizacion": ORG,
                "socio_nombre_completo": "Test RBAC Trigger Descartable",
                "socio_dni": "66666666",
                "activo": True,
            },
            timeout=30,
        )
        res.raise_for_status()

        self.tecnico_token = _magic_link_access_token(TECNICO_EMAIL)
        self.admin_token = _magic_link_access_token(ADMIN_EMAIL)

    def tearDown(self):
        httpx.delete(
            f"{SUPABASE_URL}/rest/v1/PADRON_PARCELAS",
            headers=_service_headers(),
            params={"ID_Parcela_Fija": f"eq.{self.parcela_id}"},
            timeout=30,
        )
        httpx.delete(
            f"{SUPABASE_URL}/rest/v1/PADRON_SOCIOS",
            headers=_service_headers(),
            params={"ID_Socio": f"eq.{self.socio_id}"},
            timeout=30,
        )

    def test_tecnico_campo_blocked_on_padron_socios_update(self):
        """El bypass real confirmado en AI_STATE.md (2026-09-06) — cerrado."""
        res = httpx.patch(
            f"{SUPABASE_URL}/rest/v1/PADRON_SOCIOS",
            headers={**_session_headers(self.tecnico_token), "Content-Type": "application/json"},
            params={"ID_Socio": f"eq.{self.socio_id}"},
            json={"socio_nombre_completo": "NO DEBERIA GUARDARSE"},
            timeout=30,
        )
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json().get("code"), "42501")

    def test_admin_allowed_on_padron_socios_update(self):
        res = httpx.patch(
            f"{SUPABASE_URL}/rest/v1/PADRON_SOCIOS",
            headers={**_session_headers(self.admin_token), "Content-Type": "application/json", "Prefer": "return=representation"},
            params={"ID_Socio": f"eq.{self.socio_id}"},
            json={"socio_nombre_completo": "Editado por admin"},
            timeout=30,
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()[0]["socio_nombre_completo"], "Editado por admin")

    def test_tecnico_campo_allowed_insert_padron_parcelas(self):
        """No debe romper el Editor Vectorial (gisActions.js::uploadGeoSpatialFeature
        -> createParcela) — INSERT permitido para cualquier authenticated."""
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PADRON_PARCELAS",
            headers={**_session_headers(self.tecnico_token), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={
                "ID_Parcela_Fija": self.parcela_id,
                "ID_Organizacion": ORG,
                "ID_Socio": self.socio_id,
                "parcela_codigo": "RBAC-TRIG-TEST",
                "hcp": 1,
                "activo": True,
            },
            timeout=30,
        )
        self.assertEqual(res.status_code, 201, res.text)

    def test_tecnico_campo_blocked_on_padron_parcelas_update(self):
        self._insert_test_parcela()
        res = httpx.patch(
            f"{SUPABASE_URL}/rest/v1/PADRON_PARCELAS",
            headers={**_session_headers(self.tecnico_token), "Content-Type": "application/json"},
            params={"ID_Parcela_Fija": f"eq.{self.parcela_id}"},
            json={"parcela_codigo": "NO DEBERIA GUARDARSE"},
            timeout=30,
        )
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json().get("code"), "42501")

    def test_tecnico_campo_blocked_on_padron_parcelas_delete(self):
        self._insert_test_parcela()
        res = httpx.delete(
            f"{SUPABASE_URL}/rest/v1/PADRON_PARCELAS",
            headers=_session_headers(self.tecnico_token),
            params={"ID_Parcela_Fija": f"eq.{self.parcela_id}"},
            timeout=30,
        )
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json().get("code"), "42501")

    def _insert_test_parcela(self):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PADRON_PARCELAS",
            headers={**_service_headers(), "Content-Type": "application/json"},
            json={
                "ID_Parcela_Fija": self.parcela_id,
                "ID_Organizacion": ORG,
                "ID_Socio": self.socio_id,
                "parcela_codigo": "RBAC-TRIG-TEST",
                "hcp": 1,
                "activo": True,
            },
            timeout=30,
        )
        res.raise_for_status()


if __name__ == "__main__":
    unittest.main(verbosity=2)
