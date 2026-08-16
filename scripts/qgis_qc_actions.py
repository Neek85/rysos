"""
Script Helper para Acciones de QGIS Desktop en RYZOS.
Genera SQL para Acciones de Capa (Layer Actions) en QGIS Desktop.

Uso en QGIS — Layer Properties → Actions → Add Action:
  Tipo: Python
  Texto de acción: exec(open('/ruta/a/qgis_qc_actions.py').read()); aprobar('[% id_monitoreo %]')
"""

import re

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

VALID_STATES = {"PENDIENTE", "APROBADO", "RECHAZADO"}


def _validate_uuid(value: str) -> str:
    """Valida formato UUID v4. Lanza ValueError si el input es inválido."""
    if not _UUID_RE.match(value.strip()):
        raise ValueError(f"id_monitoreo no es un UUID v4 válido: {value!r}")
    return value.strip()


def _sanitize_text(text: str, max_len: int = 500) -> str:
    """Escapa comillas simples y limita longitud para uso en SQL literal."""
    return text.replace("'", "''")[:max_len]


def get_approve_action_sql(id_monitoreo: str) -> str:
    """Genera SQL idempotente para aprobar un monitoreo desde QGIS."""
    uid = _validate_uuid(id_monitoreo)
    return (
        f"UPDATE public.\"EUDR_MONITOREO\"\n"
        f"SET estado_revision = 'APROBADO',\n"
        f"    actualizado_en  = now()\n"
        f"WHERE id_monitoreo = '{uid}'\n"
        f"  AND estado_revision = 'PENDIENTE';"
    )


def get_reject_action_sql(id_monitoreo: str, motivo: str = "") -> str:
    """Genera SQL para rechazar un monitoreo y anexar el motivo al campo observaciones."""
    uid = _validate_uuid(id_monitoreo)
    motivo_clean = _sanitize_text(motivo)
    suffix = f" [RECHAZADO QC: {motivo_clean}]" if motivo_clean else " [RECHAZADO QC]"
    return (
        f"UPDATE public.\"EUDR_MONITOREO\"\n"
        f"SET estado_revision = 'RECHAZADO',\n"
        f"    actualizado_en  = now(),\n"
        f"    observaciones   = COALESCE(observaciones, '') || '{suffix}'\n"
        f"WHERE id_monitoreo = '{uid}'\n"
        f"  AND estado_revision = 'PENDIENTE';"
    )


def get_revert_action_sql(id_monitoreo: str) -> str:
    """Genera SQL para revertir un registro de vuelta a PENDIENTE (rollback QC)."""
    uid = _validate_uuid(id_monitoreo)
    return (
        f"UPDATE public.\"EUDR_MONITOREO\"\n"
        f"SET estado_revision = 'PENDIENTE',\n"
        f"    actualizado_en  = now()\n"
        f"WHERE id_monitoreo = '{uid}';"
    )


# ---------------------------------------------------------------------------
# Funciones de atajo para uso directo dentro de macros QGIS (exec context)
# ---------------------------------------------------------------------------

def aprobar(id_monitoreo: str) -> None:
    """Ejecuta la aprobación vía psycopg2 cuando se corre dentro de QGIS."""
    sql = get_approve_action_sql(id_monitoreo)
    _run_in_qgis(sql, f"Aprobado: {id_monitoreo}")


def rechazar(id_monitoreo: str, motivo: str = "") -> None:
    """Ejecuta el rechazo vía psycopg2 cuando se corre dentro de QGIS."""
    sql = get_reject_action_sql(id_monitoreo, motivo)
    _run_in_qgis(sql, f"Rechazado: {id_monitoreo}")


def _run_in_qgis(sql: str, label: str) -> None:
    """Ejecuta SQL usando la conexión activa de QGIS (requiere entorno QGIS)."""
    try:
        from qgis.core import QgsDataSourceUri, QgsProviderRegistry  # noqa: F401
        from qgis.utils import iface
        layer = iface.activeLayer()
        layer.dataProvider().execSQL(sql)
        iface.messageBar().pushSuccess("RYZOS QC", label)
    except ImportError:
        print(f"[QGIS QC] (fuera de QGIS) SQL generado:\n{sql}")
