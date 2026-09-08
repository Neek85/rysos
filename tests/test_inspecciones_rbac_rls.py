"""
Test de integración para fn_enforce_inspecciones_role (ver
supabase/migrations/20260908150000_enforce_inspecciones_role_trigger.sql,
AI_STATE.md 2026-09-08, specs/smoke_test_fase_d_paso2.md). Mismo patrón
NEEDS_SUPABASE que tests/test_padron_rbac_rls.py -- sesión real
(magic link) para simular admin/tecnico_campo/auditor_qc.

Cierra el gap confirmado en vivo durante el smoke test formal de Fase D
Paso 2: saveInspeccion (lib/inspeccionesActions.js) no tenía ningún
chequeo de rol -- el RLS real de INSPECCIONES/CAP_* (ADR-033) solo exige
organización, nunca rol. auditor_qc (matriz de permisos,
specs/login_real_organizacion_rol.md §5: "Solo lectura") pudo crear una
inspección real sin ningún bloqueo antes de este trigger.

Se omiten automáticamente (pytest.skip) cuando las credenciales no están
disponibles.
"""

import os
import time
import unittest
import uuid

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
ADMIN_EMAIL = "admin-demo@ryzos-demo.test"
TECNICO_EMAIL = "tecnico-campo-demo@ryzos-demo.test"
AUDITOR_EMAIL = "auditor-qc-demo@ryzos-demo.test"

EMPTY_CAP = {}


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


def _save_inspeccion(access_token, inspector_marker):
    """Mismo RPC que lib/inspeccionesActions.js::saveInspeccion invoca --
    SECURITY INVOKER, así que el trigger nuevo corre con el rol real de la
    sesión que llama, sea vía la Server Action de JS o este POST directo."""
    return httpx.post(
        f"{SUPABASE_URL}/rest/v1/rpc/fn_guardar_inspeccion_completa",
        headers={**_session_headers(access_token), "Content-Type": "application/json"},
        json={
            "p_id": None,
            "p_organizacion": ORG,
            "p_existing_organizacion": None,
            "p_inspeccion": {"Inspector": inspector_marker, "Estado": "En Proceso"},
            "p_socio": EMPTY_CAP,
            "p_mic": EMPTY_CAP,
            "p_conservacion": EMPTY_CAP,
            "p_bienestar": EMPTY_CAP,
            "p_riesgos": EMPTY_CAP,
            "p_gestion": EMPTY_CAP,
        },
        timeout=30,
    )


