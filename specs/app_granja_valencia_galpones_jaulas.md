# Spec — App Granja Valencia: Alta de Galpones y Pozas/Jaulas

> Primera pantalla de escritura de la app — establece el patrón que van a
> reusar Pesaje, Partos, Traslados, etc. Contexto: GRANJA-VALENCIA tiene
> 0 filas en PECUARIO_JAULAS/PECUARIO_GALPONES hoy (confirmado en vivo,
> 2026-09-28) — sin esta pantalla no hay forma de cargar datos reales para
> probar Dashboard/Población, que se reordenó a después de esta.

## 1. Alcance

**v1 — solo alta, sin edición/borrado/listado avanzado:**
- Crear un Galpón (formulario simple).
- Crear una Poza/Jaula (formulario simple), opcionalmente asociada a un
  Galpón ya creado.
- Lista de solo lectura de los galpones/pozas ya creados en esta sesión de
  trabajo (para no crear duplicados a ciegas), no un CRUD completo.

**Fuera de alcance en v1:**
- Editar o borrar galpones/pozas.
- Campo `estado` de la poza — a nivel de BD es texto libre sin lista fija
  de valores permitidos (confirmado, cero CHECK constraints), y no hay una
  definición de negocio de qué estados son válidos más allá del default
  `'activo'`. No se expone en el formulario — el insert deja que la BD
  aplique su default. Se define cuando haga falta una pantalla de edición
  real.
- Campo `n_hembras_activas` — el default de BD es `7`, que no tiene sentido
  para una poza recién creada y vacía. Se envía explícitamente `0` en el
  insert (ver §3) en vez de confiar en el default de la columna. Nota: no
  está confirmado si las vistas de ocupación (`vw_pecuario_ocupacion_poza`)
  leen esta columna directamente o la recalculan de las tablas hijas
  (`PECUARIO_LOTES`/`PECUARIO_REPRODUCTORES`) — si al construir Dashboard/
  Población se descubre que sí importa, se revisita.

## 2. Resolución de organización — infraestructura nueva, compartida

No existe todavía, en la app, un equivalente al `getCurrentProfile.js` de
la web (que es `'use server'`, no sirve en RN). Se crea uno cliente puro,
para esta pantalla y para TODAS las de escritura que siguen:

`apps/granja-valencia/lib/supabase/useProfile.ts`:
```ts
import { useEffect, useState } from 'react'
import { supabase } from './client'
import { useSession } from './useSession'

export function useProfile() {
  const { session } = useSession()
  const [organizacion, setOrganizacion] = useState<string | null>(null)
  const [rol, setRol] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!session?.user) {
      setOrganizacion(null)
      setRol(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    supabase
      .from('PERFILES_USUARIO_INTERNOS')
      .select('ID_Organizacion, rol')
      .eq('user_id', session.user.id)
      .eq('activo', true)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setOrganizacion(data?.ID_Organizacion ?? null)
        setRol(data?.rol ?? null)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [session?.user?.id])

  return { organizacion, rol, loading }
}
```
Mismo criterio que la web: degrada a `null`/`null` sin sesión o sin perfil
activo, nunca lanza error, bajo RLS normal (misma política que ya usa la
web para leer su propio perfil).

## 3. Contrato de datos (Zod) — compartido, en `lib/validations/pecuario.ts`

Se agregan acá (no en la app) porque son contratos de dominio Pecuario,
mismo criterio que los 19 schemas ya existentes en ese archivo — no hay
motivo para que sean exclusivos de la app si el día de mañana la web
también necesita un alta de galpones/pozas.

```ts
export const GalponAltaSchema = z.object({
  ID_Organizacion: z.string().min(1),
  codigo_galpon: z.string().trim().min(1, 'El código de galpón es obligatorio.'),
  nombre: z.string().trim().optional(),
  capacidad_pozas: z.coerce.number().int().positive().optional(),
  dias_frecuencia_limpieza: z.coerce.number().int().positive().optional(),
})
export type GalponAltaValues = z.infer<typeof GalponAltaSchema>

export const TIPO_USO_POZA = ['empadre', 'maternidad', 'recria', 'engorde', 'aislamiento'] as const

export const PozaAltaSchema = z.object({
  ID_Organizacion: z.string().min(1),
  codigo_poza: z.string().trim().min(1, 'El código de poza es obligatorio.'),
  tipo_uso: z.enum(TIPO_USO_POZA),
  galpon_id: z.string().uuid().nullable().optional(),
  capacidad_max: z.coerce.number().int().positive().optional(),
  macho_codigo: z.string().trim().optional(),
  linea_genetica: z.string().trim().optional(),
})
export type PozaAltaValues = z.infer<typeof PozaAltaSchema>
```

`ID_Organizacion` va en el contrato (no es un campo de UI) porque se resuelve
con `useProfile()` y se inyecta antes de validar/insertar — nunca lo escribe
el usuario. Al insertar `PECUARIO_JAULAS`, además de los campos del schema,
el código manda explícitamente `n_hembras_activas: 0` (ver §1) y omite
`estado` (deja el default de BD).

## 4. Pantalla

Reemplaza temporalmente `/dashboard-stub` como destino post-login (hasta
que exista Dashboard/Población real) — no hay todavía menú de navegación
entre pantallas (se diseña cuando haya 2-3 pantallas reales, no antes).

1. Sección "Galpones": lista de solo lectura de los ya creados (query
   simple `select('*').eq('ID_Organizacion', organizacion)`) + formulario
   de alta debajo (código, nombre, capacidad de pozas, días de limpieza).
2. Sección "Pozas/Jaulas": lista de solo lectura + formulario de alta
   (código, tipo de uso [selector con los 5 valores del enum], galpón
   [selector opcional de los ya creados, o "Sin asignar"], capacidad
   máxima, código de macho, línea genética).
3. Al enviar cualquiera de los dos formularios: validar con el Zod
   correspondiente (con `ID_Organizacion` ya inyectado desde `useProfile()`)
   → si `organizacion` todavía es `null` (perfil cargando o sin perfil
   activo), deshabilitar el botón de guardar con un mensaje ("Cargando tu
   perfil…" / "No se encontró tu perfil activo — contactá al admin") en vez
   de permitir un insert con organización vacía.
4. Insert directo a Supabase con la sesión real (sin capa intermedia, mismo
   criterio del roadmap). Error de Supabase (incluida violación del
   `UNIQUE` de `codigo_poza`/`codigo_galpon` por organización) → mostrar el
   mensaje de error tal cual lo devuelve Postgres (no hay todavía un mapeo
   de errores más amigable — se agrega si se vuelve un problema real de UX).
5. Éxito: limpiar el formulario y refrescar la lista de solo lectura.
6. Sin cola offline todavía (decisión ya confirmada) — si el insert falla
   por red, mostrar error y dejar reintentar manualmente (reintento simple).

## 5. Pruebas

- Unit: `GalponAltaSchema`/`PozaAltaSchema` — casos válidos, código vacío,
  `tipo_uso` inválido, números negativos/cero en campos que deben ser
  positivos.
- Manual en dispositivo real: crear un Galpón real de Granja Valencia,
  crear una Poza real asociada a ese galpón, confirmar en Supabase Studio
  (o releyendo la lista en la propia pantalla) que quedaron con
  `ID_Organizacion = 'GRANJA-VALENCIA'` correcto — este es el primer dato
  operativo real que va a tener el sistema para esta granja.

## 6. Estado

EN DISEÑO (2026-09-28).
