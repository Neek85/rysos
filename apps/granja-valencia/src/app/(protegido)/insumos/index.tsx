// Insumos -- specs/app_granja_valencia_insumos.md. Tres secciones: lista de
// stock (vw_pecuario_insumos_stock), registrar movimiento (INSERT directo en
// PECUARIO_INSUMOS_MOVIMIENTOS, admin + tecnico_campo) y nuevo insumo (solo
// admin). El alta con stock inicial va por la RPC atómica
// fn_crear_insumo_con_stock_inicial; sin stock inicial, INSERT directo.
// Ocultar "Nuevo insumo" por rol es cosmético: la barrera real es la RLS (y la
// guarda interna de la RPC). Stock negativo = solo aviso, nunca bloquea.
import { useCallback, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import * as Crypto from 'expo-crypto'
import {
  InsumoAltaConStockInicialSchema,
  InsumoCrearSchema,
  MovimientoInsumoCrearSchema,
} from '../../../../../../lib/validations/pecuario'
import { supabase } from '../../../../lib/supabase/client'
import { useProfile } from '../../../../lib/supabase/useProfile'
import { hoyOperativo } from '../../../../lib/fecha/hoyOperativo'
import { useThemeColors } from '../../../../theme/useThemeColors'
import { BackToInicioButton } from '../../../../components/ui/BackToInicioButton'
import { Chip } from '../../../../components/ui/Chip'

type Insumo = {
  insumo_id: string
  nombre: string
  categoria: string | null
  unidad_medida: string
  stock_minimo: number | null
  stock_actual: number
}
type Galpon = { id: string; codigo_galpon: string; nombre: string | null }
type Poza = { id: string; codigo_poza: string }
type Lote = { id: string; codigo_lote: string }

const CATEGORIAS = [
  { valor: 'alimento', label: 'Alimento' },
  { valor: 'medicamento', label: 'Medicamento' },
  { valor: 'vitamina', label: 'Vitamina' },
  { valor: 'sanitario', label: 'Sanitario' },
  { valor: 'material', label: 'Material' },
  { valor: 'equipo', label: 'Equipo' },
  { valor: 'otro', label: 'Otro' },
] as const

const UNIDADES = [
  { valor: 'kg', label: 'Kg' },
  { valor: 'g', label: 'g' },
  { valor: 'litro', label: 'Litro' },
  { valor: 'ml', label: 'ml' },
  { valor: 'unidad', label: 'Unidad' },
  { valor: 'saco_50kg', label: 'Saco 50kg' },
  { valor: 'saco_40kg', label: 'Saco 40kg' },
] as const

const CATEGORIA_LABEL: Record<string, string> = Object.fromEntries(CATEGORIAS.map((c) => [c.valor, c.label]))
const UNIDAD_LABEL: Record<string, string> = Object.fromEntries(UNIDADES.map((u) => [u.valor, u.label.toLowerCase()]))

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

export default function InsumosScreen() {
  const colors = useThemeColors()
  const { organizacion, rol } = useProfile()
  const esAdmin = rol === 'admin'

  const [cargando, setCargando] = useState(true)
  const [insumos, setInsumos] = useState<Insumo[]>([])
  const [galpones, setGalpones] = useState<Galpon[]>([])
  const [pozas, setPozas] = useState<Poza[]>([])
  const [lotes, setLotes] = useState<Lote[]>([])

  const [modo, setModo] = useState<'movimiento' | 'nuevo'>('movimiento')

  // Registrar movimiento
  const [insumoId, setInsumoId] = useState<string | null>(null)
  const [tipo, setTipo] = useState<'entrada' | 'salida'>('entrada')
  const [cantidad, setCantidad] = useState('')
  const [fecha, setFecha] = useState(hoyOperativo())
  const [galponId, setGalponId] = useState<string | null>(null)
  const [detalleAbierto, setDetalleAbierto] = useState(false)
  const [pozaId, setPozaId] = useState<string | null>(null)
  const [loteId, setLoteId] = useState<string | null>(null)
  const [observaciones, setObservaciones] = useState('')

  // Nuevo insumo
  const [nombre, setNombre] = useState('')
  const [categoria, setCategoria] = useState<(typeof CATEGORIAS)[number]['valor']>('alimento')
  const [unidad, setUnidad] = useState<(typeof UNIDADES)[number]['valor']>('kg')
  const [stockMinimo, setStockMinimo] = useState('')
  const [stockInicial, setStockInicial] = useState('')
  const [galponInicialId, setGalponInicialId] = useState<string | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [guardadoOk, setGuardadoOk] = useState<string | null>(null)
  const [avisoNegativo, setAvisoNegativo] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(() => {
    if (!organizacion) return
    setCargando(true)
    Promise.all([
      supabase
        .from('vw_pecuario_insumos_stock')
        .select('insumo_id, nombre, categoria, unidad_medida, stock_minimo, stock_actual')
        .eq('ID_Organizacion', organizacion)
        .order('nombre'),
      supabase.from('PECUARIO_INSUMOS').select('id, activo').eq('ID_Organizacion', organizacion),
      supabase.from('PECUARIO_GALPONES').select('id, codigo_galpon, nombre').eq('ID_Organizacion', organizacion).order('codigo_galpon'),
      supabase.from('PECUARIO_JAULAS').select('id, codigo_poza').eq('ID_Organizacion', organizacion).order('codigo_poza'),
      // Un lote en 0 no tiene nada que consumir (mismo filtro que Pesaje/Venta).
      supabase.from('PECUARIO_LOTES').select('id, codigo_lote').eq('ID_Organizacion', organizacion).gt('cantidad_actual', 0).order('created_at'),
    ]).then(([stockRes, activosRes, galRes, pozaRes, loteRes]) => {
      const inactivos = new Set(
        ((activosRes.data ?? []) as { id: string; activo: boolean | null }[]).filter((i) => i.activo === false).map((i) => i.id)
      )
      const lista = ((stockRes.data ?? []) as Insumo[])
        .filter((i) => !inactivos.has(i.insumo_id))
        .map((i) => ({ ...i, stock_actual: Number(i.stock_actual), stock_minimo: i.stock_minimo == null ? null : Number(i.stock_minimo) }))
      setInsumos(lista)
      setGalpones((galRes.data ?? []) as Galpon[])
      setPozas((pozaRes.data ?? []) as Poza[])
      setLotes((loteRes.data ?? []) as Lote[])
      setCargando(false)
    })
  }, [organizacion])

  useFocusEffect(cargar)

  const insumo = insumos.find((i) => i.insumo_id === insumoId) ?? null
  const cantidadNum = parseNumero(cantidad)
  const stockQuedaria =
    insumo && tipo === 'salida' && cantidadNum != null && cantidadNum > 0 ? redondear(insumo.stock_actual - cantidadNum) : null
  const avisoPrevio =
    insumo && stockQuedaria != null && stockQuedaria < 0
      ? `Esta salida deja el stock en ${stockQuedaria} ${UNIDAD_LABEL[insumo.unidad_medida]} (negativo). Se puede guardar igual — revisá si falta registrar alguna entrada.`
      : null

  function limpiarEstado() {
    setError(null)
    setGuardadoOk(null)
    setAvisoNegativo(null)
  }

  function etiquetaGalpon(g: Galpon) {
    return g.nombre ? `${g.codigo_galpon} · ${g.nombre}` : g.codigo_galpon
  }

  async function handleGuardarMovimiento() {
    limpiarEstado()
    if (!organizacion || !insumo) return
    if (cantidadNum == null || Number.isNaN(cantidadNum) || cantidadNum <= 0) {
      setError('Ingresá una cantidad válida (mayor a 0).')
      return
    }
    if (!esFechaValida(fecha)) {
      setError('Ingresá una fecha válida (AAAA-MM-DD).')
      return
    }
    const parsed = MovimientoInsumoCrearSchema.safeParse({
      ID_Organizacion: organizacion,
      insumo_id: insumo.insumo_id,
      tipo_movimiento: tipo,
      cantidad: cantidadNum,
      fecha,
      galpon_id: galponId,
      poza_id: detalleAbierto ? pozaId : null,
      lote_id: detalleAbierto ? loteId : null,
      observaciones: observaciones.trim() || null,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos.')
      return
    }
    const stockAntes = insumo.stock_actual
    setGuardando(true)
    try {
      const { error: insertError } = await supabase.from('PECUARIO_INSUMOS_MOVIMIENTOS').insert(parsed.data)
      if (insertError) {
        setError(insertError.message)
        return
      }
      const stockDespues = redondear(stockAntes + (tipo === 'entrada' ? cantidadNum : -cantidadNum))
      setGuardadoOk(
        `${tipo === 'entrada' ? 'Entrada' : 'Salida'} de ${insumo.nombre.toLowerCase()} registrada: ${cantidadNum} ${UNIDAD_LABEL[insumo.unidad_medida]} (stock: ${redondear(stockAntes)} → ${stockDespues}).`
      )
      if (stockDespues < 0) {
        setAvisoNegativo('El stock quedó negativo — revisá si falta registrar alguna entrada.')
      }
      setCantidad('')
      setObservaciones('')
      cargar()
    } finally {
      setGuardando(false)
    }
  }

  async function handleGuardarInsumo() {
    limpiarEstado()
    if (!organizacion || !esAdmin) return
    const minimo = parseNumero(stockMinimo)
    const inicial = parseNumero(stockInicial)
    if ((minimo != null && Number.isNaN(minimo)) || (inicial != null && Number.isNaN(inicial))) {
      setError('Stock mínimo y stock inicial deben ser números.')
      return
    }

    if (inicial != null && inicial > 0) {
      // Alta atómica: insumo + movimiento de entrada inicial en una sola
      // transacción (RPC). Los UUID los genera el cliente (offline-first).
      const parsed = InsumoAltaConStockInicialSchema.safeParse({
        ID_Organizacion: organizacion,
        nombre,
        categoria,
        unidad_medida: unidad,
        stock_minimo: minimo,
        activo: true,
        insumo_id: Crypto.randomUUID(),
        stock_inicial: inicial,
        movimiento_id: Crypto.randomUUID(),
        galpon_id: galponInicialId,
        created_offline_at: new Date().toISOString(),
      })
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? 'Datos inválidos.')
        return
      }
      const d = parsed.data
      setGuardando(true)
      try {
        const { error: rpcError } = await supabase.rpc('fn_crear_insumo_con_stock_inicial', {
          p_insumo_id: d.insumo_id,
          p_id_organizacion: d.ID_Organizacion,
          p_nombre: d.nombre,
          p_categoria: d.categoria,
          p_unidad_medida: d.unidad_medida,
          p_stock_minimo: d.stock_minimo ?? null,
          p_activo: d.activo,
          p_device_id: d.device_id ?? null,
          p_created_offline_at: d.created_offline_at ?? null,
          p_stock_inicial: d.stock_inicial ?? null,
          p_movimiento_id: d.movimiento_id ?? null,
          p_galpon_id: d.galpon_id ?? null,
        })
        if (rpcError) {
          setError(traducirErrorAlta(rpcError.code, rpcError.message))
          return
        }
        setGuardadoOk(`Insumo "${d.nombre}" agregado con ${inicial} ${UNIDAD_LABEL[d.unidad_medida]} de stock inicial. ✓`)
        resetFormNuevo()
        cargar()
      } finally {
        setGuardando(false)
      }
      return
    }

    // Sin stock inicial: INSERT directo en el catálogo (RLS: solo admin).
    const parsed = InsumoCrearSchema.safeParse({
      ID_Organizacion: organizacion,
      nombre,
      categoria,
      unidad_medida: unidad,
      stock_minimo: minimo,
      activo: true,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos.')
      return
    }
    setGuardando(true)
    try {
      const { error: insertError } = await supabase.from('PECUARIO_INSUMOS').insert(parsed.data)
      if (insertError) {
        setError(traducirErrorAlta(insertError.code, insertError.message))
        return
      }
      setGuardadoOk(`Insumo "${parsed.data.nombre}" agregado al catálogo. ✓`)
      resetFormNuevo()
      cargar()
    } finally {
      setGuardando(false)
    }
  }

  function traducirErrorAlta(code: string | undefined, message: string) {
    if (code === '23505') return 'Ya existe un insumo con ese nombre.'
    return message
  }

  function resetFormNuevo() {
    setNombre('')
    setStockMinimo('')
    setStockInicial('')
    setGalponInicialId(null)
  }

  if (cargando) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  const inputStyle = [styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]
  const puedeGuardarMovimiento = !!insumo && cantidadNum != null && !Number.isNaN(cantidadNum) && cantidadNum > 0

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.bg }]} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <BackToInicioButton />
      <Text style={[styles.title, { color: colors.ink }]}>Insumos</Text>
      <Text style={[styles.subtitle, { color: colors.inkSoft }]}>Alimento, medicamentos, sanitarios y más — stock actual</Text>

      {/* 1. Lista de stock */}
      {insumos.length === 0 ? (
        <Text style={[styles.hint, { color: colors.inkFaint }]}>
          {esAdmin ? 'Todavía no hay insumos. Creá el primero en "Nuevo insumo".' : 'Todavía no hay insumos. Pedile a un administrador que los cree.'}
        </Text>
      ) : (
        insumos.map((i) => {
          const bajo = i.stock_minimo != null && i.stock_actual < i.stock_minimo
          const unidadLabel = UNIDAD_LABEL[i.unidad_medida] ?? i.unidad_medida
          return (
            <View
              key={i.insumo_id}
              style={[
                styles.card,
                styles.cardRow,
                { backgroundColor: bajo ? colors.dangerSoft : colors.surface2, borderColor: bajo ? 'transparent' : colors.border },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.ink }]}>{i.nombre}</Text>
                <Text style={[styles.hintSmall, { color: colors.inkSoft }]}>
                  {CATEGORIA_LABEL[i.categoria ?? 'otro'] ?? i.categoria}
                  {bajo ? ` · bajo el mínimo (${i.stock_minimo} ${unidadLabel})` : ''}
                </Text>
              </View>
              <Text style={[styles.stockNum, { color: bajo ? colors.danger : colors.ink }]}>
                {redondear(i.stock_actual)} {unidadLabel}
              </Text>
            </View>
          )
        })
      )}

      {esAdmin && (
        <View style={[styles.chipsRow, { marginTop: 16 }]}>
          <Chip label="Registrar movimiento" selected={modo === 'movimiento'} onPress={() => { setModo('movimiento'); limpiarEstado() }} />
          <Chip label="Nuevo insumo" selected={modo === 'nuevo'} onPress={() => { setModo('nuevo'); limpiarEstado() }} />
        </View>
      )}

      {modo === 'movimiento' || !esAdmin ? (
        <>
          <Text style={[styles.label, { color: colors.inkSoft }]}>Insumo</Text>
          {insumos.length === 0 ? (
            <Text style={[styles.hint, { color: colors.inkFaint }]}>No hay insumos en el catálogo.</Text>
          ) : (
            <View style={styles.chipsRow}>
              {insumos.map((i) => (
                <Chip key={i.insumo_id} label={i.nombre} selected={insumoId === i.insumo_id} onPress={() => { setInsumoId(i.insumo_id); limpiarEstado() }} />
              ))}
            </View>
          )}
          <Text style={[styles.hint, { color: colors.inkFaint }]}>
            Catálogo único de la organización, manejado por el rol admin — solo se elige de la lista.
          </Text>

          <Text style={[styles.label, { color: colors.inkSoft }]}>Tipo</Text>
          <View style={styles.chipsRow}>
            <Chip label="Entrada" selected={tipo === 'entrada'} onPress={() => { setTipo('entrada'); limpiarEstado() }} />
            <Chip label="Salida" selected={tipo === 'salida'} onPress={() => { setTipo('salida'); limpiarEstado() }} />
          </View>

          <Text style={[styles.label, { color: colors.inkSoft }]}>
            Cantidad{insumo ? ` (${UNIDAD_LABEL[insumo.unidad_medida]})` : ''}
          </Text>
          <TextInput style={inputStyle} placeholder="Ej. 50" placeholderTextColor={colors.inkFaint} value={cantidad} onChangeText={(t) => { setCantidad(t); limpiarEstado() }} keyboardType="decimal-pad" />
          {avisoPrevio && (
            <View style={[styles.aviso, { backgroundColor: colors.amberSoft }]}>
              <Text style={[styles.avisoText, { color: colors.amber }]}>⚠ {avisoPrevio}</Text>
            </View>
          )}

          <Text style={[styles.label, { color: colors.inkSoft }]}>Fecha</Text>
          <TextInput style={inputStyle} placeholder="AAAA-MM-DD" placeholderTextColor={colors.inkFaint} value={fecha} onChangeText={setFecha} />

          <Text style={[styles.label, { color: colors.inkSoft }]}>Galpón</Text>
          {galpones.length === 0 ? (
            <Text style={[styles.hint, { color: colors.inkFaint }]}>No hay galpones registrados.</Text>
          ) : (
            <View style={styles.chipsRow}>
              {galpones.map((g) => (
                <Chip key={g.id} label={etiquetaGalpon(g)} selected={galponId === g.id} onPress={() => { setGalponId(galponId === g.id ? null : g.id); limpiarEstado() }} />
              ))}
            </View>
          )}
          <Text style={[styles.hint, { color: colors.inkFaint }]}>Así calculamos el consumo por galpón. Tocá de nuevo para quitarlo.</Text>

          <TouchableOpacity onPress={() => setDetalleAbierto(!detalleAbierto)}>
            <Text style={[styles.link, { color: colors.accentDim }]}>
              {detalleAbierto ? '− Quitar detalle por poza/lote' : '+ Detallar por poza/lote (para una prueba puntual)'}
            </Text>
          </TouchableOpacity>
          {detalleAbierto && (
            <>
              <Text style={[styles.label, { color: colors.inkSoft }]}>Poza (opcional)</Text>
              <View style={styles.chipsRow}>
                {pozas.map((p) => (
                  <Chip key={p.id} label={p.codigo_poza} selected={pozaId === p.id} onPress={() => setPozaId(pozaId === p.id ? null : p.id)} />
                ))}
              </View>
              <Text style={[styles.label, { color: colors.inkSoft }]}>Lote (opcional)</Text>
              {lotes.length === 0 ? (
                <Text style={[styles.hint, { color: colors.inkFaint }]}>No hay lotes con animales.</Text>
              ) : (
                <View style={styles.chipsRow}>
                  {lotes.map((l) => (
                    <Chip key={l.id} label={l.codigo_lote} selected={loteId === l.id} onPress={() => setLoteId(loteId === l.id ? null : l.id)} />
                  ))}
                </View>
              )}
              <Text style={[styles.hint, { color: colors.inkFaint }]}>
                Solo una salida de alimento en kg con lote cuenta para el FCR de ese lote; con solo galpón o poza descuenta stock pero no entra al FCR.
              </Text>
            </>
          )}

          <Text style={[styles.label, { color: colors.inkSoft }]}>Observaciones (opcional)</Text>
          <TextInput style={[...inputStyle, styles.textArea]} placeholder="Ej. reposición semanal" placeholderTextColor={colors.inkFaint} value={observaciones} onChangeText={setObservaciones} multiline maxLength={500} />

          {error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}
          {guardadoOk && <Text style={[styles.hint, { color: colors.success, fontWeight: '700' }]}>{guardadoOk}</Text>}
          {avisoNegativo && (
            <View style={[styles.aviso, { backgroundColor: colors.amberSoft }]}>
              <Text style={[styles.avisoText, { color: colors.amber }]}>⚠ {avisoNegativo}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.accent }, !puedeGuardarMovimiento && styles.buttonDisabled]}
            onPress={handleGuardarMovimiento}
            disabled={!puedeGuardarMovimiento || guardando}
          >
            {guardando ? <ActivityIndicator color={colors.accentInk} /> : <Text style={[styles.buttonText, { color: colors.accentInk }]}>Guardar movimiento</Text>}
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={[styles.hint, { color: colors.inkFaint }]}>
            Solo el rol admin crea insumos en el catálogo — evita que cada técnico escriba el mismo insumo distinto ("Alfalfa" / "alfalfa").
          </Text>

          <Text style={[styles.label, { color: colors.inkSoft }]}>Nombre</Text>
          <TextInput style={inputStyle} placeholder="Ej. Alfalfa achicalada" placeholderTextColor={colors.inkFaint} value={nombre} onChangeText={(t) => { setNombre(t); limpiarEstado() }} maxLength={150} />

          <Text style={[styles.label, { color: colors.inkSoft }]}>Tipo</Text>
          <View style={styles.chipsRow}>
            {CATEGORIAS.map((c) => (
              <Chip key={c.valor} label={c.label} selected={categoria === c.valor} onPress={() => setCategoria(c.valor)} />
            ))}
          </View>

          <Text style={[styles.label, { color: colors.inkSoft }]}>Unidad</Text>
          <View style={styles.chipsRow}>
            {UNIDADES.map((u) => (
              <Chip key={u.valor} label={u.label} selected={unidad === u.valor} onPress={() => setUnidad(u.valor)} />
            ))}
          </View>

          <Text style={[styles.label, { color: colors.inkSoft }]}>Stock mínimo (para alertas)</Text>
          <TextInput style={inputStyle} placeholder="Ej. 5" placeholderTextColor={colors.inkFaint} value={stockMinimo} onChangeText={setStockMinimo} keyboardType="decimal-pad" />

          <Text style={[styles.label, { color: colors.inkSoft }]}>Stock actual al momento de registrar (opcional)</Text>
          <TextInput style={inputStyle} placeholder="Ej. 40" placeholderTextColor={colors.inkFaint} value={stockInicial} onChangeText={setStockInicial} keyboardType="decimal-pad" />
          <Text style={[styles.hint, { color: colors.inkFaint }]}>
            Si ya tenés existencias, queda como el primer movimiento de entrada. De ahí en adelante el stock se calcula solo (nunca se edita a mano).
          </Text>

          {(parseNumero(stockInicial) ?? 0) > 0 && (
            <>
              <Text style={[styles.label, { color: colors.inkSoft }]}>Galpón del stock inicial (opcional)</Text>
              <View style={styles.chipsRow}>
                {galpones.map((g) => (
                  <Chip key={g.id} label={etiquetaGalpon(g)} selected={galponInicialId === g.id} onPress={() => setGalponInicialId(galponInicialId === g.id ? null : g.id)} />
                ))}
              </View>
            </>
          )}

          {error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}
          {guardadoOk && <Text style={[styles.hint, { color: colors.success, fontWeight: '700' }]}>{guardadoOk}</Text>}

          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.accent }, !nombre.trim() && styles.buttonDisabled]}
            onPress={handleGuardarInsumo}
            disabled={!nombre.trim() || guardando}
          >
            {guardando ? <ActivityIndicator color={colors.accentInk} /> : <Text style={[styles.buttonText, { color: colors.accentInk }]}>Guardar insumo</Text>}
          </TouchableOpacity>
        </>
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
  link: { fontFamily: 'PublicSans_700Bold', fontSize: 13, marginTop: 12 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginTop: 4 },
  textArea: { minHeight: 70, textAlignVertical: 'top' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 8 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontFamily: 'PublicSans_700Bold', fontSize: 14 },
  stockNum: { fontFamily: 'PublicSans_800ExtraBold', fontSize: 15 },
  aviso: { borderRadius: 10, padding: 10, marginTop: 8 },
  avisoText: { fontFamily: 'PublicSans_600SemiBold', fontSize: 13 },
  error: { fontFamily: 'PublicSans_600SemiBold', fontSize: 13, marginTop: 12 },
  button: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontFamily: 'PublicSans_700Bold', fontSize: 14 },
})