@NEEDS_SUPABASE
class TestInspeccionesRoleTrigger(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Sesiones una sola vez para toda la clase (no por test) -- 6 tests x
        # 3 magic links por setUp anterior disparaba el rate limit de OTP de
        # Supabase (429). Los tokens no se consumen ni expiran entre tests
        # (misma sesión válida durante toda la corrida).
        cls.admin_token = _magic_link_access_token(ADMIN_EMAIL)
        cls.tecnico_token = _magic_link_access_token(TECNICO_EMAIL)
        cls.auditor_token = _magic_link_access_token(AUDITOR_EMAIL)

    def setUp(self):
        self.suffix = str(int(time.time() * 1000))
        self.admin_token = self.__class__.admin_token
        self.tecnico_token = self.__class__.tecnico_token
        self.auditor_token = self.__class__.auditor_token
        self._created_ids = []

    def tearDown(self):
        for id_inspeccion in self._created_ids:
            for cap in (
                "CAP_DATOS_SOCIO",
                "CAP_MIC",
                "CAP_CONSERVACION",
                "CAP_BIENESTAR",
                "CAP_RIESGOS",
                "CAP_GESTION",
            ):
                httpx.delete(
                    f"{SUPABASE_URL}/rest/v1/{cap}",
                    headers=_service_headers(),
                    params={"ID_Inspeccion": f"eq.{id_inspeccion}"},
                    timeout=30,
                )
            httpx.delete(
                f"{SUPABASE_URL}/rest/v1/INSPECCIONES",
                headers=_service_headers(),
                params={"ID_Inspeccion": f"eq.{id_inspeccion}"},
                timeout=30,
            )

    def test_admin_allowed_to_write_inspeccion(self):
        res = _save_inspeccion(self.admin_token, f"TEST-RBAC-INSP-ADMIN-{self.suffix}")
        self.assertEqual(res.status_code, 200, res.text)
        self._created_ids.append(res.json()["id"])

    def test_tecnico_campo_allowed_to_write_inspeccion(self):
        res = _save_inspeccion(self.tecnico_token, f"TEST-RBAC-INSP-TECNICO-{self.suffix}")
        self.assertEqual(res.status_code, 200, res.text)
        self._created_ids.append(res.json()["id"])

    def test_auditor_qc_blocked_on_write_inspeccion(self):
        """El bypass real confirmado en vivo (AI_STATE.md, 2026-09-08) — cerrado."""
        res = _save_inspeccion(self.auditor_token, f"TEST-RBAC-INSP-AUDITOR-{self.suffix}")
        self.assertIn(res.status_code, (400, 403))
        # PostgREST envuelve la excepción de la función RPC -- el código
        # real (42501) viaja en el body, no siempre como status HTTP 403
        # puro para llamadas rpc/.
        self.assertEqual(res.json().get("code"), "42501")

    def _create_inspeccion_with_cap_mic(self, marker):
        """Fila descartable creada directo por REST (Service Role Key,
        bypasea el trigger de rol -- setup, no parte del test) para poder
        probar un DELETE directo contra CAP_MIC sin pasar por saveInspeccion."""
        id_inspeccion = str(uuid.uuid4())
        ins = httpx.post(
            f"{SUPABASE_URL}/rest/v1/INSPECCIONES",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={
                "ID_Inspeccion": id_inspeccion,
                "ID_Organizacion": ORG,
                "Inspector": marker,
                "Estado": "En Proceso",
            },
            timeout=30,
        )
        ins.raise_for_status()
        self._created_ids.append(id_inspeccion)

        cap = httpx.post(
            f"{SUPABASE_URL}/rest/v1/CAP_MIC",
            headers={**_service_headers(), "Content-Type": "application/json"},
            json={"ID_Cap_MIC": str(uuid.uuid4()), "ID_Inspeccion": id_inspeccion, "semilla_propia": "Si"},
            timeout=30,
        )
        cap.raise_for_status()
        return id_inspeccion

    def test_auditor_qc_blocked_on_direct_delete_cap_mic(self):
        """Cierra el mismo tipo de bypass que motivó todo este fix, esta vez
        vía DELETE directo (no INSERT/UPDATE vía saveInspeccion) -- el
        trigger original (borrador previo a esta revisión) no cubría
        DELETE, así que este caso habría pasado (200) antes del fix."""
        id_inspeccion = self._create_inspeccion_with_cap_mic(f"TEST-RBAC-INSP-DELCAP-{self.suffix}")
        res = httpx.delete(
            f"{SUPABASE_URL}/rest/v1/CAP_MIC",
            headers=_session_headers(self.auditor_token),
            params={"ID_Inspeccion": f"eq.{id_inspeccion}"},
            timeout=30,
        )
        self.assertIn(res.status_code, (400, 403))
        self.assertEqual(res.json().get("code"), "42501")

    def test_admin_allowed_on_direct_delete_cap_mic(self):
        """Regresión del branch TG_OP = 'DELETE' -> RETURN OLD: sin él, un
        RETURN NEW incondicional (NEW es NULL en DELETE) habría cancelado
        en silencio este DELETE también para un rol permitido."""
        id_inspeccion = self._create_inspeccion_with_cap_mic(f"TEST-RBAC-INSP-DELCAP-ADMIN-{self.suffix}")
        res = httpx.delete(
            f"{SUPABASE_URL}/rest/v1/CAP_MIC",
            headers={**_session_headers(self.admin_token), "Prefer": "return=representation"},
            params={"ID_Inspeccion": f"eq.{id_inspeccion}"},
            timeout=30,
        )
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(len(res.json()), 1)

    def test_cross_org_isolation_still_intact(self):
        """No confundir con el chequeo de rol -- ADR-033 ya cubre esto,
        se repite acá como regresión mínima: admin de una organización no
        puede escribir en otra vía este mismo RPC."""
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/rpc/fn_guardar_inspeccion_completa",
            headers={**_session_headers(self.admin_token), "Content-Type": "application/json"},
            json={
                "p_id": None,
                "p_organizacion": "COOP-AROMAS-VALLE",
                "p_existing_organizacion": None,
                "p_inspeccion": {"Inspector": f"TEST-RBAC-INSP-CROSSORG-{self.suffix}", "Estado": "En Proceso"},
                "p_socio": EMPTY_CAP,
                "p_mic": EMPTY_CAP,
                "p_conservacion": EMPTY_CAP,
                "p_bienestar": EMPTY_CAP,
                "p_riesgos": EMPTY_CAP,
                "p_gestion": EMPTY_CAP,
            },
            timeout=30,
        )
        self.assertIn(res.status_code, (400, 403))
        if res.status_code != 200:
            self._created_ids += []  # nada que limpiar -- no debería haberse creado


if __name__ == "__main__":
    unittest.main(verbosity=2)
