# Plan de ejecución: fecha operativa de Lima en la app

Spec: `specs/app_fecha_operativa_lima.md`. Sin SQL; nada se aplica contra ninguna base.

1. Revisar `CLAUDE.md`, `ESTADO_PROYECTO.md` y las specs de huso (hecho).
2. Elegir ubicación: `apps/granja-valencia/lib/fecha/hoyOperativo.ts` (+ `hoyOperativo.test.ts`), siguiendo
   `lib/reemplazo/`, `lib/validations/` (carpeta por dominio con tests al lado).
3. Crear el helper (offset fijo −5 h, instante inyectable) y sus tests Jest con instantes fijos.
4. En las 10 pantallas: borrar la `hoyISO()` local, importar `hoyOperativo` desde
   `../../../../lib/fecha/hoyOperativo` y reemplazar los 11 usos.
5. Grep de otros usos de fecha del día (`new Date()`, `toISOString().slice/split`, `toLocale*`, `getFullYear/Month/Date`,
   `Intl`) y clasificar: (a) fecha de calendario → helper; (b) instante → no se toca.
6. Verificar: `tsc --noEmit`, Jest completo, bundle por ruta (HTTP 200, 0 `UnableToResolveError`).
7. Archivos web: solo reportar.
8. Documentar en `docs/ESTADO_PROYECTO.md` y comitear a `staging`.

Riesgos: ninguno de datos (solo cambia la fecha precargada, el usuario la ve y puede editarla); un solo punto
de verdad para el huso de la app. Pendiente fuera de este plan: validar en dispositivo de noche (19:00–24:00).
