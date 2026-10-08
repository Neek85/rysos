"""
Test de catálogo permanente -- ADR-043 (addendum): tablas heredadas sin RLS, lectura
anónima sin lector y EXECUTE anónimo de 3 funciones.

Solo lee metadatos (pg_class / pg_policies / pg_proc / aclexplode) con
`supabase db query --linked` (ADR-042). NUNCA escribe y NUNCA lee filas de las tablas.
Se omite (skip) si el CLI no está instalado o enlazado (p. ej. CI).

Migraciones que ponen en verde a./b./d. (las aplica Neyser en Supabase Studio):
  supabase/migrations/20261008092000_seguridad_tablas_sin_rls_sin_acceso_cliente.sql
  supabase/migrations/20261008093000_seguridad_lectura_anon_y_funciones.sql
Mientras NO estén aplicadas, a./b./d. fallan con un mensaje de "migración no aplicada":
es lo esperado y NO se marcan xfail. c. protege contra cerrar de más antes de mover las
lecturas anon de lib/padronCsv.js (líneas 203 y 1409) a una Server Action.
"""
import json
import re
import shutil
import subprocess
import time
import unittest
import warnings
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
CLI = shutil.which("supabase")
LINKED = (ROOT / "supabase" / ".temp" / "project-ref").exists()

NEEDS_CLI = pytest.mark.skipif(
    not CLI or not LINKED,
    reason="requiere `supabase` CLI instalado y enlazado (supabase link): lectura de catálogos (ADR-042)",
)

MIG_TABLAS = "migración 20261008092000 no aplicada"
MIG_POLITICAS_FUNCIONES = "migración 20261008093000 no aplicada"

TABLAS_PROPIAS = ("CONFIGURACION_REPORTES_ORG", "MENU_APP", "METADATOS_CAMPOS")

POLITICAS_ANON_A_CERRAR = (
    ("AGENCIAS_CERTIFICADORAS", "rls_anon_select_agencias_certificadoras"),
    ("ORGANIZACION_CERTIFICACIONES", "rls_anon_select_organizacion_certificaciones"),
    ("ORGANIZACION_PRODUCTOS", "rls_anon_select_organizacion_productos"),
    ("PARCELA_CERTIFICACIONES", "rls_anon_select_parcela_certificaciones"),
)

# Tienen lector anon REAL en el código; cerrarlas antes de migrar la lectura rompe sin error.
POLITICAS_ANON_QUE_DEBEN_SEGUIR = (
    ("CERTIFICACIONES_CATALOGO", "rls_anon_select_certificaciones_catalogo"),   # lib/padronCsv.js:145,195
    ("PRODUCTOS", "rls_anon_select_productos"),                                  # ParcelaFormModal.jsx:194
    ("SOCIO_CERTIFICACIONES", "rls_anon_select_socio_certificaciones"),          # lib/padronCsv.js:203,1409
)

