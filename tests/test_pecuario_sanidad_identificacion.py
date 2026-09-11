"""
Test de integración para v2 (sanidad recurrente + insumos) y v3
(identificación individual) del módulo Pecuario Cuyes.

Ver supabase/migrations/20260911090000_pecuario_sanidad_insumos.sql (v2 —
reconstruida a posteriori, ver su propio encabezado) y
supabase/migrations/20260911140000_pecuario_identificacion_individual.sql
(v3), specs/pecuario_identificacion_individual.md.

A diferencia de tests/test_pecuario_cuyes_core.py (donde la migración
todavía no estaba aplicada al escribirse), v2 y v3 SÍ están aplicadas
contra jhtocgxlozfuzullrtol al momento de escribir este archivo — los
tests NEEDS_SUPABASE corren de verdad, no se saltan, cuando hay
credenciales disponibles.

Se omiten automáticamente (pytest.skip) cuando las credenciales no están
disponibles, y con un skip explícito si alguna de las dos migraciones no
está aplicada (mismo patrón _migration_is_applied que el resto del repo).
"""

import os
import re
import time
import unittest
from pathlib import Path

import httpx
import pytest

V2_MIGRATION_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase" / "migrations" / "20260911090000_pecuario_sanidad_insumos.sql"
)
V3_MIGRATION_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase" / "migrations" / "20260911140000_pecuario_identificacion_individual.sql"
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


def _v2_applied():
    try:
        res = httpx.get(f"{SUPABASE_URL}/rest/v1/PECUARIO_GALPONES", headers=_service_headers(), params={"limit": 1}, timeout=15)
    except Exception:
        return False
    return res.status_code == 200


def _v3_applied():
    try:
        res = httpx.get(f"{SUPABASE_URL}/rest/v1/PECUARIO_REPRODUCTORES", headers=_service_headers(), params={"limit": 1}, timeout=15)
    except Exception:
        return False
    return res.status_code == 200


