import { z } from 'zod';

// CORRECCIÓN clave respecto al diseño original (Gemini): ID_Organizacion es
// un código de negocio en texto (ej. "COOP-AROMAS-VALLE"), NO un uuid —
// confirmado contra ORGANIZACIONES."ID" en docs/schema_live.md. Usar
// z.string().uuid() aquí habría rechazado silenciosamente cada registro
// real que la app intentara guardar offline.
const IdOrganizacionSchema = z.string().min(1, 'ID_Organizacion es requerido');

// Renombrado (2026-09-29, app Granja Valencia): este era el
// PartoRegistroSchema original -- diseño especulativo de sync offline
// (device_id/created_offline_at obligatorios), nunca conectado a ningún
// consumidor real (confirmado por grep exhaustivo antes de tocar esto).
// El nombre PartoRegistroSchema pasa al contrato real de la pantalla
// "Registrar parto" de la app (ver más abajo) -- decisión explícita de
// Neyser, no una limpieza unilateral. Forma sin cambios.
export const PartoOfflineDraftSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  poza_id: z.string().uuid(),
  fecha_parto: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  n_vivos: z.number().int().nonnegative({ message: 'Nacidos vivos no puede ser negativo' }),
  n_muertos: z.number().int().nonnegative().default(0),
  peso_total_camada_g: z.number().int().positive().optional().nullable(),
  macho_activo_codigo: z.string().max(50).optional().nullable(),
  madre_id: z.string().uuid().optional().nullable(), // v3: FK real cuando el modo individual está activo
  macho_id: z.string().uuid().optional().nullable(), // v3: FK real al padre identificado (complementa macho_activo_codigo)
  observaciones: z.string().max(500).optional().nullable(),
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
});

// v3: exactamente uno de animal_id (modo individual) o lote_id/poza_id (modo
// poblacional) — mismo CHECK que la migración de base de datos, replicado
// acá para dar feedback inmediato en el formulario, antes de intentar
// guardar (útil sobre todo offline, donde el error de la base tarda en
// llegar hasta que haya señal para sincronizar).
export const MortalidadRegistroSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  poza_id: z.string().uuid().optional().nullable(),
  lote_id: z.string().uuid().optional().nullable(),
  animal_id: z.string().uuid().optional().nullable(),
  fecha_evento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  cantidad: z.number().int().positive({ message: 'La cantidad de bajas debe ser al menos 1' }),
  etapa: z.enum(['lactancia', 'recria', 'engorde', 'reproductor']),
  causa: z.enum(['neumonia', 'distocia', 'aplastamiento', 'gastroenteritis', 'depredador', 'desconocido', 'otro']),
  descripcion_sintomas: z.string().max(500).optional().nullable(),
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
}).refine(
  (data) => {
    const individual = !!data.animal_id;
    const poblacional = !!data.lote_id || !!data.poza_id;
    return individual !== poblacional; // XOR: uno de los dos, nunca ambos ni ninguno
  },
  { message: 'Debe indicar un animal identificado O un lote/poza (poblacional), no ambos ni ninguno.', path: ['animal_id'] }
);

export const PesajeLoteSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  lote_id: z.string().uuid().optional().nullable(),
  poza_id: z.string().uuid().optional().nullable(),
  fecha_pesaje: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  animales_muestreados: z.number().int().positive(),
  peso_total_muestra_g: z.number().positive(),
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
});

// v5 (2026-09-23, venta de pelado/beneficiado — ver
// specs/pecuario_venta_pelado_beneficiado.md y las migraciones
// 20260923090000a_pecuario_venta_pelado_enum.sql +
// 20260923090000b_pecuario_venta_pelado_beneficiado.sql -- partida en 2
// archivos/2 Runs de Studio, ver el encabezado de la parte A):
// - tipo_salida gana 'pelado_beneficiado'.
// - base_precio ('por_animal' default | 'por_kg') — solo 'por_kg' cuando
//   tipo_salida='pelado_beneficiado'; en ese caso peso_total_kg y
//   precio_kg pasan a ser obligatorios (antes peso_total_kg era
//   puramente referencial). Mismo criterio XOR que el resto del archivo,
//   replicando chk_ventas_base_precio_coherente.
// - peso_vivo_pre_beneficio_kg (Ronda 46, 2026-09-22): opcional, base de
//   Rendimiento de carcasa — no se valida como obligatorio ni en la base
//   ni acá, mismo criterio de no bloquear captura offline por un dato
//   faltante (ver comentario de la columna en la migración).
export const VentaRegistroSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  lote_id: z.string().uuid().optional().nullable(),
  poza_id: z.string().uuid().optional().nullable(),
  animal_id: z.string().uuid().optional().nullable(), // v3: venta de un reproductor identificado
  fecha_venta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  // 'guano' retirado (2026-09-23, ver 20260923110000_pecuario_venta_subproductos_guano.sql):
  // el guano ya no es un tipo_salida de PECUARIO_VENTAS -- pasa por
  // VentaSubproductoSchema/PECUARIO_VENTAS_SUBPRODUCTOS. El valor
  // 'guano' del enum tipo_venta_cuy en la base queda como vestigio
  // inerte (Postgres no permite eliminar valores de enum) -- 0 filas
  // históricas reales con ese valor (confirmado en vivo antes de este
  // cambio), así que retirarlo acá no rompe ningún dato existente.
  tipo_salida: z.enum(['carne', 'pie_cria', 'reproductor_saca', 'pelado_beneficiado']),
  cantidad: z.number().int().positive(),
  precio_unitario: z.number().nonnegative().optional().nullable(), // v4: precio por animal
  peso_total_kg: z.number().positive().optional().nullable(), // v4: referencial salvo cuando base_precio='por_kg' (v5, ver abajo)
  precio_total: z.number().nonnegative(),
  comprador_nombre: z.string().max(150).optional().nullable(), // PII de un tercero: nunca a consola/log
  base_precio: z.enum(['por_animal', 'por_kg']).default('por_animal'),
  precio_kg: z.number().nonnegative().optional().nullable(),
  peso_vivo_pre_beneficio_kg: z.number().positive().optional().nullable(),
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
}).refine(
  (data) => !!data.animal_id !== !!data.lote_id,
  { message: 'Debe indicar un animal identificado O un lote, no ambos ni ninguno.', path: ['animal_id'] }
).refine(
  (data) => !data.animal_id || data.cantidad === 1,
  { message: 'La venta de un animal identificado es siempre de cantidad 1.', path: ['cantidad'] }
).refine(
  (data) => data.base_precio === 'por_animal' || data.tipo_salida === 'pelado_beneficiado',
  { message: 'La base de precio "por kilogramo" solo aplica a ventas de tipo Pelado (beneficiado).', path: ['base_precio'] }
).refine(
  (data) => data.base_precio !== 'por_kg' || (data.peso_total_kg != null && data.precio_kg != null),
  { message: 'Con base de precio "por kilogramo", el peso total pelado y el precio por kg son obligatorios.', path: ['precio_kg'] }
).refine(
  // Falta en la redacción original: chk_ventas_base_precio_coherente exige
  // precio_kg IS NULL cuando base_precio='por_animal' -- sin este refine,
  // el formulario podía prometer un guardado que la base rechazaría.
  (data) => data.base_precio !== 'por_animal' || data.precio_kg == null,
  { message: 'Con base de precio "por animal", no debe enviarse precio_kg.', path: ['precio_kg'] }
);

