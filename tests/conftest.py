"""
Infraestructura de tests, no código de producción: carga las 3 credenciales
de Supabase que los tests en vivo (`@NEEDS_SUPABASE` en cada
`tests/test_*.py`) esperan como `SUPABASE_URL`/`SUPABASE_ANON_KEY`/
`SUPABASE_SERVICE_ROLE_KEY` vía `os.getenv(...)`.

`.env.local` (real, ya con los 3 valores, nunca commiteado -- ver
`.gitignore`) usa el prefijo `NEXT_PUBLIC_` en las dos primeras porque ese
archivo existe para exponerlas al cliente Next.js, no para los tests.
Ningún `conftest.py`/dotenv-loading existía antes de este archivo -- las
corridas "en vivo" anteriores de esta sesión dependían de un `export`
manual en una terminal que ya no está activa (confirmado: no hay ningún
otro mecanismo en el repo, ver AI_STATE.md).

`load_dotenv()` nunca sobreescribe una variable ya presente en el entorno
(su default es `override=False`) -- en CI (`.github/workflows/test_and_deploy.yml`),
donde `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` llegan como GitHub Secrets
reales y no existe ningún `.env.local`, este archivo es un no-op seguro.
"""

import os
from pathlib import Path

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")
except ImportError:
    pass

if not os.getenv("SUPABASE_URL") and os.getenv("NEXT_PUBLIC_SUPABASE_URL"):
    os.environ["SUPABASE_URL"] = os.environ["NEXT_PUBLIC_SUPABASE_URL"]

if not os.getenv("SUPABASE_ANON_KEY") and os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY"):
    os.environ["SUPABASE_ANON_KEY"] = os.environ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]

# SUPABASE_SERVICE_ROLE_KEY no necesita fallback -- .env.local ya lo
# define sin prefijo, mismo nombre que espera os.getenv() en los tests.
