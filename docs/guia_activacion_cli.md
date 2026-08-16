# Guía de Activación: Claude Code CLI + Supabase (RYZOS)

## Ruta de Trabajo Recomendada

Usar siempre una ruta local fuera de OneDrive para evitar conflictos de sincronización:

```
C:\EcosistemaSAAS\rysos\
```

No usar rutas tipo `C:\Users\<usuario>\OneDrive\...` — la sincronización activa puede
corromper archivos de migración o bloquear la escritura del CLI.

---

## 1. Iniciar sesión en Claude Code CLI

Abre la terminal integrada de VS Code (`Ctrl + ~`) y ejecuta:

```bash
claude
```

Si es la primera vez:

```bash
claude auth login
```

---

## 2. Variables de Entorno requeridas

Crea un archivo `.env.local` en la raíz del proyecto (nunca lo commitees):

```env
SUPABASE_URL=https://<tu-proyecto>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
SUPABASE_ANON_KEY=<anon_key>
```

Valores disponibles en: **Supabase Dashboard → Project Settings → API**.

Para cargarlas en la sesión actual de PowerShell:

```powershell
Get-Content .env.local | ForEach-Object {
  if ($_ -match '^([^#][^=]+)=(.+)$') {
    [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
  }
}
```

---

## 3. Aplicar la migración RLS en Supabase

### Opción A — SQL Editor del Dashboard (recomendado para primera vez)

1. Abre **Supabase Dashboard → SQL Editor**.
2. Pega el contenido de `supabase/migrations/20260815_fix_rls_policies.sql`.
3. Haz clic en **Run**.

### Opción B — Supabase CLI

```bash
supabase db push
```

> Requiere `supabase link --project-ref <ref>` previo si aún no está vinculado.

---

## 4. Ejecutar suite de pruebas SDD

Con las variables de entorno cargadas:

```bash
python tests/test_fase1_sdd.py
```

Salida esperada:

```
=== PRUEBAS DE ACEPTACIÓN SDD (FASE 1) ===
[SDD-AC1] Verificando filtro 'APROBADO' en view_eudr_dashboard_aprobados...
  -> PASADO
[SDD-AC2] Verificando privacidad del bucket 'evidencias_eudr'...
  -> PASADO

TODOS LOS CRITERIOS DE ACEPTACIÓN DE LA ESPECIFICACIÓN FUERON CUMPLIDOS.
```

---

## 5. Verificación manual del claim JWT en Supabase

Para confirmar que `get_my_org_id()` lee el JWT correctamente, ejecuta en el SQL Editor
**como usuario autenticado** (no como postgres):

```sql
SELECT public.get_my_org_id();
```

Debe retornar el `ID_Organizacion` configurado en los `user_metadata` del usuario.

---

## 6. Archivos clave del proyecto

| Ruta | Propósito |
|------|-----------|
| `supabase/migrations/20260815_fix_rls_policies.sql` | Migración RLS idempotente (usar esta) |
| `supabase/migrations/20260815_fase1_security_storage.sql` | Migración original Fase 1 |
| `specs/fase1_seguridad_storage.md` | Especificación formal SDD |
| `plans/fase1_ejecucion.md` | Plan de ejecución y rollback |
| `tests/test_fase1_sdd.py` | Suite de aceptación automatizada |
