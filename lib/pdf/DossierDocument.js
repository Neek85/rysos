// Plantilla del Dossier Comercial EUDR — port de scripts/generate_dossier_pdf.py
// (DossierPDFGenerator.build_pdf_dossier) a @react-pdf/renderer, más una
// sección nueva de mapa/geometría de las parcelas (ver lib/pdf/geometryToSvg.js)
// pedida en esta tarea que el original en Python no tenía.
//
// NO usa sintaxis JSX (React.createElement directo) a propósito: Node no
// puede parsear JSX sin un transpilador, y este proyecto no tiene ninguno
// configurado para tests (confirmado — no hay Babel/SWC fuera del propio
// build de Next.js). Escribirlo así permite testear el pipeline completo
// de generación de PDF con `node --test` (ver tests/test_pdf_dossier.mjs)
// sin agregar ninguna dependencia de testing nueva. Es la única excepción
// de estilo a JSX en este repo — deliberada, no un descuido.
//
// DECISIÓN CONFIRMADA CON EL USUARIO: este Dossier es público
// (/trace/[lot_hash], sin autenticación) — NO incluye ningún dato del
// módulo de Inspecciones FED (INSPECCIONES/CAP_*), que contiene PII real
// (DNI, nombre completo, salud, salarios) y cuyas políticas RLS para
// `anon` no filtran esos campos (fueron diseñadas para el formulario
// interno, no para consumo público). Ver specs/pdf_dossier_native_js.md.

import React from 'react'
import { Document, Page, View, Text, Image, Svg, Polygon, Circle, StyleSheet } from '@react-pdf/renderer'
import { projectFeaturesToSvgShapes } from './geometryToSvg.js'

const h = React.createElement

const MAP_WIDTH = 480
const MAP_HEIGHT = 240

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: 'Helvetica', color: '#111827' },
  title: { fontSize: 15, color: '#1E3A8A', marginBottom: 10, fontFamily: 'Helvetica-Bold' },
  label: { fontFamily: 'Helvetica-Bold' },
  hash: { color: '#2563EB' },
  sectionTitle: { fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 4 },
  table: { borderWidth: 0.5, borderColor: '#9CA3AF', marginTop: 4 },
  tableHeaderRow: { flexDirection: 'row', backgroundColor: '#1E3A8A' },
  tableRow: { flexDirection: 'row', borderTopWidth: 0.5, borderColor: '#9CA3AF' },
  tableCellHeader: { flex: 1, padding: 4, color: '#FFFFFF', fontFamily: 'Helvetica-Bold', fontSize: 9 },
  tableCell: { flex: 1, padding: 4, fontSize: 9 },
  mapBox: { borderWidth: 0.5, borderColor: '#D1D5DB', alignItems: 'center', padding: 4 },
  mapEmpty: { fontSize: 8, color: '#9CA3AF', textAlign: 'center', padding: 20 },
  qrBox: { alignItems: 'center', marginTop: 4 },
  qrImage: { width: 100, height: 100 },
  qrUrl: { fontSize: 7, color: '#6B7280', marginTop: 2 },
  legal: { fontSize: 9, marginTop: 2, lineHeight: 1.4 },
  footer: { fontSize: 7, color: '#9CA3AF', marginTop: 18, textAlign: 'center' },
})

function summaryRow(label, value) {
  return h(
    View,
    { style: styles.tableRow },
    h(Text, { style: styles.tableCell }, label),
    h(Text, { style: styles.tableCell }, value)
  )
}

function renderMap(features) {
  const shapes = projectFeaturesToSvgShapes(features, { width: MAP_WIDTH, height: MAP_HEIGHT })

  if (shapes.length === 0) {
    return h(View, { style: styles.mapBox }, h(Text, { style: styles.mapEmpty }, 'Sin geometría disponible para este lote.'))
  }

  const shapeElements = []
  shapes.forEach((shape, i) => {
    if (shape.type === 'polygon') {
      shapeElements.push(
        h(Polygon, {
          key: `p-${i}`,
          points: shape.points.map(([x, y]) => `${x},${y}`).join(' '),
          stroke: '#15803d',
          strokeWidth: 1,
          fill: '#22c55e',
          fillOpacity: 0.35,
        })
      )
    } else if (shape.type === 'multipolygon') {
      shape.polygons.forEach((points, j) => {
        shapeElements.push(
          h(Polygon, {
            key: `mp-${i}-${j}`,
            points: points.map(([x, y]) => `${x},${y}`).join(' '),
            stroke: '#15803d',
            strokeWidth: 1,
            fill: '#22c55e',
            fillOpacity: 0.35,
          })
        )
      })
    } else if (shape.type === 'point') {
      shapeElements.push(
        h(Circle, { key: `pt-${i}`, cx: shape.cx, cy: shape.cy, r: 4, fill: '#15803d', stroke: '#ffffff', strokeWidth: 1 })
      )
    }
  })

  return h(
    View,
    { style: styles.mapBox },
    h(Svg, { width: MAP_WIDTH, height: MAP_HEIGHT }, ...shapeElements)
  )
}

export default function DossierDocument({ lote, qrDataUrl }) {
  const totalHectares = Number(lote?.total_hectares ?? 0).toFixed(2)

  return h(
    Document,
    null,
    h(
      Page,
      { size: 'LETTER', style: styles.page },
      h(Text, { style: styles.title }, 'EXPEDIENTE AUDITABLE DE CUMPLIMIENTO EUDR (UE 2023/1115)'),
      h(Text, null, h(Text, { style: styles.label }, 'Organización: '), lote?.organization_id || ''),
      h(
        Text,
        null,
        h(Text, { style: styles.label }, 'Hash Único de Lote: '),
        h(Text, { style: styles.hash }, lote?.lot_hash || '')
      ),

      h(
        View,
        { style: styles.table },
        h(
          View,
          { style: styles.tableHeaderRow },
          h(Text, { style: styles.tableCellHeader }, 'Métrica'),
          h(Text, { style: styles.tableCellHeader }, 'Valor')
        ),
        summaryRow('Total de Parcelas Aprobadas', String(lote?.total_plots ?? 0)),
        summaryRow('Hectáreas Totales Monitoreadas', `${totalHectares} ha`),
        summaryRow('Normativa de Referencia', lote?.regulation || 'EU 2023/1115'),
        summaryRow('Estatus Deforestación Cero', 'VERIFICADO (Post-31/12/2020)')
      ),

      h(Text, { style: styles.sectionTitle }, 'Mapa de Parcelas de Origen (esquemático):'),
      renderMap(lote?.geojson?.features),

      qrDataUrl &&
        h(
          View,
          { style: styles.qrBox },
          h(Text, { style: styles.sectionTitle }, 'Código QR de Verificación Pública e Inmutable:'),
          h(Image, { src: qrDataUrl, style: styles.qrImage }),
          h(Text, { style: styles.qrUrl }, lote?.verification_url || '')
        ),

      h(Text, { style: styles.sectionTitle }, 'Declaración de Deforestación Cero y Conformidad Legal:'),
      h(
        Text,
        { style: styles.legal },
        'Se certifica que las materias primas asociadas a este lote provienen de parcelas ' +
          'agrícolas que no han sido objeto de deforestación ni degradación forestal posterior ' +
          'al 31 de diciembre de 2020, cumpliendo estrictamente con la legislación nacional del ' +
          'país de origen y la normativa europea UE 2023/1115.'
      ),

      h(
        Text,
        { style: styles.footer },
        'Este certificado no contiene datos personales identificables. Generado por RYZOS.'
      )
    )
  )
}
