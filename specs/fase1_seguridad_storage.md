# SPEC: Seguridad RLS Multi-Tenant, Storage y Vistas Aprobadas (Fase 1)

## 1. Contexto y Objetivos
Establecer la capa de aislamiento de datos Multi-Tenant para RYZOS en Supabase mediante Row Level Security (RLS) basado en el claim `ID_Organizacion` del token JWT, configurar el bucket privado para evidencias fotográficas y exponer únicamente registros aprobados por Control de Calidad (QC) para la capa Web.

## 2. Invariantes de Seguridad y Negocio
- **Aislamiento Multi-Tenant:** Ninguna consulta ejecutada por un usuario autenticado puede retornar o modificar filas donde `ID_Organizacion` sea distinto al claim del JWT (`get_my_org_id()`).
- **Inyección Automática:** Todo `INSERT` en tablas transaccionales sin `ID_Organizacion` explícito debe autocompletarse vía Trigger.
- **Filtro Estricto QC:** La vista para la aplicación web (`view_eudr_dashboard_aprobados`) debe filtrar exclusivamente registros con `estado_revision = 'APROBADO'`.
- **Almacenamiento Aislado:** Las imágenes en `storage.objects` dentro del bucket `evidencias_eudr` solo pueden ser leídas/escritas si el primer segmento del path coincide con el `ID_Organizacion` del usuario.

## 3. Modelo de Datos Afectado
- Tablas Maestras: `ORGANIZACIONES`, `PADRON_SOCIOS`, `PADRON_PARCELAS`.
- Tablas Transaccionales EUDR: `EUDR_MONITOREO`, `EUDR_INSTALACIONES`, `EUDR_USO_SUELO`.
- Almacenamiento: Bucket `evidencias_eudr`.
- Vistas: `view_eudr_dashboard_aprobados`.

## 4. Criterios de Aceptación
- [ ] La función `get_my_org_id()` extracta correctamente el claim `ID_Organizacion` del JWT.
- [ ] No existen políticas RLS duplicadas ni conflictivas en las 6 tablas principales.
- [ ] Un `INSERT` sin `ID_Organizacion` no falla y completa el campo automáticamente.
- [ ] La consulta a `view_eudr_dashboard_aprobados` retorna 0 registros en estado `'PENDIENTE'`.
- [ ] Intentos de acceso a buckets con rutas de otras organizaciones son bloqueados por Supabase Storage RLS.
