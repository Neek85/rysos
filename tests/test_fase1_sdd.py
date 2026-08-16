"""
Tests de aceptación para Fase 1 — RLS Multi-Tenant + Supabase Storage.
Requieren conexión a Supabase Live.
Se omiten automáticamente (pytest.skip) cuando las credenciales no están disponibles.
"""

import os
import unittest

import pytest

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

NEEDS_SUPABASE = pytest.mark.skipif(
    not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY,
    reason="SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configuradas — test requiere Supabase Live",
)


@NEEDS_SUPABASE
class TestFase1AcceptanceCriteria(unittest.TestCase):
    def setUp(self):
        from supabase import create_client
        self.supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    def test_view_only_returns_approved_records(self):
        """AC1: La vista view_eudr_dashboard_aprobados no retorna filas no aprobadas."""
        res = self.supabase.table("view_eudr_dashboard_aprobados").select("*").execute()
        invalid = [r for r in res.data if r.get("estado_revision") != "APROBADO"]
        self.assertEqual(len(invalid), 0, f"{len(invalid)} filas no aprobadas encontradas")

    def test_evidencias_bucket_is_private(self):
        """AC2: El bucket evidencias_eudr existe y es privado."""
        bucket = self.supabase.storage.get_bucket("evidencias_eudr")
        self.assertIsNotNone(bucket, "El bucket 'evidencias_eudr' no existe")
        self.assertFalse(bucket.public, "El bucket 'evidencias_eudr' es público — debe ser privado")


if __name__ == "__main__":
    unittest.main(verbosity=2)
