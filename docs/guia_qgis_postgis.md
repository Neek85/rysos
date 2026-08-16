# Guía de Conexión QGIS Desktop → Supabase PostGIS (RYZOS)

## 1. Parámetros de Conexión

En QGIS: **Layer → Add Layer → Add PostGIS Layer → New Connection**

| Campo | Valor |
|---|---|
| Name | RYZOS Supabase |
| Host | `db.<tu-ref>.supabase.co` |
| Port | `5432` |
| Database | `postgres` |
| SSL Mode | `require` |
| Username | `postgres` (o usuario con rol `authenticated`) |
| Password | Tu contraseña de Supabase |

> El host se obtiene en **Supabase Dashboard → Project Settings → Database → Connection string**.

---

## 2. Filtro de Capa para Bandeja QC

Al agregar la capa `EUDR_MONITOREO`, aplicar el filtro SQL en el diálogo de capa:

```sql
"estado_revision" = 'PENDIENTE'
```

Esto limita la vista del analista GIS exclusivamente a los registros pendientes de auditoría.

---

## 3. Configurar Acciones de Formulario (Aprobar / Rechazar)

### Paso 1 — Registrar el script en QGIS

En la consola Python de QGIS (`Plugins → Python Console`):

```python
import sys
sys.path.insert(0, r'C:\EcosistemaSAAS\rysos\scripts')
```

### Paso 2 — Agregar Acciones a la capa

**Layer Properties → Actions → (+) Add Action**

**Acción: Aprobar Inspección**
- Tipo: `Python`
- Descripción: `Aprobar Inspección`
- Acción:
```python
import sys; sys.path.insert(0, r'C:\EcosistemaSAAS\rysos\scripts')
from qgis_qc_actions import aprobar
aprobar('[% id_monitoreo %]')
```

**Acción: Rechazar Inspección**
- Tipo: `Python`
- Descripción: `Rechazar Inspección`
- Acción:
```python
import sys; sys.path.insert(0, r'C:\EcosistemaSAAS\rysos\scripts')
from qgis_qc_actions import rechazar
rechazar('[% id_monitoreo %]', 'Límite topológico incorrecto')
```

> `[% id_monitoreo %]` es la expresión QGIS que inyecta el valor del campo `id_monitoreo` del feature seleccionado.

---

## 4. Vista del Dashboard Web

La vista `view_eudr_dashboard_aprobados` en Supabase filtra `WHERE estado_revision = 'APROBADO'`.
El cambio de estado en QGIS es instantáneo — no requiere procesos batch ni recarga manual.

---

## 5. Rollback de Aprobación Errónea

En la consola Python de QGIS o en el SQL Editor de Supabase:

```python
from qgis_qc_actions import get_revert_action_sql
print(get_revert_action_sql('<uuid-del-monitoreo>'))
```

O directamente en SQL:

```sql
UPDATE public."EUDR_MONITOREO"
SET estado_revision = 'PENDIENTE', actualizado_en = now()
WHERE id_monitoreo = '<uuid>';
```