class TestV2MigrationFileStatic(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not V2_MIGRATION_PATH.exists():
            raise AssertionError(f"No existe {V2_MIGRATION_PATH}")
        cls.sql = V2_MIGRATION_PATH.read_text(encoding="utf-8")

    def test_creates_all_5_tables(self):
        for table in ("PECUARIO_GALPONES", "PECUARIO_CONTROL_SANITARIO", "PECUARIO_LIMPIEZA_GALPON", "PECUARIO_INSUMOS", "PECUARIO_INSUMOS_MOVIMIENTOS"):
            with self.subTest(table=table):
                self.assertIn(f'CREATE TABLE IF NOT EXISTS public."{table}"', self.sql)

    def test_all_5_tables_have_rls(self):
        self.assertEqual(self.sql.count("ENABLE ROW LEVEL SECURITY"), 5)
        self.assertEqual(self.sql.count("TO authenticated"), 5)

    def test_closes_v1_galpon_fk_gap(self):
        self.assertIn("fk_pecuario_jaulas_galpon", self.sql)


class TestV3MigrationFileStatic(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not V3_MIGRATION_PATH.exists():
            raise AssertionError(f"No existe {V3_MIGRATION_PATH}")
        cls.sql = V3_MIGRATION_PATH.read_text(encoding="utf-8")

    def test_preflight_requires_v2(self):
        self.assertIn("PECUARIO_GALPONES", self.sql)
        self.assertIn("RAISE EXCEPTION", self.sql)

    def test_creates_reproductores_historial_tratamientos(self):
        for table in ("PECUARIO_REPRODUCTORES", "PECUARIO_HISTORIAL_MACHOS", "PECUARIO_TRATAMIENTOS"):
            with self.subTest(table=table):
                self.assertIn(f'CREATE TABLE IF NOT EXISTS public."{table}"', self.sql)

    def test_xor_checks_present(self):
        self.assertIn("chk_mortalidad_individual_xor_poblacional", self.sql)
        self.assertIn("chk_ventas_individual_xor_lote", self.sql)
        self.assertIn("chk_tratamientos_alcance_target", self.sql)

    def test_corrected_triggers_present(self):
        self.assertIn("fn_dar_baja_animal_por_mortalidad", self.sql)
        self.assertIn("fn_dar_baja_animal_por_venta", self.sql)
        self.assertIn("fn_cerrar_historial_macho_anterior", self.sql)
        self.assertIn("fn_descontar_insumo_tratamiento", self.sql)


@NEEDS_SUPABASE
class TestV2V3Live(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not _v2_applied():
            raise unittest.SkipTest("v2 (20260911090000_pecuario_sanidad_insumos.sql) no está aplicada todavía.")
        if not _v3_applied():
            raise unittest.SkipTest("v3 (20260911140000_pecuario_identificacion_individual.sql) no está aplicada todavía.")
        cls.admin_token = _magic_link_access_token(ADMIN_EMAIL)

    def setUp(self):
        self.suffix = str(int(time.time() * 1000))
        self._jaulas = []
        self._galpones = []
        self._reproductores = []
        self._insumos = []
        self._cleanup_simple = []  # list of (table, id_field, id_value)

    def tearDown(self):
        for table, field, value in reversed(self._cleanup_simple):
            httpx.delete(f"{SUPABASE_URL}/rest/v1/{table}", headers=_service_headers(), params={field: f"eq.{value}"}, timeout=30)
        for rid in self._reproductores:
            httpx.delete(f"{SUPABASE_URL}/rest/v1/PECUARIO_REPRODUCTORES", headers=_service_headers(), params={"id": f"eq.{rid}"}, timeout=30)
        for jid in self._jaulas:
            httpx.delete(f"{SUPABASE_URL}/rest/v1/PECUARIO_JAULAS", headers=_service_headers(), params={"id": f"eq.{jid}"}, timeout=30)
        for gid in self._galpones:
            httpx.delete(f"{SUPABASE_URL}/rest/v1/PECUARIO_GALPONES", headers=_service_headers(), params={"id": f"eq.{gid}"}, timeout=30)
        for iid in self._insumos:
            httpx.delete(f"{SUPABASE_URL}/rest/v1/PECUARIO_INSUMOS", headers=_service_headers(), params={"id": f"eq.{iid}"}, timeout=30)

    def _crear_jaula(self, org=ORG_A):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_JAULAS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": org, "codigo_poza": f"TEST-V2V3-{self.suffix}-{len(self._jaulas)}"},
            timeout=30,
        )
        res.raise_for_status()
        jid = res.json()[0]["id"]
        self._jaulas.append(jid)
        return jid

    def _crear_reproductor(self, sexo="hembra", org=ORG_A):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_REPRODUCTORES",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": org, "codigo_arete": f"TEST-{sexo[:1].upper()}-{self.suffix}-{len(self._reproductores)}", "sexo": sexo},
            timeout=30,
        )
        res.raise_for_status()
        rid = res.json()[0]["id"]
        self._reproductores.append(rid)
        return rid

    def test_reproductor_authenticated_session_can_write_own_org(self):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_REPRODUCTORES",
            headers={**_session_headers(self.admin_token), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": ORG_A, "codigo_arete": f"TEST-SESSION-{self.suffix}", "sexo": "hembra"},
            timeout=30,
        )
        self.assertEqual(res.status_code, 201, res.text)
        self._reproductores.append(res.json()[0]["id"])

    def test_reproductores_cross_org_read_isolation(self):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_REPRODUCTORES",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": ORG_B, "codigo_arete": f"TEST-CROSSORG-{self.suffix}", "sexo": "macho"},
            timeout=30,
        )
        res.raise_for_status()
        seeded_id = res.json()[0]["id"]
        self._reproductores.append(seeded_id)

        read = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_REPRODUCTORES",
            headers=_session_headers(self.admin_token),
            params={"id": f"eq.{seeded_id}"},
            timeout=30,
        )
        self.assertEqual(read.status_code, 200)
        self.assertEqual(read.json(), [])

    def test_historial_macho_auto_closes_previous_open_record(self):
        jaula = self._crear_jaula()
        macho1 = self._crear_reproductor(sexo="macho")
        macho2 = self._crear_reproductor(sexo="macho")

        h1 = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_HISTORIAL_MACHOS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": ORG_A, "macho_id": macho1, "jaula_id": jaula, "fecha_entrada": "2026-01-01"},
            timeout=30,
        )
        h1.raise_for_status()
        h1_id = h1.json()[0]["id"]
        self._cleanup_simple.append(("PECUARIO_HISTORIAL_MACHOS", "id", h1_id))
        self.assertIsNone(h1.json()[0]["fecha_salida"])

        h2 = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_HISTORIAL_MACHOS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": ORG_A, "macho_id": macho2, "jaula_id": jaula, "fecha_entrada": "2026-02-01"},
            timeout=30,
        )
        h2.raise_for_status()
        h2_id = h2.json()[0]["id"]
        self._cleanup_simple.append(("PECUARIO_HISTORIAL_MACHOS", "id", h2_id))
        self.assertIsNone(h2.json()[0]["fecha_salida"], "El registro nuevo debe quedar abierto")

        # Releer h1 -- el trigger debe haberlo cerrado automáticamente
        reread = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_HISTORIAL_MACHOS",
            headers=_service_headers(),
            params={"id": f"eq.{h1_id}"},
            timeout=30,
        )
        reread.raise_for_status()
        self.assertEqual(reread.json()[0]["fecha_salida"], "2026-02-01", "trg_cerrar_historial_macho_anterior debe cerrar el registro previo")

    def test_mortalidad_trigger_marca_animal_muerto(self):
        animal = self._crear_reproductor(sexo="hembra")
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_MORTALIDAD",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": ORG_A, "animal_id": animal, "fecha_evento": "2026-03-01", "cantidad": 1, "etapa": "reproductor"},
            timeout=30,
        )
        self.assertEqual(res.status_code, 201, res.text)
        self._cleanup_simple.append(("PECUARIO_MORTALIDAD", "id", res.json()[0]["id"]))

        reread = httpx.get(f"{SUPABASE_URL}/rest/v1/PECUARIO_REPRODUCTORES", headers=_service_headers(), params={"id": f"eq.{animal}"}, timeout=30)
        reread.raise_for_status()
        row = reread.json()[0]
        self.assertEqual(row["estado"], "muerto", "fn_dar_baja_animal_por_mortalidad debe marcar estado=muerto (bug del app donante: marcaba 'Vendido')")
        self.assertEqual(row["fecha_salida"], "2026-03-01")
        self.assertIsNone(row["jaula_actual_id"])

    def test_venta_trigger_marca_animal_vendido(self):
        animal = self._crear_reproductor(sexo="macho")
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_VENTAS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": ORG_A, "animal_id": animal, "fecha_venta": "2026-03-05", "cantidad": 1, "precio_total": 25.0},
            timeout=30,
        )
        self.assertEqual(res.status_code, 201, res.text)
        self._cleanup_simple.append(("PECUARIO_VENTAS", "id", res.json()[0]["id"]))

        reread = httpx.get(f"{SUPABASE_URL}/rest/v1/PECUARIO_REPRODUCTORES", headers=_service_headers(), params={"id": f"eq.{animal}"}, timeout=30)
        reread.raise_for_status()
        row = reread.json()[0]
        self.assertEqual(row["estado"], "vendido")
        self.assertEqual(row["fecha_salida"], "2026-03-05")

    def test_mortalidad_check_rejects_animal_id_and_lote_id_together(self):
        animal = self._crear_reproductor(sexo="hembra")
        jaula = self._crear_jaula()
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_MORTALIDAD",
            headers={**_service_headers(), "Content-Type": "application/json"},
            json={"ID_Organizacion": ORG_A, "animal_id": animal, "poza_id": jaula, "fecha_evento": "2026-03-01", "cantidad": 1, "etapa": "reproductor"},
            timeout=30,
        )
        self.assertEqual(res.status_code, 400, res.text)
        self.assertEqual(res.json().get("code"), "23514")

    def test_mortalidad_check_rejects_neither_animal_nor_lote(self):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_MORTALIDAD",
            headers={**_service_headers(), "Content-Type": "application/json"},
            json={"ID_Organizacion": ORG_A, "fecha_evento": "2026-03-01", "cantidad": 1, "etapa": "reproductor"},
            timeout=30,
        )
        self.assertEqual(res.status_code, 400, res.text)
        self.assertEqual(res.json().get("code"), "23514")

    def test_tratamiento_descuenta_insumo_del_kardex(self):
        insumo = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_INSUMOS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={"ID_Organizacion": ORG_A, "nombre": f"Ivermectina TEST {self.suffix}", "categoria": "sanitario", "unidad_medida": "ml"},
            timeout=30,
        )
        insumo.raise_for_status()
        insumo_id = insumo.json()[0]["id"]
        self._insumos.append(insumo_id)

        animal = self._crear_reproductor(sexo="hembra")
        trat = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_TRATAMIENTOS",
            headers={**_service_headers(), "Content-Type": "application/json", "Prefer": "return=representation"},
            json={
                "ID_Organizacion": ORG_A, "alcance": "individual", "animal_id": animal,
                "fecha": "2026-03-10", "tipo_tratamiento": "curativo",
                "insumo_id": insumo_id, "cantidad_dosis": 2.5,
            },
            timeout=30,
        )
        self.assertEqual(trat.status_code, 201, trat.text)
        self._cleanup_simple.append(("PECUARIO_TRATAMIENTOS", "id", trat.json()[0]["id"]))

        movs = httpx.get(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_INSUMOS_MOVIMIENTOS",
            headers=_service_headers(),
            params={"insumo_id": f"eq.{insumo_id}"},
            timeout=30,
        )
        movs.raise_for_status()
        rows = movs.json()
        self.assertEqual(len(rows), 1, "fn_descontar_insumo_tratamiento debe insertar exactamente 1 movimiento")
        self._cleanup_simple.append(("PECUARIO_INSUMOS_MOVIMIENTOS", "id", rows[0]["id"]))
        self.assertEqual(rows[0]["tipo_movimiento"], "salida")
        self.assertEqual(float(rows[0]["cantidad"]), 2.5)

    def test_tratamiento_check_rejects_alcance_target_mismatch(self):
        res = httpx.post(
            f"{SUPABASE_URL}/rest/v1/PECUARIO_TRATAMIENTOS",
            headers={**_service_headers(), "Content-Type": "application/json"},
            json={"ID_Organizacion": ORG_A, "alcance": "individual", "fecha": "2026-03-10", "tipo_tratamiento": "preventivo"},
            timeout=30,
        )
        self.assertEqual(res.status_code, 400, res.text)
        self.assertEqual(res.json().get("code"), "23514")


if __name__ == "__main__":
    unittest.main(verbosity=2)
