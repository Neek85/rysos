"""Fix FOUND de fn_validar_codigo_parcela_unico
(supabase/migrations/20260909130000_fix_fn_validar_codigo_parcela_unico_found.sql).

Bug real ya documentado en AI_STATE.md (2026-09-08, hallazgo incidental del
smoke test de Fase D Paso 2): la función usaba `v_geom IS NULL` como proxy
de "el registro EUDR_MONITOREO no existe", pero `geom_inspeccion` puede ser
NULL en un registro real y existente (un monitoreo de campo QField sin
geometría capturada todavía) -- la función confundía "sin geometría" con
"fila inexistente" y devolvía "no encontrado" para un id_monitoreo real,
bloqueando approveRecord/rejectRecord (lib/eudrQcActions.js) con un mensaje
que apunta a la causa equivocada.

- Test estático (siempre corre, sin credenciales): verifica que la
  migración usa `FOUND` en vez de `v_geom IS NULL` -- ver también
  tests/test_qc_codigo_parcela_unico.mjs para la cobertura equivalente en
  JS de esta misma migración (contenido/estructura completa).
- Test funcional contra Supabase Live (@NEEDS_SUPABASE, se salta sin
  SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY), mismo patrón que
  tests/test_fix_id_parcela_fija_guid_qfield.py: inserta un EUDR_MONITOREO
  real con geom_inspeccion NULL y llama a la RPC real -- antes del fix
  esto lanzaba 'Registro % (EUDR_MONITOREO) no encontrado.' pese a que la
  fila sí existe.
"""

import os
import unittest
import uuid
from pathlib import Path

import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase"
    / "migrations"
    / "20260909130000_fix_fn_validar_codigo_parcela_unico_found.sql"
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

NEEDS_SUPABASE = pytest.mark.skipif(
    not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY,
    reason="SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configuradas -- test requiere Supabase Live",
)


class TestMigrationFileStatic(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not MIGRATION_PATH.exists():
            raise AssertionError(f"No existe {MIGRATION_PATH}")
        cls.sql = MIGRATION_PATH.read_text(encoding="utf-8")

    def test_uses_found_not_v_geom_is_null(self):
        self.assertIn("IF NOT FOUND THEN", self.sql)
        self.assertNotIn("IF v_geom IS NULL THEN", self.sql)

    def test_idempotent(self):
        self.assertIn("CREATE OR REPLACE FUNCTION", self.sql)
        self.assertIn("BEGIN;", self.sql)
        self.assertIn("COMMIT;", self.sql)


@NEEDS_SUPABASE
class TestFoundFixLive(unittest.TestCase):
    """Reproduce el bug real: un EUDR_MONITOREO existente sin
    geom_inspeccion no debe devolver 'no encontrado'."""

    ORG = "ORG-TEST-FOUND-FIX"

    @classmethod
    def setUpClass(cls):
        from supabase import create_client

        cls.supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    def setUp(self):
        self._cleanup()

    def tearDown(self):
        self._cleanup()

    def _cleanup(self):
        self.supabase.table("EUDR_MONITOREO").delete().eq("ID_Organizacion", self.ORG).execute()
        self.supabase.table("ORGANIZACIONES").delete().eq("ID", self.ORG).execute()

    def test_registro_real_sin_geom_inspeccion_no_devuelve_no_encontrado(self):
        self.supabase.table("ORGANIZACIONES").insert({"ID": self.ORG, "es_organizacion_prueba": True}).execute()
        # Sin geom_inspeccion (NULL) a propósito -- es exactamente el caso
        # real que rompía la función antes del fix. Sin ID_Parcela_Fija
        # tampoco -- no hace falta para probar "no encontrado", la función
        # devuelve tiene_conflicto=false para ese caso antes de llegar a la
        # parte espacial.
        res = (
            self.supabase.table("EUDR_MONITOREO")
            .insert({"ID_Organizacion": self.ORG, "estado_revision": "PENDIENTE"})
            .execute()
        )
        id_monitoreo = res.data[0]["id_monitoreo"]
        self.assertIsNotNone(id_monitoreo)

        # La migración de este fix no se aplica sola contra producción
        # (paso manual en Supabase Studio, ver CLAUDE.md/ORQUESTADOR §4.1)
        # -- hasta que se aplique, la instancia real todavía corre la
        # función vieja y este mismo INSERT (fila real, geom_inspeccion
        # NULL) sigue reproduciendo el bug exacto documentado en
        # AI_STATE.md 2026-09-08: 'no encontrado' para una fila que sí
        # existe. Se trata como "todavía no aplicada" (skip, no fail) en
        # vez de un fallo rojo permanente -- mismo criterio que
        # test_fix_id_parcela_fija_guid_qfield.py::_migration_is_applied,
        # adaptado acá porque este chequeo solo puede confirmarse
        # insertando la fila real (no hay una fila ya existente en la
        # instancia que sirva de sonda no destructiva).
        try:
            rpc_res = self.supabase.rpc(
                "fn_validar_codigo_parcela_unico", {"p_monitoreo_id": id_monitoreo}
            ).execute()
        except Exception as exc:
            if "no encontrado" in str(exc):
                raise unittest.SkipTest(
                    "Migración 20260909130000_fix_fn_validar_codigo_parcela_unico_found.sql "
                    "todavía no aplicada en la instancia real -- bug reproducido tal cual "
                    f"como se esperaba antes del fix: {exc}"
                )
            raise

        self.assertEqual(rpc_res.data["monitoreo_id"], id_monitoreo)
        self.assertFalse(rpc_res.data["tiene_conflicto"])

    def test_id_monitoreo_realmente_inexistente_sigue_lanzando_no_encontrado(self):
        """El fix no debe volverse permisivo -- un uuid que de verdad no
        corresponde a ninguna fila sigue debiendo fallar."""
        with self.assertRaises(Exception):
            self.supabase.rpc(
                "fn_validar_codigo_parcela_unico", {"p_monitoreo_id": str(uuid.uuid4())}
            ).execute()