// ---------------------------------------------------------------------
// v2 (2026-09-11): sanidad recurrente + insumos.
// ---------------------------------------------------------------------

export const ControlSanitarioSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  producto_usado: z.string().max(150).optional().nullable(),
  responsable: z.string().max(150).optional().nullable(),
  observaciones: z.string().max(500).optional().nullable(),
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
});

export const LimpiezaGalponSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  galpon_id: z.string().uuid(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  observaciones: z.string().max(500).optional().nullable(),
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
});

// v4 (2026-09-11, reconciliación con el diseño original de AppSheet):
// - categoria: se agregan 'medicamento' y 'vitamina' (antes mezclados bajo
//   'sanitario'), y 'cama' se renombra a 'material' (ver migración v4).
//   'sanitario' se conserva para desinfectantes/limpieza de instalaciones
//   — no administrados al animal, por eso no se fusiona con 'medicamento'.
// - unidad_medida: pasa de texto libre a un enum fijo (evita "kg"/"Kg"/
//   "kilogramos" como valores distintos entre técnicos/dispositivos).
// - stock_inicial: NO es una columna de la tabla. Es un campo de solo-UI:
//   si el técnico lo completa al dar de alta el insumo, la Server Action
//   crea el insumo y ADEMÁS un primer movimiento (tipo 'entrada', esa
//   cantidad) en PECUARIO_INSUMOS_MOVIMIENTOS. El stock se sigue
//   calculando siempre por vista (vw_pecuario_insumos_stock) a partir de
//   los movimientos — nunca se vuelve a permitir editarlo a mano, a
//   diferencia del "Stock Actual" manual del AppSheet original.
export const InsumoSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  nombre: z.string().min(1).max(150),
  categoria: z.enum(['alimento', 'medicamento', 'vitamina', 'sanitario', 'material', 'equipo', 'otro']).default('otro'),
  unidad_medida: z.enum(['kg', 'g', 'litro', 'ml', 'unidad', 'saco_50kg', 'saco_40kg']).default('unidad'),
  stock_minimo: z.number().nonnegative().optional().nullable(),
  stock_inicial: z.number().nonnegative().optional().nullable(), // solo-UI, ver nota arriba — no se persiste tal cual
  activo: z.boolean().default(true),
});

export const MovimientoInsumoSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  insumo_id: z.string().uuid(),
  tipo_movimiento: z.enum(['entrada', 'salida']),
  cantidad: z.number().positive(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  poza_id: z.string().uuid().optional().nullable(),
  lote_id: z.string().uuid().optional().nullable(),
  observaciones: z.string().max(500).optional().nullable(),
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
});

// ---------------------------------------------------------------------
// v3 (2026-09-11): identificación individual de reproductoras/reproductores.
// Overlay opcional — ver specs/pecuario_identificacion_individual.md.
// ---------------------------------------------------------------------

export const ReproductorSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  codigo_arete: z.string().min(1, 'El código de arete es requerido').max(50),
  sexo: z.enum(['macho', 'hembra']),
  raza: z.string().max(50).optional().nullable(),
  fecha_nacimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  madre_id: z.string().uuid().optional().nullable(),
  padre_id: z.string().uuid().optional().nullable(),
  jaula_actual_id: z.string().uuid().optional().nullable(),
  proposito: z.enum(['reproductor', 'engorde', 'reemplazo', 'descarte']).default('reproductor'),
  estado: z.enum(['activo', 'vendido', 'muerto', 'enfermo']).default('activo'),
  fecha_salida: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  foto_url: z.string().url().optional().nullable(),
  notas: z.string().max(500).optional().nullable(),
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
  // Item 9 (2026-09-27): true si el técnico confirmó explícitamente el
  // banner de advertencia (consanguinidad y/o jaula ya ocupada) al dar
  // de alta este reproductor ya asignado a una jaula. Ver
  // supabase/migrations/20260927100000_pecuario_alerta_consanguinidad_config.sql.
  advertencia_confirmada: z.boolean().optional().default(false),
});

