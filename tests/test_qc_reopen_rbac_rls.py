"""Test de integración para la reversión de un registro APROBADO a
PENDIENTE desde la Consola QC (specs/revertir_aprobado_a_qc.md).
Confirma en vivo, con sesiones reales (magic link, no Service Role Key),
lo que el spec documenta como ya verificado: el trigger existente
`fn_enforce_qc_approval_roles` (ADR-039) ya cubre este UPDATE porque
dispara en cualquier cambio real de estado_revision, sin importar la
dirección -- no hizo falta ninguna migración/política nueva para esto.

Mismo patrón NEEDS_SUPABASE que tests/test_padron_rbac_rls.py /
tests/test_inspecciones_rbac_rls.py -- se omite (pytest.skip)
automáticamente sin credenciales.
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
AUDITOR_EMAIL = "auditor-qc-demo@ryzos-demo.test"


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


def _service_headers():
    return {"apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"}


def _session_headers(access_token):
    return {"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {access_token}"}


@NEEDS_SUPABASE
class TestReopenQcRecordRbacRls(unittest.TestCase):
    def setUp(self):
        self.suffix = str(int(time.time() * 1000))
        self.other_org = f"ORG-TEST-REOPEN-OTRA-{self.suffix}"

    def tearDown(self):
        httpx.delete(f"{SUPABASE_URL}/rest/v1/EUDR_MONITOREO", headers=_service_headers(), params={"ID_Organizacion": f"eq.{ORG}", "ID_Socio": f"eq.PROBE-REOPEN-{self.suffix}"}, timeout=30)
        httpx.delete(f"{SUPABASE_URL}/rest/v1/EUDR_MONITOREO", headers=_service_headers(), params={"ID_Organizacion": f"eq.{self.other_org}"}, timeout=30)
        httpx.delete(f"{SUPABASE_URL}/rest/v1/ORGANIZACIONES", headers=_service_headers(), params={"ID": f"eq.{self.other_org}"}, timeout=30)

    def _crear_monitoreo_aprobado(self, organizacion):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/EUDR_MONITOREO",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": organizacion, "ID_Socio": f"PROBE-REOPEN-{self.suffix}", "estado_revision": "APROBADO"},
            timeout=30,
        )
        res.raise_for_status()
        return res.json()[0]["id_monitoreo"]

    def test_tecnico_campo_bloqueado_al_revertir(self):
        id_monitoreo = self._crear_monitoreo_aprobado(ORG)
        token = _magic_link_access_token(TECNICO_EMAIL)
        res = httpx.patch(
            f"{SUPABASE_URL}/rest/v1/EUDR_MONITOREO",
            headers={**_session_headers(token), "Content-Type": "application/json"},
            params={"id_monitoreo": f"eq.{id_monitoreo}"},
            json={"estado_revision": "PENDIENTE"},
            timeout=30,
        )
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json().get("code"), "42501")

    def test_auditor_qc_permitido_al_revertir(self):
        id_monitoreo = self._crear_monitoreo_aprobado(ORG)
        token = _magic_link_access_token(AUDITOR_EMAIL)
        res = httpx.patch(
            f"{SUPABASE_URL}/rest/v1/EUDR_MONITOREO",
            headers={**_session_headers(token), "Content-Type": "application/json", "Prefer": "return=representation"},
            params={"id_monitoreo": f"eq.{id_monitoreo}"},
            json={"estado_revision": "PENDIENTE"},
            timeout=30,
        )
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()[0]["estado_revision"], "PENDIENTE")

    def test_aislamiento_cruzado_organizacion(self):
        """Una sesión real de ORG-TEST-DEMO no puede revertir un registro
        de otra organización -- RLS filtra la fila en silencio (200, []),
        nunca la modifica, sin importar el rol."""
        httpx.post(
            f"{SUPABASE_URL}/rest/v1/ORGANIZACIONES",
            headers={**_service_headers(), "Content-Type": "application/json"},
            json={"ID": self.other_org, "es_organizacion_prueba": True},
            timeout=30,
        ).raise_for_status()
        id_monitoreo = self._crear_monitoreo_aprobado(self.other_org)

        token = _magic_link_access_token(AUDITOR_EMAIL)
        res = httpx.patch(
            f"{SUPABASE_URL}/rest/v1/EUDR_MONITOREO",
            headers={**_session_headers(token), "Content-Type": "application/json", "Prefer": "return=representation"},
            params={"id_monitoreo": f"eq.{id_monitoreo}"},
            json={"estado_revision": "PENDIENTE"},
            timeout=30,
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), [])

        chk = httpx.get(
            f"{SUPABASE_URL}/rest/v1/EUDR_MONITOREO",
            headers=_service_headers(),
            params={"id_monitoreo": f"eq.{id_monitoreo}", "select": "estado_revision"},
            timeout=30,
        )
        self.assertEqual(chk.json()[0]["estado_revision"], "APROBADO", "no debe haberse modificado")
