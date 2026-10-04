// Compras -- specs/pecuario_compras_gastos.md. Listado de compras recientes
// (lo ven los 3 roles: la RLS de SELECT está abierta a la organización) y
// formulario "Nueva compra" (solo admin: ocultar el botón por rol es
// cosmético, la barrera real es la RLS de INSERT). Dos ramas excluyentes según
// `concepto`, validadas con CompraSchema. `monto_total` es una columna GENERADA
// en la base: acá solo se muestra el total calculado, nunca se envía. Una
// compra de insumo genera sola la entrada de stock (trigger
// fn_compra_genera_entrada_insumo), con el galpon_id de la compra.
import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import * as Crypto from 'expo-crypto'
import { CompraSchema } from '../../../../../../lib/validations/pecuario'
import { supabase } from '../../../../lib/supabase/client'
import { useProfile } from '../../../../lib/supabase/useProfile'
import { useThemeColors } from '../../../../theme/useThemeColors'
import { BackToInicioButton } from '../../../../components/ui/BackToInicioButton'
import { Chip } from '../../../../components/ui/Chip'

type Concepto = 'insumo' | 'servicio_otro'
type CategoriaGasto = 'combustible' | 'mantenimiento_reparaciones' | 'servicio_veterinario_tecnico' | 'mano_obra' | 'otro'

type Compra = {
  id: string
  fecha: string
  proveedor: string | null
  concepto: Concepto
  categoria_gasto: CategoriaGasto | null
  descripcion: string | null
  insumo_id: string | null
  cantidad: number | null
  monto_total: number | null
  comprobante: string | null
}
type Insumo = { id: string; nombre: string; unidad_medida: string; activo: boolean | null }
type Galpon = { id: string; codigo_galpon: string; nombre: string | null }

const CATEGORIAS: { valor: CategoriaGasto; label: string }[] = [
  { valor: 'combustible', label: 'Combustible' },
  { valor: 'mantenimiento_reparaciones', label: 'Mantenimiento y reparaciones' },
  { valor: 'servicio_veterinario_tecnico', label: 'Servicio veterinario/técnico' },
  { valor: 'mano_obra', label: 'Mano de obra' },
  { valor: 'otro', label: 'Otro' },
]
const CATEGORIA_LABEL: Record<string, string> = Object.fromEntries(CATEGORIAS.map((c) => [c.valor, c.label]))

const UNIDAD_LABEL: Record<string, string> = {
  kg: 'kg', g: 'g', litro: 'litro', ml: 'ml', unidad: 'unidad', saco_50kg: 'saco 50kg', saco_40kg: 'saco 40kg',
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10)
}

