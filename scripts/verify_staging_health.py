"""
Verificador de salud de infraestructura para RYZOS Staging / Supabase Live.
Comprueba variables de entorno, conectividad Supabase y existencia de buckets privados.

Uso:
    python scripts/verify_staging_health.py
"""

import os
import sys

REQUIRED_ENV_VARS = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
]

REQUIRED_BUCKETS = [
    "evidencias_eudr",
    "evidence-photos",
    "dossier-pdfs",
]

OK = "OK"
MISSING = "PENDIENTE / FALTA EN ENTORNO"
WARN = "ADVERTENCIA"


class StagingHealthChecker:
    """Diagnóstico de entorno e infraestructura Supabase para RYZOS."""

    def check_environment_variables(self) -> dict[str, bool]:
        return {var: bool(os.environ.get(var)) for var in REQUIRED_ENV_VARS}

    def get_required_buckets(self) -> list[str]:
        return REQUIRED_BUCKETS

    def check_supabase_connectivity(self) -> dict[str, object]:
        """Verifica conectividad con Supabase y estado de los buckets privados."""
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

        if not url or not key:
            return {"connected": False, "reason": "Credenciales no disponibles", "buckets": {}}

        try:
            from supabase import create_client
            client = create_client(url, key)

            bucket_status: dict[str, str] = {}
            for name in REQUIRED_BUCKETS:
                try:
                    bucket = client.storage.get_bucket(name)
                    if bucket is not None:
                        is_private = not getattr(bucket, "public", True)
                        bucket_status[name] = OK if is_private else WARN + " (bucket público)"
                    else:
                        bucket_status[name] = MISSING
                except Exception:
                    bucket_status[name] = MISSING

            return {"connected": True, "buckets": bucket_status}

        except Exception as exc:
            return {"connected": False, "reason": str(exc), "buckets": {}}

    def run_report(self) -> bool:
        """Imprime el reporte completo y retorna True si todo está OK."""
        print("=" * 55)
        print("  CHEQUEO DE SALUD — RYZOS STAGING / SUPABASE LIVE")
        print("=" * 55)

        all_ok = True

        # 1. Variables de entorno
        print("\n[1] Variables de Entorno:")
        env = self.check_environment_variables()
        for var, present in env.items():
            status = OK if present else MISSING
            print(f"    {var}: {status}")
            if not present:
                all_ok = False

        # 2. Buckets requeridos (estáticos)
        print("\n[2] Buckets de Almacenamiento Requeridos:")
        for bucket in self.get_required_buckets():
            print(f"    {bucket}: (requiere Supabase live para verificar)")

        # 3. Conectividad Supabase (solo si credenciales disponibles)
        if all(env.values()):
            print("\n[3] Verificación Live de Supabase:")
            result = self.check_supabase_connectivity()
            if result["connected"]:
                print("    Conectividad: OK")
                for bucket, status in result.get("buckets", {}).items():
                    print(f"    Bucket '{bucket}': {status}")
                    if status != OK:
                        all_ok = False
            else:
                print(f"    Conectividad: FALLO — {result.get('reason', 'error desconocido')}")
                all_ok = False
        else:
            print("\n[3] Verificación Live de Supabase: OMITIDA (faltan credenciales)")

        print("\n" + "=" * 55)
        overall = "LISTA PARA DESPLIEGUE" if all_ok else "ACCIONES REQUERIDAS ANTES DEL DESPLIEGUE"
        print(f"  RESULTADO: {overall}")
        print("=" * 55)
        return all_ok


if __name__ == "__main__":
    checker = StagingHealthChecker()
    ok = checker.run_report()
    sys.exit(0 if ok else 1)