export const HistorialMachoSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  macho_id: z.string().uuid(),
  jaula_id: z.string().uuid(),
  fecha_entrada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  fecha_salida: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(), // NULL = todavía activo en esa jaula
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
  // Item 9 (2026-09-27): mismo criterio que ReproductorSchema.advertencia_confirmada,
  // aplicado a la asignación de un macho a una jaula (Empadre).
  advertencia_confirmada: z.boolean().optional().default(false),
});

// Exactamente un target (galpon_id/lote_id/animal_id) según el alcance
// declarado — mismo CHECK que la migración, replicado en el formulario.
export const TratamientoSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  alcance: z.enum(['galpon', 'lote', 'individual']),
  galpon_id: z.string().uuid().optional().nullable(),
  lote_id: z.string().uuid().optional().nullable(),
  animal_id: z.string().uuid().optional().nullable(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  tipo_tratamiento: z.enum(['preventivo', 'curativo', 'vitaminas']).default('preventivo'),
  diagnostico: z.string().max(500).optional().nullable(),
  insumo_id: z.string().uuid().optional().nullable(),
  cantidad_dosis: z.number().positive().optional().nullable(),
  costo_estimado: z.number().nonnegative().optional().nullable(),
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
}).refine((data) => {
  if (data.alcance === 'galpon') return !!data.galpon_id && !data.lote_id && !data.animal_id;
  if (data.alcance === 'lote') return !!data.lote_id && !data.galpon_id && !data.animal_id;
  return !!data.animal_id && !data.galpon_id && !data.lote_id; // 'individual'
}, { message: 'El campo de destino debe coincidir exactamente con el alcance seleccionado (galpón, lote o animal).', path: ['alcance'] });

// ---------------------------------------------------------------------
// Compras/gastos de la granja (2026-09-22) — ver
// specs/pecuario_compras_gastos.md y
// supabase/migrations/20260922110000_pecuario_compras_gastos.sql.
// Dos ramas mutuamente excluyentes según `concepto`:
//   - 'insumo': genera además el movimiento de 'entrada' automático en
//     PECUARIO_INSUMOS_MOVIMIENTOS (trigger fn_compra_genera_entrada_insumo).
//   - 'servicio_otro': gasto de la granja sin insumo de stock asociado
//     (combustible, mantenimiento, servicio veterinario/técnico, mano de
//     obra).
// `monto_total` es una columna GENERATED en la base (costo_insumo + flete,
// o monto_servicio) — nunca se envía desde el cliente, por eso no aparece
// en este schema (mismo criterio que peso_promedio_g, ausente de
// PesajeLoteSchema). El refine replica exactamente
// chk_compras_rama_por_concepto de la migración, para dar feedback
// inmediato en el formulario antes de que el INSERT llegue a la base.
export const CompraSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  proveedor: z.string().max(150).optional().nullable(),
  concepto: z.enum(['insumo', 'servicio_otro']),
  // Rama "insumo"
  insumo_id: z.string().uuid().optional().nullable(),
  cantidad: z.number().positive().optional().nullable(),
  galpon_id: z.string().uuid().optional().nullable(),
  costo_insumo: z.number().nonnegative().optional().nullable(),
  flete: z.number().nonnegative().optional().nullable(), // opcional -- sin default acá ni en la base (fix 20260922120000: la base tenía DEFAULT 0 sin condicionar a la rama, violaba chk_compras_rama_por_concepto en servicio_otro; monto_total ya hace COALESCE(flete,0) al calcular)
  // Rama "servicio_otro"
  categoria_gasto: z.enum(['combustible', 'mantenimiento_reparaciones', 'servicio_veterinario_tecnico', 'mano_obra', 'otro']).optional().nullable(),
  descripcion: z.string().max(500).optional().nullable(),
  monto_servicio: z.number().nonnegative().optional().nullable(),
  // Comunes
  comprobante: z.string().max(100).optional().nullable(),
  device_id: z.string().min(1).optional().nullable(), // offline aún sin confirmar para esta pantalla, ver spec §5
  created_offline_at: z.string().datetime().optional().nullable(),
}).refine((data) => {
  if (data.concepto === 'insumo') {
    return (
      !!data.insumo_id &&
      data.cantidad != null && data.cantidad > 0 &&
      !!data.galpon_id &&
      data.costo_insumo != null && data.costo_insumo >= 0 &&
      data.categoria_gasto == null && data.descripcion == null && data.monto_servicio == null
    );
  }
  // 'servicio_otro'
  return (
    !!data.categoria_gasto && !!data.descripcion &&
    data.monto_servicio != null && data.monto_servicio >= 0 &&
    data.insumo_id == null && data.cantidad == null && data.galpon_id == null &&
    data.costo_insumo == null && data.flete == null
  );
}, {
  message: 'Los campos deben coincidir exactamente con el concepto seleccionado (insumo o servicio_otro), sin mezclar campos de ambas ramas — mismo criterio que chk_compras_rama_por_concepto en la base.',
  path: ['concepto'],
});


// ---------------------------------------------------------------------
// v6 (2026-09-23): venta de subproductos (Guano), tabla propia
// PECUARIO_VENTAS_SUBPRODUCTOS — migración
// 20260923110000_pecuario_venta_subproductos_guano.sql. Deliberadamente
// SIN los campos de VentaRegistroSchema que no aplican a un subproducto
// (animal_id/lote_id/precio_unitario/base_precio/etc.) — spec §2.2: "sin
// lote, sin reproductor, sin cantidad de animales, sin precio por
// unidad-animal".
// ---------------------------------------------------------------------

export const VentaSubproductoSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  producto: z.enum(['guano']).default('guano'),
  cantidad: z.number().positive(),
  unidad: z.enum(['sacos', 'kg']),
  precio_total: z.number().nonnegative().optional().nullable(), // opcional pero recomendado (spec §2.2)
  galpon_id: z.string().uuid().optional().nullable(), // solo informativo, nunca poza/lote
  comprador_nombre: z.string().max(150).optional().nullable(), // PII de un tercero: nunca a consola/log
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
});