function esFechaValida(f: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return false
  const d = new Date(`${f}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f
}

// Acepta coma decimal ("12,5"); vacío -> null, no numérico -> NaN.
function parseNumero(texto: string): number | null {
  const t = texto.trim().replace(',', '.')
  if (t === '') return null
  return Number(t)
}

function redondear(n: number) {
  return Math.round(n * 100) / 100
}

function soles(n: number | null | undefined) {
  return n == null ? '—' : `S/ ${redondear(Number(n)).toFixed(2)}`
}

export default function ComprasScreen() {
  const colors = useThemeColors()
  const { organizacion, rol } = useProfile()
  const esAdmin = rol === 'admin'

  const [cargando, setCargando] = useState(true)
  const [compras, setCompras] = useState<Compra[]>([])
  const [insumos, setInsumos] = useState<Insumo[]>([])
  const [galpones, setGalpones] = useState<Galpon[]>([])

  const [formAbierto, setFormAbierto] = useState(false)
  const [fecha, setFecha] = useState(hoyISO())
  const [proveedor, setProveedor] = useState('')
  const [comprobante, setComprobante] = useState('')
  const [concepto, setConcepto] = useState<Concepto>('insumo')

  // Rama insumo
  const [insumoId, setInsumoId] = useState<string | null>(null)
  const [cantidad, setCantidad] = useState('')
  const [galponId, setGalponId] = useState<string | null>(null)
  const [costo, setCosto] = useState('')
  const [flete, setFlete] = useState('')

  // Rama servicio
  const [categoria, setCategoria] = useState<CategoriaGasto>('combustible')
  const [descripcion, setDescripcion] = useState('')
  const [montoServicio, setMontoServicio] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [guardadoOk, setGuardadoOk] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  // El id de la compra se genera UNA vez por intento de guardado y se reutiliza
  // si el INSERT falla (p. ej. por conexión) y el contenido NO cambió: así un
  // reintento no duplica la compra ni su entrada de stock (la PK rechaza el
  // segundo INSERT con 23505). Si el usuario edita algo, se genera un id nuevo.
  const idPendiente = useRef<{ id: string; firma: string } | null>(null)

  const cargar = useCallback(() => {
    if (!organizacion) return
    setCargando(true)
    Promise.all([
      supabase
        .from('PECUARIO_COMPRAS')
        .select('id, fecha, proveedor, concepto, categoria_gasto, descripcion, insumo_id, cantidad, monto_total, comprobante')
        .eq('ID_Organizacion', organizacion)
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50),
      supabase.from('PECUARIO_INSUMOS').select('id, nombre, unidad_medida, activo').eq('ID_Organizacion', organizacion).order('nombre'),
      supabase.from('PECUARIO_GALPONES').select('id, codigo_galpon, nombre').eq('ID_Organizacion', organizacion).order('codigo_galpon'),
    ]).then(([comprasRes, insumosRes, galponesRes]) => {
      setCompras(
        ((comprasRes.data ?? []) as Compra[]).map((c) => ({
          ...c,
          cantidad: c.cantidad == null ? null : Number(c.cantidad),
          monto_total: c.monto_total == null ? null : Number(c.monto_total),
        }))
      )
      setInsumos((insumosRes.data ?? []) as Insumo[])
      setGalpones((galponesRes.data ?? []) as Galpon[])
      setCargando(false)
    })
  }, [organizacion])

  useFocusEffect(cargar)

  const insumosActivos = insumos.filter((i) => i.activo !== false)
  const insumoSel = insumosActivos.find((i) => i.id === insumoId) ?? null
  const unidadSel = insumoSel ? UNIDAD_LABEL[insumoSel.unidad_medida] ?? insumoSel.unidad_medida : null

  const cantidadNum = parseNumero(cantidad)
  const costoNum = parseNumero(costo)
  const fleteNum = parseNumero(flete)
  const totalInsumo = costoNum != null && !Number.isNaN(costoNum) ? redondear(costoNum + (fleteNum != null && !Number.isNaN(fleteNum) ? fleteNum : 0)) : null
  const costoUnitario =
    costoNum != null && !Number.isNaN(costoNum) && cantidadNum != null && !Number.isNaN(cantidadNum) && cantidadNum > 0
      ? redondear(costoNum / cantidadNum)
      : null

  function limpiarEstado() {
    setError(null)
    setGuardadoOk(null)
  }

  function nombreInsumo(id: string | null) {
    return insumos.find((i) => i.id === id)?.nombre ?? 'Insumo'
  }

  function resetForm() {
    setProveedor('')
    setComprobante('')
    setCantidad('')
    setCosto('')
    setFlete('')
    setDescripcion('')
    setMontoServicio('')
    idPendiente.current = null
    // Insumo, galpón, categoría y fecha quedan pegajosos: es común cargar varias
    // líneas seguidas de la misma compra.
  }

  async function handleGuardar() {
    limpiarEstado()
    if (!organizacion || !esAdmin) return
    if (!esFechaValida(fecha)) {
      setError('Ingresá una fecha válida (AAAA-MM-DD).')
      return
    }

    const comunes = {
      ID_Organizacion: organizacion,
      fecha,
      proveedor: proveedor.trim() || null,
      concepto,
      comprobante: comprobante.trim() || null,
    }
    let candidato: Record<string, unknown>

    if (concepto === 'insumo') {
      if (!insumoSel) {
        setError('Elegí un insumo.')
        return
      }
      if (cantidadNum == null || Number.isNaN(cantidadNum) || cantidadNum <= 0) {
        setError('Ingresá la cantidad comprada (mayor a 0).')
        return
      }
      if (!galponId) {
        setError('Elegí el galpón de destino.')
        return
      }
      if (costoNum == null || Number.isNaN(costoNum) || costoNum <= 0) {
        setError('Ingresá el costo del insumo (mayor a 0).')
        return
      }
      if (fleteNum != null && (Number.isNaN(fleteNum) || fleteNum < 0)) {
        setError('El flete debe ser un número mayor o igual a 0.')
        return
      }
      candidato = {
        ...comunes,
        insumo_id: insumoSel.id,
        cantidad: cantidadNum,
        galpon_id: galponId,
        costo_insumo: costoNum,
        flete: fleteNum,
        categoria_gasto: null,
        descripcion: null,
        monto_servicio: null,
      }
    } else {
      const monto = parseNumero(montoServicio)
      if (!descripcion.trim()) {
        setError('Ingresá la descripción del gasto.')
        return
      }
      if (monto == null || Number.isNaN(monto) || monto < 0) {
        setError('Ingresá el monto del servicio (número mayor o igual a 0).')
        return
      }
      candidato = {
        ...comunes,
        categoria_gasto: categoria,
        descripcion: descripcion.trim(),
        monto_servicio: monto,
        insumo_id: null,
        cantidad: null,
        galpon_id: null,
        costo_insumo: null,
        flete: null,
      }
    }

    const firma = JSON.stringify(candidato)
    if (!idPendiente.current || idPendiente.current.firma !== firma) {
      idPendiente.current = { id: Crypto.randomUUID(), firma }
    }
    const parsed = CompraSchema.safeParse({
      ...candidato,
      id: idPendiente.current.id,
      // Hora del dispositivo al capturar la compra (el patrón offline-first del
      // proyecto); device_id queda sin completar: la app no tiene todavía una
      // fuente de identificador de dispositivo.
      created_offline_at: new Date().toISOString(),
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos.')
      return
    }

    setGuardando(true)
    try {
      const { error: insertError } = await supabase.from('PECUARIO_COMPRAS').insert(parsed.data)
      // 23505 con nuestro propio id = un intento anterior sí llegó a la base
      // aunque la respuesta se perdió: se trata como guardado, no como error.
      if (insertError && insertError.code !== '23505') {
        setError(traducirError(insertError.code, insertError.message))
        return
      }
      const total = concepto === 'insumo' ? totalInsumo : parseNumero(montoServicio)
      setGuardadoOk(
        concepto === 'insumo' && insumoSel
          ? `Compra registrada: ${nombreInsumo(insumoSel.id)} · ${cantidadNum} ${unidadSel} · total ${soles(total)}. Se generó la entrada en Insumos. ✓`
          : `Gasto registrado: ${CATEGORIA_LABEL[categoria]} · ${soles(total)}. ✓`
      )
      resetForm()
      cargar()
    } finally {
      setGuardando(false)
    }
  }

  function traducirError(code: string | undefined, message: string) {
    if (code === '42501' || /row-level security/i.test(message)) return 'Solo el administrador puede registrar compras.'
    if (code === 'PGRST301' || /fetch|network/i.test(message)) return 'Sin conexión. Tus datos siguen en el formulario: tocá "Guardar compra" otra vez cuando vuelva la señal.'
    return message
  }

  if (cargando) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  const inputStyle = [styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.bg }]} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <BackToInicioButton />
      <Text style={[styles.title, { color: colors.ink }]}>Compras</Text>
      <Text style={[styles.subtitle, { color: colors.inkSoft }]}>Cualquier gasto de la granja — insumos, servicios, combustible, reparaciones</Text>

      {esAdmin && (
        <TouchableOpacity
          style={[styles.button, { backgroundColor: formAbierto ? colors.surface2 : colors.accent, marginTop: 4 }]}
          onPress={() => { setFormAbierto(!formAbierto); limpiarEstado() }}
        >
          <Text style={[styles.buttonText, { color: formAbierto ? colors.accentDim : colors.accentInk }]}>
            {formAbierto ? 'Cerrar formulario' : 'Nueva compra'}
          </Text>
        </TouchableOpacity>
      )}

      {esAdmin && formAbierto && (
        <View>
          <Text style={[styles.label, { color: colors.inkSoft }]}>Fecha</Text>
          <TextInput style={inputStyle} placeholder="AAAA-MM-DD" placeholderTextColor={colors.inkFaint} value={fecha} onChangeText={setFecha} />

          <Text style={[styles.label, { color: colors.inkSoft }]}>Concepto</Text>
          <View style={styles.chipsRow}>
            <Chip label="Insumo (con stock)" selected={concepto === 'insumo'} onPress={() => { setConcepto('insumo'); limpiarEstado() }} />
            <Chip label="Servicio u otro gasto" selected={concepto === 'servicio_otro'} onPress={() => { setConcepto('servicio_otro'); limpiarEstado() }} />
          </View>
          <Text style={[styles.hint, { color: colors.inkFaint }]}>
            Elegí "Insumo" cuando la compra entra al stock (alimento, medicamentos, materiales). Para combustible, reparaciones, mano de obra u otros gastos sin stock, elegí "Servicio u otro gasto".
          </Text>

          {concepto === 'insumo' ? (
            <>
              <Text style={[styles.label, { color: colors.inkSoft }]}>Insumo</Text>
              {insumosActivos.length === 0 ? (
                <Text style={[styles.hint, { color: colors.inkFaint }]}>No hay insumos en el catálogo. Creá uno primero en Insumos.</Text>
              ) : (
                <View style={styles.chipsRow}>
                  {insumosActivos.map((i) => (
                    <Chip key={i.id} label={i.nombre} selected={insumoId === i.id} onPress={() => { setInsumoId(i.id); limpiarEstado() }} />
                  ))}
                </View>
              )}
              <Text style={[styles.hint, { color: colors.inkFaint }]}>Mismo catálogo que Insumos, manejado por el rol admin — solo se elige de la lista.</Text>

              <Text style={[styles.label, { color: colors.inkSoft }]}>Cantidad{unidadSel ? ` (${unidadSel})` : ''}</Text>
              <TextInput style={inputStyle} placeholder="Ej. 50" placeholderTextColor={colors.inkFaint} value={cantidad} onChangeText={(t) => { setCantidad(t); limpiarEstado() }} keyboardType="decimal-pad" />

              <Text style={[styles.label, { color: colors.inkSoft }]}>Galpón de destino</Text>
              {galpones.length === 0 ? (
                <Text style={[styles.hint, { color: colors.inkFaint }]}>No hay galpones registrados.</Text>
              ) : (
                <View style={styles.chipsRow}>
                  {galpones.map((g) => (
                    <Chip key={g.id} label={g.nombre ? `${g.codigo_galpon} · ${g.nombre}` : g.codigo_galpon} selected={galponId === g.id} onPress={() => { setGalponId(g.id); limpiarEstado() }} />
                  ))}
                </View>
              )}

              <Text style={[styles.label, { color: colors.inkSoft }]}>Costo del insumo (S/)</Text>
              <TextInput style={inputStyle} placeholder="Ej. 100" placeholderTextColor={colors.inkFaint} value={costo} onChangeText={(t) => { setCosto(t); limpiarEstado() }} keyboardType="decimal-pad" />
              <Text style={[styles.hint, { color: colors.inkFaint }]}>El costo total pagado por la cantidad comprada — no por unidad.</Text>
              <View style={[styles.computed, { backgroundColor: colors.accentSoft }]}>
                <Text style={[styles.hintSmall, { color: colors.inkSoft }]}>Costo unitario</Text>
                <Text style={[styles.computedVal, { color: colors.accentDim }]}>
                  {costoUnitario != null ? `${soles(costoUnitario)}${unidadSel ? ` / ${unidadSel}` : ''}` : '—'}
                </Text>
              </View>

              <Text style={[styles.label, { color: colors.inkSoft }]}>Flete / transporte (S/) — opcional</Text>
              <TextInput style={inputStyle} placeholder="Ej. 20" placeholderTextColor={colors.inkFaint} value={flete} onChangeText={(t) => { setFlete(t); limpiarEstado() }} keyboardType="decimal-pad" />
              <Text style={[styles.hint, { color: colors.inkFaint }]}>Costo de traer el insumo hasta la granja, cuando el proveedor lo cobra aparte.</Text>

              <View style={[styles.computed, { backgroundColor: colors.accentSoft }]}>
                <Text style={[styles.hintSmall, { color: colors.inkSoft }]}>Costo total de esta compra (se calcula solo)</Text>
                <Text style={[styles.computedVal, { color: colors.accentDim }]}>{totalInsumo != null ? soles(totalInsumo) : '—'}</Text>
              </View>
              <Text style={[styles.hint, { color: colors.inkFaint }]}>
                Esto genera automáticamente el movimiento de Entrada en Insumos — no hace falta registrarlo dos veces.
              </Text>
            </>
          ) : (
            <>
              <Text style={[styles.label, { color: colors.inkSoft }]}>Categoría del gasto</Text>
              <View style={styles.chipsRow}>
                {CATEGORIAS.map((c) => (
                  <Chip key={c.valor} label={c.label} selected={categoria === c.valor} onPress={() => { setCategoria(c.valor); limpiarEstado() }} />
                ))}
              </View>

              <Text style={[styles.label, { color: colors.inkSoft }]}>Descripción</Text>
              <TextInput style={inputStyle} placeholder="Ej. Cambio de aceite del motocultor" placeholderTextColor={colors.inkFaint} value={descripcion} onChangeText={(t) => { setDescripcion(t); limpiarEstado() }} maxLength={500} />

              <Text style={[styles.label, { color: colors.inkSoft }]}>Monto total (S/)</Text>
              <TextInput style={inputStyle} placeholder="Ej. 120" placeholderTextColor={colors.inkFaint} value={montoServicio} onChangeText={(t) => { setMontoServicio(t); limpiarEstado() }} keyboardType="decimal-pad" />
            </>
          )}

          <Text style={[styles.label, { color: colors.inkSoft }]}>Proveedor (opcional)</Text>
          <TextInput style={inputStyle} placeholder="Nombre del proveedor" placeholderTextColor={colors.inkFaint} value={proveedor} onChangeText={setProveedor} maxLength={150} />

          <Text style={[styles.label, { color: colors.inkSoft }]}>N° de comprobante (opcional)</Text>
          <TextInput style={inputStyle} placeholder="Ej. Boleta 0012-345" placeholderTextColor={colors.inkFaint} value={comprobante} onChangeText={setComprobante} maxLength={100} />

          {error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}
          {guardadoOk && <Text style={[styles.hint, { color: colors.success, fontWeight: '700' }]}>{guardadoOk}</Text>}

          <TouchableOpacity style={[styles.button, { backgroundColor: colors.accent }]} onPress={handleGuardar} disabled={guardando}>
            {guardando ? <ActivityIndicator color={colors.accentInk} /> : <Text style={[styles.buttonText, { color: colors.accentInk }]}>Guardar compra</Text>}
          </TouchableOpacity>
        </View>
      )}

      {(!esAdmin || !formAbierto) && guardadoOk && <Text style={[styles.hint, { color: colors.success, fontWeight: '700' }]}>{guardadoOk}</Text>}

      <Text style={[styles.label, { color: colors.inkSoft, marginTop: 20 }]}>Compras recientes</Text>
      {compras.length === 0 ? (
        <Text style={[styles.hint, { color: colors.inkFaint }]}>Todavía no hay compras registradas.</Text>
      ) : (
        compras.map((c) => (
          <View key={c.id} style={[styles.card, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
            <View style={styles.cardRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.ink }]}>
                  {c.concepto === 'insumo'
                    ? `${nombreInsumo(c.insumo_id)}${c.cantidad != null ? ` · ${c.cantidad}` : ''}`
                    : `${CATEGORIA_LABEL[c.categoria_gasto ?? 'otro'] ?? c.categoria_gasto}`}
                </Text>
                <Text style={[styles.hintSmall, { color: colors.inkSoft }]}>
                  {c.fecha} · {c.concepto === 'insumo' ? 'Insumo' : c.descripcion ?? 'Servicio'}
                </Text>
                {(c.proveedor || c.comprobante) && (
                  <Text style={[styles.hintSmall, { color: colors.inkFaint }]}>
                    {[c.proveedor, c.comprobante ? `Comprobante ${c.comprobante}` : null].filter(Boolean).join(' · ')}
                  </Text>
                )}
              </View>
              <Text style={[styles.monto, { color: colors.ink }]}>{soles(c.monto_total)}</Text>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 18, paddingBottom: 40 },
  title: { fontFamily: 'Archivo_800ExtraBold', fontSize: 20, marginBottom: 4 },
  subtitle: { fontFamily: 'PublicSans_400Regular', fontSize: 13, marginBottom: 12 },
  label: { fontFamily: 'PublicSans_700Bold', fontSize: 13, marginBottom: 6, marginTop: 12 },
  hint: { fontFamily: 'PublicSans_400Regular', fontSize: 13, marginTop: 6 },
  hintSmall: { fontFamily: 'PublicSans_400Regular', fontSize: 12, marginTop: 2 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginTop: 4 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  computed: { borderRadius: 12, padding: 10, marginTop: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  computedVal: { fontFamily: 'PublicSans_800ExtraBold', fontSize: 15 },
  card: { borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 8 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontFamily: 'PublicSans_700Bold', fontSize: 14 },
  monto: { fontFamily: 'PublicSans_800ExtraBold', fontSize: 15 },
  error: { fontFamily: 'PublicSans_600SemiBold', fontSize: 13, marginTop: 12 },
  button: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  buttonText: { fontFamily: 'PublicSans_700Bold', fontSize: 14 },
})
