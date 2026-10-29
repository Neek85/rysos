"""
Apoyo común de las suites Pecuario que siembran datos en vivo SOLO en
organizaciones de prueba (ORGANIZACIONES.es_organizacion_prueba = true).

Extraído del test del panel de indicadores (patrón endurecido) para no copiar
el mismo código en cada suite:

  (a) exigir_org_prueba(*orgs): guarda de setUpClass. Aborta la suite si alguna
      organización no existe o no está marcada como de prueba -- jamás se
      siembra en una organización real.
  (b) borrar_entradas(entradas, org): tearDown endurecido. Cada DELETE filtra
      por id (UUID propio) Y por ID_Organizacion, verifica el código de
      respuesta y devuelve la lista de rechazos (el test debe fallar si no
      está vacía).
  (c) residuos(...): comprobación de tearDownClass. Marca de prueba en las
      tablas con código y, para una organización dedicada, conteo total de
      filas en las tablas sembradas (deben quedar en 0).

REGLA: ORG-TEST-PANEL es una organización DEDICADA compartida por el panel de
indicadores, Empadre, poblacion_vistas y etapa_automatica. Cada suite exige que
quede vacía al terminar y algunas (panel, poblacion) leen agregados de toda la
organización, así que estas suites deben correr SIEMPRE en secuencia, nunca en
paralelo (ni pytest -n, ni dos terminales a la vez). Si algún día se
paralelizan: una organización de prueba por suite.
"""

import os

import httpx

ORG_PANEL = "ORG-TEST-PANEL"


def _url():
    return os.getenv("SUPABASE_URL")


def service_headers():
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    return {"apikey": key, "Authorization": f"Bearer {key}"}


def exigir_org_prueba(*orgs):
    """Guarda anti-error para setUpClass: aborta si alguna org no existe o no es de prueba."""
    for org in orgs:
        res = httpx.get(
            f"{_url()}/rest/v1/ORGANIZACIONES", headers=service_headers(),
            params={"ID": f"eq.{org}", "select": "ID,es_organizacion_prueba"}, timeout=30,
        )
        res.raise_for_status()
        filas = res.json()
        if not filas:
            raise AssertionError(f"{org} no existe en ORGANIZACIONES: se aborta la suite sin sembrar nada.")
        if filas[0].get("es_organizacion_prueba") is not True:
            raise AssertionError(f"{org} NO está marcada es_organizacion_prueba=true: se aborta la suite, jamás se siembra en una organización real.")


def contar(tabla, params):
    res = httpx.get(
        f"{_url()}/rest/v1/{tabla}", headers={**service_headers(), "Prefer": "count=exact"},
        params={**params, "select": "id", "limit": 1}, timeout=30,
    )
    res.raise_for_status()
    return int(res.headers["content-range"].split("/")[-1])


def borrar_entradas(entradas, org):
    """tearDown endurecido. `entradas`: lista (LIFO aquí) de (tabla, campo, valor) o
    (tabla, campo, valor, org_propia) cuando la fila vive en otra organización de prueba.
    Devuelve la lista de rechazos (vacía = todo borrado)."""
    rechazados = []
    for entrada in reversed(entradas):
        tabla, campo, valor = entrada[:3]
        org_fila = entrada[3] if len(entrada) > 3 else org
        res = httpx.delete(
            f"{_url()}/rest/v1/{tabla}", headers=service_headers(),
            params={campo: f"eq.{valor}", "ID_Organizacion": f"eq.{org_fila}"}, timeout=30,
        )
        if res.status_code not in (200, 204):
            rechazados.append(f"{tabla} {campo}={valor} ({org_fila}): HTTP {res.status_code} {res.text[:160]}")
    return rechazados


def residuos(org, prefijo, tablas_con_codigo, tablas_totales=()):
    """tearDownClass. Marca `prefijo%` en las tablas con código (cualquier org de prueba) y,
    si `tablas_totales`, cualquier fila de `org` (organización dedicada: debe quedar vacía)."""
    encontrados = []
    for tabla, col in tablas_con_codigo:
        n = contar(tabla, {"ID_Organizacion": f"eq.{org}", col: f"like.{prefijo}%"})
        if n:
            encontrados.append(f"{tabla}.{col} LIKE '{prefijo}%': {n}")
    for tabla in tablas_totales:
        n = contar(tabla, {"ID_Organizacion": f"eq.{org}"})
        if n:
            encontrados.append(f"{tabla} (cualquier fila de {org}): {n}")
    return encontrados