// ---------------------------------------------------------------------
// v7 (2026-09-23): evidencia fotográfica en Mortalidad —
// PECUARIO_MORTALIDAD_FOTOS (una fila por foto) + bucket privado
// evidencias_pecuario — migración
// 20260923120000_pecuario_mortalidad_evidencia_fotografica.sql. Este
// schema valida la FILA que referencia la foto ya subida a Storage
// (storage_path), no el archivo en sí — la subida del binario al bucket
// es un paso aparte del cliente contra la API de Storage, no algo que
// Zod valide. Sin tope de cantidad por registro todavía (spec §5,
// pendiente de confirmar con Neyser/técnicos) — se aplicará acá cuando
// se confirme el número.
// ---------------------------------------------------------------------

export const MortalidadFotoSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  mortalidad_id: z.string().uuid(),
  storage_path: z.string().min(1), // {ID_Organizacion}/mortalidad/{mortalidad_id}/{filename}
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
});


// ---------------------------------------------------------------------
// v8 (2026-09-23): catálogo de actividades de Sanidad configurable por
// organización — PECUARIO_ACTIVIDADES_SANIDAD (catálogo) +
// PECUARIO_SANIDAD_REGISTROS (transaccional) — migración
// 20260923130000_pecuario_sanidad_actividades_configurables.sql.
// Reemplaza conceptualmente a los schemas de v2 que validan
// PECUARIO_CONTROL_SANITARIO/PECUARIO_LIMPIEZA_GALPON — esas tablas no se
// eliminaron (solo quedaron marcadas SUPERADA vía COMMENT ON), pero no
// deben usarse para código nuevo: cualquier pantalla nueva de Sanidad
// valida contra SanidadRegistroSchema.
//
// La validación cruzada "galpon_id obligatorio si la actividad es de
// alcance 'galpon', prohibido si es 'granja'" (spec §9, bug real ya visto
// en el mockup) NO se replica acá — requiere consultar el catálogo
// (actividad_id -> alcance), algo que Zod no resuelve sin una llamada
// async al backend. Esa guarda vive en la base de datos
// (trg_validar_sanidad_registro_galpon, BEFORE INSERT/UPDATE) como fuente
// de verdad única; el formulario debe repetir la misma regla en JS (ya
// conoce el alcance de la actividad seleccionada) para dar feedback
// inmediato, pero eso es lógica de UI, no de este contrato.
// ---------------------------------------------------------------------

export const SanidadActividadSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  nombre: z.string().min(1, 'El nombre de la actividad es requerido').max(100),
  alcance: z.enum(['granja', 'galpon']),
  frecuencia_dias: z.number().int().positive({ message: 'La frecuencia debe ser mayor a 0 días' }),
  activo: z.boolean().default(true),
});

export const SanidadRegistroSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  actividad_id: z.string().uuid(),
  galpon_id: z.string().uuid().optional().nullable(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  producto_usado: z.string().max(150).optional().nullable(),
  responsable: z.string().max(150).optional().nullable(),
  observaciones: z.string().optional().nullable(),
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
});

// ---------------------------------------------------------------------
// Traslado interno entre pozas/jaulas (Pecuario Cuyes) — 2026-09-24.
// "poza" y "jaula" son la misma tabla en el esquema real (PECUARIO_JAULAS)
// — por eso un solo campo destino_jaula_id, sea el traslado de un lote o
// de un reproductor.
//
// origen_jaula_id y lote_nuevo_id NO están en este schema a propósito —
// los calcula el trigger trg_procesar_traslado del lado del servidor
// (origen real del lote/animal, y el id del lote nuevo cuando
// alcance='parcial'); el cliente nunca los manda, así que no hay nada
// que validar de ellos acá.
//
// Las reglas cruzadas (tipo_origen <-> lote_id/animal_id, alcance solo
// para lote, cantidad+codigo_lote_nuevo obligatorios solo si
// alcance='parcial') sí se replican acá con .refine(), a diferencia de
// la guarda de Sanidad — acá todos los campos necesarios están en el
// mismo formulario/objeto de entrada, no hace falta consultar el
// catálogo de otra tabla como pasaba con actividad_id -> alcance.
// ---------------------------------------------------------------------

export const TrasladoRegistroSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  tipo_origen: z.enum(['lote', 'reproductor']),
  lote_id: z.string().uuid().optional().nullable(),
  animal_id: z.string().uuid().optional().nullable(),
  destino_jaula_id: z.string().uuid(),
  alcance: z.enum(['completo', 'parcial']).optional().nullable(),
  cantidad: z.number().int().positive().optional().nullable(),
  codigo_lote_nuevo: z.string().min(1).max(50).optional().nullable(),
  motivo_traslado: z.enum(['enfermedad_aislamiento', 'recomposicion_poza', 'sobrepoblacion', 'otro']),
  observaciones: z.string().optional().nullable(),
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
})
  .refine(
    (data) => data.tipo_origen !== 'lote' || (data.lote_id != null && data.animal_id == null),
    { message: 'Traslado de lote requiere lote_id y no debe traer animal_id', path: ['lote_id'] }
  )
  .refine(
    (data) => data.tipo_origen !== 'reproductor' || (data.animal_id != null && data.lote_id == null),
    { message: 'Traslado de reproductor requiere animal_id y no debe traer lote_id', path: ['animal_id'] }
  )
  .refine(
    (data) => data.tipo_origen !== 'lote' || data.alcance != null,
    { message: 'Traslado de lote requiere indicar alcance (completo/parcial)', path: ['alcance'] }
  )
  .refine(
    (data) => data.tipo_origen !== 'reproductor' || (data.alcance == null && data.cantidad == null && data.codigo_lote_nuevo == null),
    { message: 'Traslado de reproductor no debe traer alcance/cantidad/codigo_lote_nuevo', path: ['alcance'] }
  )
  .refine(
    (data) => data.alcance !== 'parcial' || (data.cantidad != null && data.cantidad > 0 && !!data.codigo_lote_nuevo),
    { message: 'Traslado parcial requiere cantidad > 0 y código del lote nuevo', path: ['cantidad'] }
  )
  .refine(
    (data) => data.alcance !== 'completo' || (data.cantidad == null && data.codigo_lote_nuevo == null),
    { message: 'Traslado completo no debe traer cantidad ni código de lote nuevo', path: ['cantidad'] }
  );

