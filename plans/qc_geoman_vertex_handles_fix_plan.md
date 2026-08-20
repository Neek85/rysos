# Plan de Ejecución — Activación de vértices editables (Geoman), cuarto prompt

Ver spec: `specs/qc_geoman_vertex_handles_fix.md`.

## Pasos

1. **Verificación de premisas:** `app/dashboard/qc/components/QcConsoleMap.jsx`
   no existe — el componente real es `components/gis/QcConsoleMap.jsx`
   (confirmado con `ls` + el import en `page.jsx`). `docs/schema_live.md`
   revisado — no aplica, tarea puramente de frontend.
2. **Comparación pedido vs. estado real:** de las 4 piezas pedidas
   (localizar sub-capa vía `.getLayers()`, `enable()` directo sobre la
   sub-capa con opciones explícitas, `disable()` en las demás, listeners de
   eventos), 3 ya existían desde el commit anterior (`ebd5707`,
   `specs/qc_geoman_layer_binding_fix.md`). La única pieza nueva: agregar
   el listener `pm:dragend` (antes solo `pm:edit`/`pm:markerdragend`).
3. `components/gis/QcConsoleMap.jsx`: agregado `childLayer.on('pm:dragend',
   report)` junto a los listeners existentes, con comentario explicando por
   qué es redundante-pero-inofensivo para los 2 tipos de capa reales de
   este componente (CircleMarker ya lo disparaba vía `pm:edit`; Polygon
   normalmente no lo dispara en absoluto, ya que ese evento corresponde a
   arrastrar la forma completa, no a editar vértices).
4. `tests/test_qc_vertex_handles_fix.mjs` (nuevo): inspección de código
   fuente validando que el listener `pm:dragend` está registrado sobre
   `childLayer`, que el archivo correcto es `components/gis/QcConsoleMap.jsx`
   (no `app/dashboard/qc/components/...`), y que los 3 mecanismos ya
   existentes (childLayer real, enable/disable directo, opciones
   explícitas) siguen intactos.
5. Verificación: `node --test tests/*.mjs`, `python -m pytest tests/ -v`
   (sin regresión, no se tocó Python), parar dev server + `rm -rf .next` +
   `npm run build` + `rm -rf .next` + reiniciar `npm run dev`, smoke test
   en browser.
6. Commit a `main` — **sin push**: el prompt pide explícitamente preguntar
   al usuario antes de `git push origin main` — se pregunta como siempre.