FUNCIONES = (
    "public.exportar_esquema_ryzos()",
    "public.fn_jaula_tiene_otro_macho_activo(uuid,uuid)",
    "public.fn_son_parientes(uuid,uuid,integer)",
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


def _lista_sql(nombres) -> str:
    return ", ".join("'" + n.replace("'", "''") + "'" for n in nombres)


@NEEDS_CLI
class TestSeguridadTablasFunciones(unittest.TestCase):
    # a. ---------------------------------------------------------------
    def test_a_tablas_propias_con_rls_y_sin_privilegios_de_cliente(self):
        filas = _sql(
            "SELECT c.relname AS tabla, c.relrowsecurity AS rls FROM pg_class c "
            f"WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ({_lista_sql(TABLAS_PROPIAS)})"
        )
        self.assertEqual({r["tabla"] for r in filas}, set(TABLAS_PROPIAS), "alguna de las 3 tablas dejó de existir: revisar este test y ADR-043")
        sin_rls = sorted(r["tabla"] for r in filas if not r["rls"])
        privs = _sql(
            "SELECT c.relname AS tabla, CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee, "
            "a.privilege_type AS priv FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a "
            f"WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ({_lista_sql(TABLAS_PROPIAS)})"
        )
        abiertos = sorted(
            f"{r['tabla']}: {r['grantee']} tiene {r['priv']}"
            for r in privs if r["grantee"] in ("anon", "authenticated", "PUBLIC")
        )
        self.assertEqual(
            (sin_rls, abiertos), ([], []),
            f"{MIG_TABLAS}. Sin RLS: {sin_rls}. Privilegios de cliente: {abiertos}",
        )

    # b. ---------------------------------------------------------------
    def test_b_politicas_anon_sin_lector_estan_en_false(self):
        filas = _sql(
            "SELECT tablename, policyname, qual FROM pg_policies WHERE schemaname = 'public' AND policyname IN ("
            + _lista_sql(p for _, p in POLITICAS_ANON_A_CERRAR) + ")"
        )
        por_nombre = {(r["tablename"], r["policyname"]): r["qual"] for r in filas}
        faltan = [t for t in POLITICAS_ANON_A_CERRAR if t not in por_nombre]
        self.assertEqual(faltan, [], f"políticas con nombre distinto o inexistentes (la migración las omitiría en silencio): {faltan}")
        abiertas = sorted(f"{t}.{p}: qual={q!r}" for (t, p), q in por_nombre.items() if q != "false")
        self.assertEqual(abiertas, [], f"{MIG_POLITICAS_FUNCIONES}: políticas anon aún abiertas: {abiertas}")

    # c. ---------------------------------------------------------------
    def test_c_lecturas_anon_con_lector_real_siguen_abiertas(self):
        filas = _sql(
            "SELECT tablename, policyname, cmd, roles::text AS roles, qual FROM pg_policies WHERE schemaname = 'public' AND policyname IN ("
            + _lista_sql(p for _, p in POLITICAS_ANON_QUE_DEBEN_SEGUIR) + ")"
        )
        vivas = {(r["tablename"], r["policyname"]): r for r in filas}
        cerradas = []
        for tabla, politica in POLITICAS_ANON_QUE_DEBEN_SEGUIR:
            r = vivas.get((tabla, politica))
            if r is None or r["cmd"] != "SELECT" or "anon" not in r["roles"] or r["qual"] == "false":
                cerradas.append(f"{tabla}.{politica}")
        self.assertEqual(
            cerradas, [],
            "se cerró de más la lectura anon antes de migrar sus lectores (lib/padronCsv.js:145,195,203,1409; "
            f"ParcelaFormModal.jsx:194): daría 0 filas SIN error: {cerradas}",
        )
        sin_privilegio = [
            t for t, _ in POLITICAS_ANON_QUE_DEBEN_SEGUIR
            if not _sql(f"SELECT has_table_privilege('anon', 'public.\"{t}\"'::regclass, 'SELECT') AS ok")[0]["ok"]
        ]
        self.assertEqual(sin_privilegio, [], f"anon perdió SELECT de tabla en: {sin_privilegio}")

    # d. ---------------------------------------------------------------
    def test_d_funciones_sin_execute_para_anon_ni_public(self):
        problemas = []
        for firma in FUNCIONES:
            r = _sql(
                f"SELECT to_regprocedure('{firma}') IS NOT NULL AS existe, "
                f"has_function_privilege('anon', to_regprocedure('{firma}'), 'EXECUTE') AS anon, "
                f"has_function_privilege('authenticated', to_regprocedure('{firma}'), 'EXECUTE') AS auth, "
                f"has_function_privilege('service_role', to_regprocedure('{firma}'), 'EXECUTE') AS srv, "
                f"COALESCE((SELECT bool_or(x.grantee = 0) FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x "
                f"WHERE p.oid = to_regprocedure('{firma}')), false) AS pub"
            )[0]
            if not r["existe"]:
                problemas.append(f"{firma}: no existe (¿se renombró? actualizar test y migración)")
                continue
            if r["anon"]:
                problemas.append(f"{firma}: anon tiene EXECUTE")
            if r["pub"]:
                problemas.append(f"{firma}: PUBLIC tiene EXECUTE")
            if not r["auth"]:
                problemas.append(f"{firma}: authenticated perdió EXECUTE (la app Expo la llama por rpc)")
            if not r["srv"]:
                problemas.append(f"{firma}: service_role perdió EXECUTE")
        self.assertEqual(problemas, [], f"{MIG_POLITICAS_FUNCIONES}: {problemas}")

    # e. ---------------------------------------------------------------
    def test_e_spatial_ref_sys_informa_sin_fallar(self):
        escrituras = ("INSERT", "UPDATE", "DELETE", "TRUNCATE")
        abiertas = []
        for rol in ("anon", "authenticated"):
            for priv in escrituras:
                ok = _sql(f"SELECT has_table_privilege('{rol}', 'public.spatial_ref_sys'::regclass, '{priv}') AS ok")[0]["ok"]
                if ok:
                    abiertas.append(f"{rol}:{priv}")
        if abiertas:
            warnings.warn(
                "pendiente: soporte de Supabase -- spatial_ref_sys (dueña supabase_admin) conserva escritura para "
                + ", ".join(abiertas),
                UserWarning,
            )
        # Lo que SÍ debe seguir: lectura (ST_Transform la necesita).
        sin_select = [
            rol for rol in ("anon", "authenticated")
            if not _sql(f"SELECT has_table_privilege('{rol}', 'public.spatial_ref_sys'::regclass, 'SELECT') AS ok")[0]["ok"]
        ]
        self.assertEqual(sin_select, [], f"se perdió SELECT en spatial_ref_sys para {sin_select}: rompe ST_Transform")