// ---------------------------------------------------------------------
// Destete: recolección semanal + conformación de lotes por sexo
// (Pecuario Cuyes) — 2026-09-25. Ver
// specs/pecuario_destete_recoleccion_semanal.md §10 y
// 20260925090000_pecuario_destete_recoleccion.sql.
//
// Dos fases persistentes: RecoleccionDestemteSchema valida el Paso 1
// (recolectar uno o más partos completos, sin sexar); el trigger
// trg_recoleccion_partos_validar es quien inserta la fila real por cada
// parto_id en PECUARIO_RECOLECCION_PARTOS con cantidad_incluida
// calculada del lado del servidor -- este schema solo valida la
// intención del Server Action (fecha + la lista de partos_ids
// elegidos), no una fila 1:1 de la tabla.
//
// ConformarLoteDestemteSchema valida el Paso 2 (repetible): un lote
// real, sexado, con recoleccion_origen_id apuntando a la recolección de
// origen. cantidad_inicial ≤ remanente disponible NO se valida acá a
// propósito -- depende de una consulta en vivo a la recolección (cuánto
// ya se asignó en otros lotes conformados antes), ese chequeo vive solo
// en trg_conformar_lote_destete (fuente de verdad única), mismo
// criterio que ya usa la guarda de Sanidad en este archivo (galpon_id
// según alcance de la actividad).
// ---------------------------------------------------------------------

export const RecoleccionDestemteSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  fecha_destete: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  partos_ids: z.array(z.string().uuid()).min(1, 'Seleccioná al menos un parto para recolectar'),
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
});

export const ConformarLoteDestemteSchema = z.object({
  id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
  recoleccion_origen_id: z.string().uuid(),
  codigo_lote: z.string().min(1).max(50),
  poza_actual_id: z.string().uuid(),
  sexo: z.enum(['macho', 'hembra']),
  cantidad_inicial: z.number().int().positive(),
  fecha_destete: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  device_id: z.string().min(1),
  created_offline_at: z.string().datetime(),
  pesaje: z.object({
    animales_muestreados: z.number().int().positive(),
    peso_total_muestra_g: z.number().positive(),
  }).optional().nullable(),
});

// v12 (2026-09-27): Reglas de reemplazo/descarte de reproductoras --
// migración 20260927090000_pecuario_reglas_reemplazo_reproductoras.sql.
// Ver specs/pecuario_reglas_reemplazo_reproductoras.md §5.
//
// Un solo schema para las dos acciones ("Confirmar descarte" e "Ignorar
// por ahora") -- misma forma exacta, difieren solo en qué Server Action
// las llama y en qué valor de `estado` escribe el UPDATE
// (confirmada/ignorada) sobre PECUARIO_SUGERENCIAS_REEMPLAZO. La spec
// pide reproductor_id (no un id de sugerencia puntual) porque ambas
// acciones son una decisión sobre EL ANIMAL, no sobre una regla
// específica -- el Server Action actualiza en bloque todas las
// sugerencias `pendiente` de ese reproductor (puede haber más de una
// simultánea, ver nota de diseño en la migración §3).
export const SugerenciaReemplazoAccionSchema = z.object({
  reproductor_id: z.string().uuid(),
  ID_Organizacion: IdOrganizacionSchema,
});

// Alta de Galpones/Pozas (app Granja Valencia,
// specs/app_granja_valencia_galpones_jaulas.md §3) -- primera pantalla de
// escritura de la app, contrato compartido (no exclusivo de la app) por
// mismo criterio que el resto de este archivo.
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

// vw_pecuario_poblacion_resumen (app Granja Valencia, pantalla Inicio,
// specs/app_granja_valencia_inicio.md) -- vista de solo lectura, tipos
// ajustados exactamente a las columnas reales de la vista (confirmadas
// en vivo), sin agregar ninguna de más.
export const PoblacionResumenSchema = z.object({
  ID_Organizacion: z.string(),
  total_poblacion: z.coerce.number().int().nonnegative(),
  total_reproductores: z.coerce.number().int().nonnegative(),
  total_recria: z.coerce.number().int().nonnegative(),
  total_engorde: z.coerce.number().int().nonnegative(),
  total_lactancia: z.coerce.number().int().nonnegative(),
})
export type PoblacionResumenValues = z.infer<typeof PoblacionResumenSchema>

// Alta de reproductor (app Granja Valencia, pantalla "Alta de
// reproductor", specs/app_granja_valencia_pozas_reproductores.md) --
// proposito/estado quedan en su default de tabla ('reproductor'/'activo'),
// no se envían acá.
export const SEXO_CUY = ['macho', 'hembra'] as const

export const ReproductorAltaSchema = z.object({
  ID_Organizacion: z.string().min(1),
  codigo_arete: z.string().trim().min(1, 'El código de arete es obligatorio.'),
  sexo: z.enum(SEXO_CUY),
  raza: z.string().trim().optional(),
  fecha_nacimiento: z.string().optional(),
  jaula_actual_id: z.string().uuid().nullable().optional(),
  madre_id: z.string().uuid().nullable().optional(),
  padre_id: z.string().uuid().nullable().optional(),
  advertencia_confirmada: z.boolean().default(false),
})
export type ReproductorAltaValues = z.infer<typeof ReproductorAltaSchema>

