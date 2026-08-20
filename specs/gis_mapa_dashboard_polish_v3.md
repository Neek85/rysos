# Spec — Polish v3 de `/dashboard/mapa`: default literal + rechazo del parche client-side

Tercera vuelta sobre el mismo módulo, mismo día — ver
`specs/gis_mapa_dashboard_polish.md` y `_v2.md`. Prompt de seguimiento
pidió "corregir de forma definitiva" la resolución de nombre de productor.

## Corrección de premisas / decisiones

- **La cascada `a) directo, b) vía parcela` que pide el prompt ya estaba
  implementada** en `20260819_vw_monitoreo_web_productor_nombre_parcela_fallback.sql`
  (tarea anterior, mismo día) — el único cambio real pedido es el paso
  `c)`: reemplazar el fallback final por el string literal
  `'Socio no asignado'`.
- **Se editó el archivo de migración EXISTENTE en el lugar** (no se creó
  una tercera migración en cascada) porque el prompt lo pide
  explícitamente ("Actualiza la migración... reemplaza la definición") y
  esa migración específica todavía no se aplicó nunca contra la instancia
  real (confirmado en la tarea anterior) — editarla en el lugar no reescribe
  historia ya aplicada, a diferencia de si hubiera estado confirmada en
  producción.
- **Se rechazó parte de la instrucción literal:** el prompt pedía que el
  default `'Socio no asignado'` reemplazara CUALQUIER fallback restante
  (`src.productor`/`mon.productor`, o sea el `ID_Socio` crudo o el nombre
  libre `nuevo_productor_nombre` que un técnico QField anotó para un
  productor sin registro formal todavía). Aplicado tal cual, un nombre real
  ya conocido (texto libre) se reemplazaría por un placeholder genérico —
  una regresión de información, no una mejora. Se mantiene ese fallback
  ANTES del default literal: `COALESCE(ps.socio_nombre_completo,
  ps_parcela.socio_nombre_completo, src.productor, mon.productor,
  'Socio no asignado')` — el default solo aplica cuando no hay
  absolutamente ningún dato.
- **Se rechazó el "parche defensivo" client-side en `MapDashboard.jsx`**
  (buscar en un array de parcelas en memoria por `ID_Parcela_Fija`/
  `parcela_codigo` cuando `productor_nombre` viene nulo/"Sin registrar").
  Dos problemas: (1) no existe tal array — `MapDashboard.jsx` no hace
  ningún fetch propio a `PADRON_PARCELAS`, todo llega ya resuelto vía
  `vw_monitoreo_web` en `records`; (2) aunque se armara buscando dentro de
  `records` mismo, no serviría de nada — la cascada SQL es determinística
  por `(ID_Parcela_Fija, ID_Organizacion)`, así que TODAS las filas de una
  misma parcela ya comparten idéntico `productor_nombre`. Un parche así
  sería código muerto que nunca encuentra un valor mejor.
- **`lib/actions/gisActions.js` sigue sin ningún cambio** — mismo motivo ya
  documentado dos veces: no existe (ni debería existir ahí) ningún helper
  `enrichWithParcelaInfo` para este módulo, la cascada es 100% SQL.

## Cambios

1. `supabase/migrations/20260819_vw_monitoreo_web_productor_nombre_parcela_fallback.sql`
   (editado en el lugar): `productor_nombre` termina en
   `COALESCE(..., 'Socio no asignado')` en vez de `NULL`.
2. `components/gis/MapDashboard.jsx`: el fallback client-side
   ("Sin registrar" → "Socio no asignado") queda como defensa adicional
   por si la migración no está aplicada aún en la instancia real (columna
   ausente/NULL) — comentario explícito de por qué es solo defensivo.

## Sin tests nuevos

Mismo motivo que `_v2.md`: ningún cambio de esta tarea introduce lógica JS
nueva testeable (el cambio de texto de fallback en `MapDashboard.jsx` es
una constante de un solo carácter de diferencia funcional, ya cubierta
conceptualmente por la ausencia total de tests de rendering en este
proyecto — no hay Jest/Testing Library instalado).

## Pendiente de aplicar en Supabase

Sigue habiendo DOS migraciones sobre `vw_monitoreo_web` sin aplicar en la
instancia real, en orden: `20260819_vw_monitoreo_web_productor_nombre.sql`,
luego `20260819_vw_monitoreo_web_productor_nombre_parcela_fallback.sql`
(esta última ya con el default `'Socio no asignado'` incluido — no hace
falta aplicar dos veces, la versión final del archivo ya lo tiene).
