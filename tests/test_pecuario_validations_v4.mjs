// Test de lib/validations/pecuario.ts (VentaRegistroSchema, InsumoSchema) --
// contrato v4 del módulo Pecuario Cuyes.
//
// PRECEDENTE NUEVO en este repo: pecuario.ts es el primer archivo .ts real
// del proyecto (CLAUDE.md documenta que el resto del código -- app/,
// components/, lib/ -- es JS plano a propósito, sin TypeScript). Existe
// porque es el contrato de datos para la futura app móvil Expo/React
// Native de Granja Valencia, que si usará TypeScript -- no es una
// excepción accidental. Node 22+ soporta importar .ts directo (type
// stripping nativo, sin ts-node/tsx/build step) -- confirmado funcionando
// en este entorno (Node v24). `node --test tests/*.mjs` ya recoge este
// archivo igual que el resto (mismo patrón que los 11 archivos .mjs que
// CLAUDE.md documenta, "no wired a CI").
//
// Ver specs/pecuario_identificacion_individual.md, "Actualización
// 2026-09-11 (tarde) -- ajustes de campo v4", y
// supabase/migrations/20260911180000_pecuario_ventas_insumos_ajustes.sql.

import test from 'node:test';
import assert from 'node:assert/strict';
import { VentaRegistroSchema, InsumoSchema } from '../lib/validations/pecuario.ts';

const BASE_VENTA = {
  id: '11111111-1111-1111-1111-111111111111',
  ID_Organizacion: 'ORG-TEST-DEMO',
  fecha_venta: '2026-03-15',
  tipo_salida: 'reproductor_saca',
  precio_total: 25,
  device_id: 'device-test',
  created_offline_at: '2026-03-15T10:00:00.000Z',
};

test('VentaRegistroSchema rechaza animal_id con cantidad != 1', () => {
  const result = VentaRegistroSchema.safeParse({
    ...BASE_VENTA,
    animal_id: '22222222-2222-2222-2222-222222222222',
    cantidad: 2,
  });
  assert.equal(result.success, false);
  const cantidadIssue = result.error.issues.find((i) => i.path.includes('cantidad'));
  assert.ok(cantidadIssue, 'debe reportar el error en el campo cantidad');
});

test('VentaRegistroSchema acepta animal_id con cantidad = 1', () => {
  const result = VentaRegistroSchema.safeParse({
    ...BASE_VENTA,
    animal_id: '22222222-2222-2222-2222-222222222222',
    cantidad: 1,
  });
  assert.equal(result.success, true);
});

test('VentaRegistroSchema acepta lote_id con cantidad > 1 (venta poblacional, sin restricción)', () => {
  const result = VentaRegistroSchema.safeParse({
    ...BASE_VENTA,
    lote_id: '33333333-3333-3333-3333-333333333333',
    cantidad: 15,
  });
  assert.equal(result.success, true);
});

test('VentaRegistroSchema acepta precio_unitario opcional junto a cantidad/precio_total', () => {
  const result = VentaRegistroSchema.safeParse({
    ...BASE_VENTA,
    animal_id: '22222222-2222-2222-2222-222222222222',
    cantidad: 1,
    precio_unitario: 25,
  });
  assert.equal(result.success, true);
});

test('VentaRegistroSchema sigue exigiendo exactamente uno de animal_id/lote_id (v3, sin regresión)', () => {
  const ninguno = VentaRegistroSchema.safeParse({ ...BASE_VENTA, cantidad: 1 });
  const ambos = VentaRegistroSchema.safeParse({
    ...BASE_VENTA,
    animal_id: '22222222-2222-2222-2222-222222222222',
    lote_id: '33333333-3333-3333-3333-333333333333',
    cantidad: 1,
  });
  assert.equal(ninguno.success, false);
  assert.equal(ambos.success, false);
});

const BASE_INSUMO = {
  id: '44444444-4444-4444-4444-444444444444',
  ID_Organizacion: 'ORG-TEST-DEMO',
  nombre: 'Ivermectina',
};

test('InsumoSchema acepta las categorias nuevas de v4 (medicamento, vitamina, material)', () => {
  for (const categoria of ['medicamento', 'vitamina', 'material']) {
    const result = InsumoSchema.safeParse({ ...BASE_INSUMO, categoria, unidad_medida: 'ml' });
    assert.equal(result.success, true, `categoria=${categoria} debería ser válida`);
  }
});

test('InsumoSchema ya no acepta "cama" como categoria (renombrada a material en v4)', () => {
  const result = InsumoSchema.safeParse({ ...BASE_INSUMO, categoria: 'cama', unidad_medida: 'kg' });
  assert.equal(result.success, false);
});

test('InsumoSchema exige unidad_medida del enum fijo, rechaza texto libre', () => {
  const result = InsumoSchema.safeParse({ ...BASE_INSUMO, unidad_medida: 'kilogramos-sueltos' });
  assert.equal(result.success, false);
});

test('InsumoSchema acepta las 7 unidades de v4', () => {
  for (const unidad of ['kg', 'g', 'litro', 'ml', 'unidad', 'saco_50kg', 'saco_40kg']) {
    const result = InsumoSchema.safeParse({ ...BASE_INSUMO, unidad_medida: unidad });
    assert.equal(result.success, true, `unidad_medida=${unidad} debería ser válida`);
  }
});

test('InsumoSchema acepta stock_inicial opcional (campo solo-UI, no persiste tal cual)', () => {
  const conStock = InsumoSchema.safeParse({ ...BASE_INSUMO, stock_inicial: 10 });
  const sinStock = InsumoSchema.safeParse({ ...BASE_INSUMO });
  assert.equal(conStock.success, true);
  assert.equal(sinStock.success, true);
});
