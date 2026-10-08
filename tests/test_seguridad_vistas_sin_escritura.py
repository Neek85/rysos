"""
Test de catálogo permanente -- ADR-043: las vistas de `public` no aceptan
escritura de clientes y `USUARIOS_LOGIN` no tiene acceso de cliente.

Solo lee metadatos (pg_class / pg_depend / aclexplode) con
`supabase db query --linked` (ADR-042: lectura libre). NUNCA escribe y NUNCA
hace SELECT sobre USUARIOS / USUARIOS_LOGIN. Se omite (skip) si el CLI no está
instalado o el proyecto no está enlazado (p. ej. en CI, que no tiene
`supabase link`); localmente corre contra la base real.

Migraciones que lo ponen en verde (las aplica Neyser en Supabase Studio):
  supabase/migrations/20261008090000_seguridad_usuarios_login_sin_acceso_cliente.sql
  supabase/migrations/20261008091000_seguridad_vistas_sin_escritura_cliente.sql
Mientras NO estén aplicadas, los tests a. y b. fallan: es lo esperado y NO se
marcan xfail (el rojo es la señal de que falta aplicar o de que apareció una
vista nueva con permisos por defecto).
"""
import json
import re
import shutil
import subprocess
import time
import unittest
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
CLI = shutil.which("supabase")
LINKED = (ROOT / "supabase" / ".temp" / "project-ref").exists()

NEEDS_CLI = pytest.mark.skipif(
    not CLI or not LINKED,
    reason="requiere `supabase` CLI instalado y enlazado (supabase link): lectura de catálogos (ADR-042)",
)

NO_APLICADAS = "migraciones 20261008090000/091000 no aplicadas"
HINT_VISTA_NUEVA = "vista nueva con permisos por defecto: agrega REVOKE ... en una migración"

ESCRITURA = ("INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER")

# Vistas que la web (Next.js, sin sesión: llave anon) lee. Un REVOKE de SELECT o un
# security_invoker las rompería (el dashboard depende de que corran como postgres).
VISTAS_LEIDAS_POR_ANON = (
    "view_eudr_dashboard_aprobados",
    "vw_monitoreo_web",
    "vw_monitoreo_poligonos",
    "vw_monitoreo_puntos",
)


def _sql(consulta: str) -> list:
    """SELECT de solo lectura vía `supabase db query --linked`; reintenta el fallo transitorio de login."""
    ultimo = ""
    for _ in range(4):
        p = subprocess.run(
            [CLI, "db", "query", "--linked", consulta],
            capture_output=True, text=True, encoding="utf-8", cwd=ROOT, timeout=120,
        )
        salida = (p.stdout or "") + (p.stderr or "")
        ultimo = salida
        if "failed to initialise" in salida or "{" not in salida:
            time.sleep(3)
            continue
        cuerpo = salida[salida.index("{"): salida.rindex("}") + 1]
        return json.loads(re.sub(r",(\s*[\]}])", r"\1", cuerpo))["rows"]
    raise RuntimeError(f"supabase db query falló 4 veces: {ultimo[:300]}")


# Una fila por (vista, grantee, privilegio). grantee 0 = PUBLIC. Excluye vistas de extensiones.
SQL_PRIVS_VISTAS = """
SELECT c.relname AS vista,
       CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
       a.privilege_type AS priv
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(c.relacl) a
 WHERE n.nspname = 'public' AND c.relkind = 'v'
   AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
 ORDER BY 1, 2, 3
"""


@NEEDS_CLI
class TestSeguridadVistasSinEscritura(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.filas = _sql(SQL_PRIVS_VISTAS)
        cls.vistas = {r["vista"] for r in _sql(
            "SELECT c.relname AS vista FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND c.relkind = 'v' AND NOT EXISTS (SELECT 1 FROM pg_depend d "
            "WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')"
        )}
        cls.privs = {}  # (vista, grantee) -> {privilegios}
        for r in cls.filas:
            cls.privs.setdefault((r["vista"], r["grantee"]), set()).add(r["priv"])

    # a. ---------------------------------------------------------------
    def test_a_ninguna_vista_concede_escritura_a_clientes(self):
        malas = sorted(
            f"{vista}: {grantee} tiene {', '.join(sorted(p & set(ESCRITURA)))}"
            for (vista, grantee), p in self.privs.items()
            if grantee in ("anon", "authenticated", "PUBLIC") and p & set(ESCRITURA)
        )
        self.assertEqual(
            malas, [],
            f"{HINT_VISTA_NUEVA}. Si es todo el listado, {NO_APLICADAS}. Vistas: {malas}",
        )

    # b. ---------------------------------------------------------------
    def test_b_usuarios_login_sin_ningun_privilegio_de_cliente(self):
        self.assertIn("USUARIOS_LOGIN", self.vistas, "USUARIOS_LOGIN dejó de existir: revisar este test y el ADR-043")
        concedidos = sorted(
            f"{grantee}: {', '.join(sorted(p))}"
            for (vista, grantee), p in self.privs.items()
            if vista == "USUARIOS_LOGIN" and grantee in ("anon", "authenticated", "PUBLIC")
        )
        self.assertEqual(
            concedidos, [],
            f"{NO_APLICADAS}: USUARIOS_LOGIN sigue concediendo privilegios a clientes: {concedidos}",
        )

    # d. ---------------------------------------------------------------
    def test_d_vistas_leidas_por_la_web_con_anon_conservan_select(self):
        sin_select = [
            v for v in VISTAS_LEIDAS_POR_ANON
            if "SELECT" not in self.privs.get((v, "anon"), set())
        ]
        self.assertEqual(
            sin_select, [],
            f"anon perdió SELECT en vistas que la web lee con la llave anon (dashboard roto): {sin_select}",
        )

    def test_d_vistas_pecuario_conservan_select_para_authenticated(self):
        pecuario = sorted(v for v in self.vistas if v.startswith("vw_pecuario_"))
        self.assertGreaterEqual(len(pecuario), 19, f"se esperaban >= 19 vw_pecuario_*, hay {len(pecuario)}")
        sin_select = [
            v for v in pecuario
            if "SELECT" not in self.privs.get((v, "authenticated"), set())
        ]
        self.assertEqual(
            sin_select, [],
            f"authenticated perdió SELECT en vistas Pecuario que la app Expo lee con sesión: {sin_select}",
        )