// Empadre: "Asignar macho a jaula" (app Granja Valencia,
// specs/app_granja_valencia_empadre.md) -- INSERT en
// PECUARIO_HISTORIAL_MACHOS. jaula_actual_id/PECUARIO_RETIROS_MACHO_PENDIENTES
// nunca se escriben desde el cliente -- los triggers reales
// (trg_historial_macho_efectos + trg_cerrar_historial_macho_anterior)
// se encargan.
export const EmpadreAsignacionSchema = z.object({
  ID_Organizacion: z.string().min(1),
  macho_id: z.string().uuid(),
  jaula_id: z.string().uuid(),
  fecha_entrada: z.string(),
  fecha_salida: z.string().nullable().optional(),
  advertencia_confirmada: z.boolean().default(false),
})
export type EmpadreAsignacionValues = z.infer<typeof EmpadreAsignacionSchema>

// Registrar parto (app Granja Valencia, specs/app_granja_valencia_parto.md)
// -- INSERT en PECUARIO_PARTOS, solo modo "Reproductora identificada"
// (madre_id obligatorio acá -- el modo poblacional del mockup queda
// fuera de esta pantalla, ver spec §1). macho_id se resuelve en el
// cliente contra PECUARIO_HISTORIAL_MACHOS antes de armar este objeto
// -- ningún trigger real lo completa solo (confirmado en vivo).
export const PartoRegistroSchema = z.object({
  ID_Organizacion: z.string().min(1),
  poza_id: z.string().uuid(),
  madre_id: z.string().uuid(),
  macho_id: z.string().uuid().nullable().optional(),
  fecha_parto: z.string(),
  n_vivos: z.coerce.number().int().nonnegative(),
  n_muertos: z.coerce.number().int().nonnegative(),
  peso_total_camada_g: z.coerce.number().int().positive().nullable().optional(),
  observaciones: z.string().trim().optional(),
})
export type PartoRegistroInput = z.infer<typeof PartoRegistroSchema>

// Destete (app Granja Valencia, specs/app_granja_valencia_destete.md) --
// 2 fases sobre el backend real ya construido (PECUARIO_RECOLECCIONES_DESTETE
// / PECUARIO_RECOLECCION_PARTOS / PECUARIO_LOTES, sin hotfixes, ver spec
// §0). Nota: ya existían RecoleccionDestemteSchema/ConformarLoteDestemteSchema
// más arriba en este archivo -- diseño especulativo de sync offline
// (id/device_id/created_offline_at obligatorios, partos_ids como array
// en un solo objeto), sin ningún consumidor real (confirmado por grep).
// Estos 4 son distintos a propósito -- shape 1:1 con cada INSERT real
// que hace esta pantalla, sin campos offline.
export const RecoleccionDesteteSchema = z.object({
  ID_Organizacion: z.string().min(1),
  fecha_destete: z.string(),
})
export type RecoleccionDesteteInput = z.infer<typeof RecoleccionDesteteSchema>

// Sin cantidad_incluida a propósito -- trg_recoleccion_partos_validar la
// fija siempre al remanente completo de vw_pecuario_lactancia_restante,
// nunca a lo que mande el cliente.
export const RecoleccionPartoSchema = z.object({
  ID_Organizacion: z.string().min(1),
  recoleccion_id: z.string().uuid(),
  parto_id: z.string().uuid(),
})
export type RecoleccionPartoInput = z.infer<typeof RecoleccionPartoSchema>

// Dominio propio, separado de SEXO_CUY -- un lote destetado nunca es
// 'mixto' (CHECK chk_lotes_destete_sexo_definido lo prohíbe cuando viene
// de Destete), pero conceptualmente es un dominio distinto al sexo de un
// reproductor individual.
export const SEXO_LOTE_DESTETE = ['macho', 'hembra'] as const

export const LoteDesteteSchema = z.object({
  ID_Organizacion: z.string().min(1),
  codigo_lote: z.string().trim().min(1, 'El código de lote es obligatorio.'),
  poza_actual_id: z.string().uuid(),
  cantidad_inicial: z.coerce.number().int().positive(),
  sexo: z.enum(SEXO_LOTE_DESTETE),
  recoleccion_origen_id: z.string().uuid(),
  fecha_destete: z.string(),
})
export type LoteDesteteInput = z.infer<typeof LoteDesteteSchema>

// App Granja Valencia — Registrar pesaje (specs/app_granja_valencia_pesaje.md).
// peso_promedio_g es GENERATED ALWAYS en la tabla real (confirmado en vivo,
// NO asumido) -- se valida acá para feedback en pantalla pero se excluye
// del payload del INSERT. ganancia_diaria_estimada_g NO es generada -- la
// calcula el cliente (o queda null si no hay pesaje anterior del lote).
export const PesajeSchema = z.object({
  ID_Organizacion: IdOrganizacionSchema,
  lote_id: z.string().uuid(),
  fecha_pesaje: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  animales_muestreados: z.number().int().positive({ message: 'Debe muestrear al menos 1 animal' }),
  peso_total_muestra_g: z.number().positive({ message: 'El peso debe ser mayor a 0' }),
  peso_promedio_g: z.number().positive(),
  ganancia_diaria_estimada_g: z.number().nullable(),
});
export type PesajeInput = z.infer<typeof PesajeSchema>;

// App Granja Valencia — Registrar traslado (specs/app_granja_valencia_traslado.md).
// Nombre nuevo a propósito, NO TrasladoRegistroSchema: ese ya existe y
// tiene un consumidor real activo (tests/test_pecuario_traslado_interno.py
// ::TestZodContract, que parsea este archivo de forma estática y falla
// si el nombre o sus 3 .refine() exactos cambian) -- no se toca. Además
// exige id/device_id/created_offline_at (diseño de sync offline que
// ninguna pantalla de esta app usa), así que tampoco encaja tal cual
// para este INSERT online-first. origen_jaula_id y lote_nuevo_id no
// están acá -- los resuelve trg_procesar_traslado del lado del servidor
// (confirmado leyendo la función real).
export const TrasladoSchema = z.object({
  ID_Organizacion: IdOrganizacionSchema,
  tipo_origen: z.enum(['lote', 'reproductor']),
  lote_id: z.string().uuid().optional().nullable(),
  animal_id: z.string().uuid().optional().nullable(),
  destino_jaula_id: z.string().uuid(),
  alcance: z.enum(['completo', 'parcial']).optional().nullable(),
  cantidad: z.number().int().positive().optional().nullable(),
  codigo_lote_nuevo: z.string().min(1).max(50).optional().nullable(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  motivo_traslado: z.enum(['enfermedad_aislamiento', 'recomposicion_poza', 'sobrepoblacion', 'otro']),
  observaciones: z.string().max(500).optional().nullable(),
})
  .refine((d) => d.tipo_origen !== 'lote' || (d.lote_id != null && d.animal_id == null), {
    message: 'Traslado de lote requiere lote_id y no debe traer animal_id', path: ['lote_id'],
  })
  .refine((d) => d.tipo_origen !== 'reproductor' || (d.animal_id != null && d.lote_id == null), {
    message: 'Traslado de reproductor requiere animal_id y no debe traer lote_id', path: ['animal_id'],
  })
  .refine((d) => d.tipo_origen !== 'lote' || d.alcance != null, {
    message: 'Traslado de lote requiere indicar alcance (completo/parcial)', path: ['alcance'],
  })
  .refine((d) => d.tipo_origen !== 'reproductor' || (d.alcance == null && d.cantidad == null && d.codigo_lote_nuevo == null), {
    message: 'Traslado de reproductor no debe traer alcance/cantidad/codigo_lote_nuevo', path: ['alcance'],
  })
  .refine((d) => d.alcance !== 'parcial' || (d.cantidad != null && d.cantidad > 0 && !!d.codigo_lote_nuevo), {
    message: 'Traslado parcial requiere cantidad > 0 y código del lote nuevo', path: ['cantidad'],
  })
  .refine((d) => d.alcance !== 'completo' || (d.cantidad == null && d.codigo_lote_nuevo == null), {
    message: 'Traslado completo no debe traer cantidad ni código de lote nuevo', path: ['cantidad'],
  });
export type TrasladoInput = z.infer<typeof TrasladoSchema>;

// App Granja Valencia — Registrar venta (specs/app_granja_valencia_venta.md).
// Nombres nuevos a propósito, NI VentaRegistroSchema NI VentaSubproductoSchema:
// ambos ya existen y tienen consumidores reales activos (varios tests en
// tests/test_pecuario_venta_pelado_beneficiado.py y
// tests/test_pecuario_venta_subproductos_guano.py parsean este archivo de
// forma estática) -- no se tocan. Ambos exigen además
// id/device_id/created_offline_at (diseño de sync offline que ninguna
// pantalla de esta app usa), así que tampoco encajan tal cual para un
// INSERT online-first real.
//
// VentaAnimalSchema mirror-ea exactamente las mismas reglas cruzadas
// reales de VentaRegistroSchema (XOR lote_id/animal_id, cantidad=1 en
// venta individual, base_precio coherente con tipo_salida) sin los
// campos offline. rendimiento_carcasa_pct NO está acá -- es GENERATED,
// nunca se manda. precio_total SÍ es obligatorio (columna NOT NULL
// real, confirmado en vivo) -- pero su valor depende del camino
// (ver spec §0): si hay precio_unitario o (base_precio='por_kg', que
// siempre trae peso_total_kg+precio_kg), trg_calcular_precio_total_venta
// lo recalcula igual y pisa lo que se mande; si precio_unitario es null
// y base_precio='por_animal', el trigger NO toca precio_total -- el
// valor que se manda acá es el que queda guardado tal cual (modo
// "acordar un total directo", real y soportado, confirmado leyendo
// fn_calcular_precio_total_venta).
export const VentaAnimalSchema = z.object({
  ID_Organizacion: IdOrganizacionSchema,
  lote_id: z.string().uuid().optional().nullable(),
  animal_id: z.string().uuid().optional().nullable(),
  fecha_venta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  tipo_salida: z.enum(['carne', 'pie_cria', 'reproductor_saca', 'pelado_beneficiado']),
  cantidad: z.number().int().positive(),
  precio_unitario: z.number().nonnegative().optional().nullable(),
  peso_total_kg: z.number().positive().optional().nullable(),
  precio_total: z.number().nonnegative(),
  comprador_nombre: z.string().max(150).optional().nullable(), // PII de un tercero: nunca a consola/log
  base_precio: z.enum(['por_animal', 'por_kg']).default('por_animal'),
  precio_kg: z.number().nonnegative().optional().nullable(),
  peso_vivo_pre_beneficio_kg: z.number().positive().optional().nullable(),
})
  .refine((d) => !!d.animal_id !== !!d.lote_id, {
    message: 'Debe indicar un animal identificado O un lote, no ambos ni ninguno.', path: ['animal_id'],
  })
  .refine((d) => !d.animal_id || d.cantidad === 1, {
    message: 'La venta de un animal identificado es siempre de cantidad 1.', path: ['cantidad'],
  })
  .refine((d) => d.base_precio === 'por_animal' || d.tipo_salida === 'pelado_beneficiado', {
    message: 'La base de precio "por kilogramo" solo aplica a ventas de tipo Pelado (beneficiado).', path: ['base_precio'],
  })
  .refine((d) => d.base_precio !== 'por_kg' || (d.peso_total_kg != null && d.precio_kg != null), {
    message: 'Con base de precio "por kilogramo", el peso total pelado y el precio por kg son obligatorios.', path: ['precio_kg'],
  })
  .refine((d) => d.base_precio !== 'por_animal' || d.precio_kg == null, {
    message: 'Con base de precio "por animal", no debe enviarse precio_kg.', path: ['precio_kg'],
  });
export type VentaAnimalInput = z.infer<typeof VentaAnimalSchema>;

// Venta de subproductos (Guano) -- PECUARIO_VENTAS_SUBPRODUCTOS, tabla
// independiente sin FK hacia lotes/reproductores/PECUARIO_VENTAS
// (confirmado en el recon). Sin triggers reales sobre esta tabla.
export const VentaGuanoSchema = z.object({
  ID_Organizacion: IdOrganizacionSchema,
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  producto: z.literal('guano').default('guano'),
  cantidad: z.number().positive(),
  unidad: z.enum(['sacos', 'kg']),
  precio_total: z.number().nonnegative().optional().nullable(),
  galpon_id: z.string().uuid().optional().nullable(),
  comprador_nombre: z.string().max(150).optional().nullable(), // PII de un tercero: nunca a consola/log
});
export type VentaGuanoInput = z.infer<typeof VentaGuanoSchema>;

// App Granja Valencia — Registrar mortalidad (specs/app_granja_valencia_mortalidad.md).
// Nombre nuevo, sin tocar los existentes:
// - MortalidadRegistroSchema ya existía (diseño especulativo de sync
//   offline, id/device_id/created_offline_at obligatorios) -- cero
//   consumidores reales (confirmado por grep), sin colisión de nombre
//   forzada por esta tarea, se deja intacto y coexistiendo (mismo
//   criterio que PesajeLoteSchema).
// - MortalidadFotoSchema ya existía y SÍ tiene un consumidor real
//   activo (tests/test_pecuario_mortalidad_fotos.py, que parsea este
//   archivo de forma estática) y exige los mismos campos offline -- no
//   se toca, se usa MortalidadFotoInsertSchema para el INSERT real.
// trg_dar_baja_animal_por_mortalidad solo actúa si animal_id IS NOT
// NULL (mismo gap que fn_dar_baja_animal_por_venta) -- si el origen es
// un lote, el cliente hace el UPDATE explícito de cantidad_actual.
export const MortalidadSchema = z.object({
  ID_Organizacion: IdOrganizacionSchema,
  poza_id: z.string().uuid().optional().nullable(),
  lote_id: z.string().uuid().optional().nullable(),
  animal_id: z.string().uuid().optional().nullable(),
  fecha_evento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato debe ser YYYY-MM-DD'),
  cantidad: z.number().int().positive(),
  etapa: z.enum(['lactancia', 'recria', 'engorde', 'reproductor']),
  causa: z.enum(['neumonia', 'distocia', 'aplastamiento', 'gastroenteritis', 'depredador', 'desconocido', 'otro']).default('desconocido'),
  descripcion_sintomas: z.string().max(500).optional().nullable(),
})
  .refine((d) => !!d.animal_id !== (!!d.lote_id || !!d.poza_id), {
    message: 'Debe indicar un animal identificado O un lote/poza, no ambos ni ninguno.', path: ['animal_id'],
  })
  .refine((d) => !d.animal_id || d.cantidad === 1, {
    message: 'La mortalidad de un animal identificado es siempre de cantidad 1.', path: ['cantidad'],
  });
export type MortalidadInput = z.infer<typeof MortalidadSchema>;

export const MortalidadFotoInsertSchema = z.object({
  ID_Organizacion: IdOrganizacionSchema,
  mortalidad_id: z.string().uuid(),
  storage_path: z.string().min(1),
});
export type MortalidadFotoInsertInput = z.infer<typeof MortalidadFotoInsertSchema>;

export type SanidadActividadInput = z.infer<typeof SanidadActividadSchema>;
export type SanidadRegistroInput = z.infer<typeof SanidadRegistroSchema>;
export type TrasladoRegistroInput = z.infer<typeof TrasladoRegistroSchema>;
export type MortalidadFotoInput = z.infer<typeof MortalidadFotoSchema>;
export type PartoOfflineDraftInput = z.infer<typeof PartoOfflineDraftSchema>;
export type MortalidadRegistroInput = z.infer<typeof MortalidadRegistroSchema>;
export type PesajeLoteInput = z.infer<typeof PesajeLoteSchema>;
export type VentaRegistroInput = z.infer<typeof VentaRegistroSchema>;
export type ControlSanitarioInput = z.infer<typeof ControlSanitarioSchema>;
export type LimpiezaGalponInput = z.infer<typeof LimpiezaGalponSchema>;
export type InsumoInput = z.infer<typeof InsumoSchema>;
export type MovimientoInsumoInput = z.infer<typeof MovimientoInsumoSchema>;
export type ReproductorInput = z.infer<typeof ReproductorSchema>;
export type HistorialMachoInput = z.infer<typeof HistorialMachoSchema>;
export type TratamientoInput = z.infer<typeof TratamientoSchema>;
export type CompraInput = z.infer<typeof CompraSchema>;
export type VentaSubproductoInput = z.infer<typeof VentaSubproductoSchema>;
export type RecoleccionDestemteInput = z.infer<typeof RecoleccionDestemteSchema>;
export type ConformarLoteDestemteInput = z.infer<typeof ConformarLoteDestemteSchema>;
export type SugerenciaReemplazoAccionInput = z.infer<typeof SugerenciaReemplazoAccionSchema>;