// Registrar venta -- specs/app_granja_valencia_venta.md. Backend real
// PECUARIO_VENTAS + PECUARIO_VENTAS_SUBPRODUCTOS (tabla independiente,
// sin trigger). fn_calcular_precio_total_venta (leída completa, spec
// §0): si base_precio='por_kg' o hay precio_unitario, el servidor
// recalcula precio_total siempre, pisando lo que mande el cliente --
// pero si base_precio='por_animal' y precio_unitario queda vacío, el
// trigger NO toca precio_total, así que el valor que el cliente manda
// es el que queda guardado (modo "acordar un total directo", real).
// rendimiento_carcasa_pct es GENERATED, nunca se manda. Gap real
// confirmado: ningún trigger descuenta PECUARIO_LOTES.cantidad_actual
// al vender parte de un lote (trg_dar_baja_animal_por_venta solo actúa
// si animal_id IS NOT NULL) -- fix ya decidido con Neyser: UPDATE
// explícito del cliente inmediatamente después del INSERT, no atómico.
import { useCallback, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { VentaAnimalSchema, VentaGuanoSchema } from '../../../../../../lib/validations/pecuario'
import { supabase } from '../../../../lib/supabase/client'
import { useProfile } from '../../../../lib/supabase/useProfile'
import { useThemeColors } from '../../../../theme/useThemeColors'
import { BackToInicioButton } from '../../../../components/ui/BackToInicioButton'
import { Chip } from '../../../../components/ui/Chip'

type LoteOption = { id: string; codigo_lote: string; cantidad_actual: number | null }
type ReproductorOption = { id: string; codigo_arete: string }
type GalponOption = { id: string; codigo_galpon: string }

const TIPOS_SALIDA = [
  { valor: 'carne' as const, label: 'Carne' },
  { valor: 'pie_cria' as const, label: 'Pie de cría' },
  { valor: 'reproductor_saca' as const, label: 'Reproductor de saca' },
  { valor: 'pelado_beneficiado' as const, label: 'Pelado (beneficiado)' },
]

function hoyISO() {
  return new Date().toISOString().slice(0, 10)
}

function Stepper({
  value,
  onChange,
  min = 1,
  max,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number | null
}) {
  const colors = useThemeColors()
  return (
    <View style={[styles.stepper, { borderColor: colors.border }]}>
      <TouchableOpacity
        style={[styles.stepperButton, { backgroundColor: colors.surface2 }]}
        onPress={() => onChange(Math.max(min, value - 1))}
      >
        <Text style={[styles.stepperButtonText, { color: colors.accentDim }]}>−</Text>
      </TouchableOpacity>
      <Text style={[styles.stepperValue, { color: colors.ink }]}>{value}</Text>
      <TouchableOpacity
        style={[styles.stepperButton, { backgroundColor: colors.surface2 }]}
        onPress={() => onChange(max != null ? Math.min(max, value + 1) : value + 1)}
      >
        <Text style={[styles.stepperButtonText, { color: colors.accentDim }]}>+</Text>
      </TouchableOpacity>
    </View>
  )
}

export default function RegistrarVentaScreen() {
  const colors = useThemeColors()
  const { organizacion } = useProfile()

  const [cargando, setCargando] = useState(true)
  const [lotes, setLotes] = useState<LoteOption[]>([])
  const [reproductores, setReproductores] = useState<ReproductorOption[]>([])
  const [galpones, setGalpones] = useState<GalponOption[]>([])

  const [queVende, setQueVende] = useState<'animales' | 'guano'>('animales')

  // Venta de animales -- modo
  const [modo, setModo] = useState<'lote' | 'reproductor'>('lote')
  const [loteId, setLoteId] = useState<string | null>(null)
  const [cantidad, setCantidad] = useState(1)
  const [busquedaAnimal, setBusquedaAnimal] = useState('')
  const [animalId, setAnimalId] = useState<string | null>(null)

  // Venta de animales -- resto de campos
  const [fechaVenta, setFechaVenta] = useState(hoyISO())
  const [tipoSalida, setTipoSalida] = useState<(typeof TIPOS_SALIDA)[number]['valor']>('carne')
  const [basePrecio, setBasePrecio] = useState<'por_animal' | 'por_kg'>('por_animal')
  const [precioUnitario, setPrecioUnitario] = useState('')
  const [precioKg, setPrecioKg] = useState('')
  const [precioTotalManual, setPrecioTotalManual] = useState('')
  const [pesoTotalKg, setPesoTotalKg] = useState('')
  const [pesoVivoPreBeneficioKg, setPesoVivoPreBeneficioKg] = useState('')
  const [compradorNombre, setCompradorNombre] = useState('')

  // Venta de guano
  const [fechaGuano, setFechaGuano] = useState(hoyISO())
  const [cantidadGuano, setCantidadGuano] = useState('')
  const [unidadGuano, setUnidadGuano] = useState<'sacos' | 'kg'>('sacos')
  const [precioTotalGuano, setPrecioTotalGuano] = useState('')
  const [galponId, setGalponId] = useState<string | null>(null)
  const [compradorGuano, setCompradorGuano] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [guardadoOk, setGuardadoOk] = useState(false)

  const cargar = useCallback(() => {
    if (!organizacion) return
    setCargando(true)
    Promise.all([
      supabase
        .from('PECUARIO_LOTES')
        .select('id, codigo_lote, cantidad_actual')
        .eq('ID_Organizacion', organizacion)
        // Hallazgo cerrado (spec §1): un lote en 0 no tiene nada para
        // vender -- PECUARIO_LOTES.estado nunca cambia solo al agotarse.
        .gt('cantidad_actual', 0)
        .order('created_at'),
      supabase
        .from('PECUARIO_REPRODUCTORES')
        .select('id, codigo_arete')
        .eq('ID_Organizacion', organizacion)
        .eq('estado', 'activo')
        .order('codigo_arete'),
      supabase
        .from('PECUARIO_GALPONES')
        .select('id, codigo_galpon')
        .eq('ID_Organizacion', organizacion)
        .order('codigo_galpon'),
    ]).then(([lotesRes, reproductoresRes, galponesRes]) => {
      setLotes((lotesRes.data ?? []) as LoteOption[])
      setReproductores((reproductoresRes.data ?? []) as ReproductorOption[])
      setGalpones((galponesRes.data ?? []) as GalponOption[])
      setCargando(false)
    })
  }, [organizacion])

  useFocusEffect(cargar)

  const loteSeleccionado = lotes.find((l) => l.id === loteId) ?? null
  const maxCantidad = modo === 'lote' ? loteSeleccionado?.cantidad_actual ?? null : 1
  const cantidadEfectiva = modo === 'reproductor' ? 1 : cantidad

  const precioUnitarioNum = precioUnitario.trim() ? Number(precioUnitario) : null
  const precioKgNum = precioKg.trim() ? Number(precioKg) : null
  const pesoTotalKgNum = pesoTotalKg.trim() ? Number(pesoTotalKg) : null
  const pesoVivoNum = pesoVivoPreBeneficioKg.trim() ? Number(pesoVivoPreBeneficioKg) : null

  // Modo "acordar un total directo" (spec §0): solo posible con
  // base_precio='por_animal' y sin precio individual -- el backend real
  // no toca precio_total en ese caso, así que el campo se vuelve
  // editable en vez de calculado.
  const totalDirecto = basePrecio === 'por_animal' && precioUnitarioNum == null

  const precioTotalCalculado =
    basePrecio === 'por_kg' && pesoTotalKgNum != null && precioKgNum != null
      ? Math.round(pesoTotalKgNum * precioKgNum * 100) / 100
      : basePrecio === 'por_animal' && precioUnitarioNum != null
        ? Math.round(cantidadEfectiva * precioUnitarioNum * 100) / 100
        : null

  const rendimientoCarcasa =
    pesoTotalKgNum != null && pesoVivoNum != null && pesoVivoNum > 0
      ? Math.round((pesoTotalKgNum / pesoVivoNum) * 100 * 10) / 10
      : null

  function seleccionarLote(l: LoteOption) {
    setLoteId(l.id)
    setError(null)
    setGuardadoOk(false)
    if (l.cantidad_actual != null && cantidad > l.cantidad_actual) {
      setCantidad(Math.max(1, l.cantidad_actual))
    }
  }

  function seleccionarTipoSalida(valor: (typeof TIPOS_SALIDA)[number]['valor']) {
    setTipoSalida(valor)
    setError(null)
    setGuardadoOk(false)
    if (valor !== 'pelado_beneficiado') {
      setBasePrecio('por_animal')
      setPrecioKg('')
      setPesoVivoPreBeneficioKg('')
    }
  }

  async function handleGuardarVentaAnimal() {
    setError(null)
    setGuardadoOk(false)
    if (!organizacion) return
    if (modo === 'lote' && !loteId) return
    if (modo === 'reproductor' && !animalId) return

    // No confiar solo en el tope del stepper -- a diferencia de
    // Traslado, PECUARIO_VENTAS no tiene ningún trigger que valide
    // cantidad contra cantidad_actual, así que esta es la única barrera
    // real (spec §2).
    if (modo === 'lote' && maxCantidad != null && cantidadEfectiva > maxCantidad) {
      setError(`No puedes vender más de los ${maxCantidad} animales que tiene el lote.`)
      return
    }

    const precioTotalFinal =
      precioTotalCalculado ?? (precioTotalManual.trim() ? Number(precioTotalManual) : null)
    if (precioTotalFinal == null || Number.isNaN(precioTotalFinal)) {
      setError('Ingresá un precio total válido.')
      return
    }

    const parsed = VentaAnimalSchema.safeParse({
      ID_Organizacion: organizacion,
      lote_id: modo === 'lote' ? loteId : null,
      animal_id: modo === 'reproductor' ? animalId : null,
      fecha_venta: fechaVenta,
      tipo_salida: tipoSalida,
      cantidad: cantidadEfectiva,
      precio_unitario: basePrecio === 'por_animal' ? precioUnitarioNum : null,
      peso_total_kg: pesoTotalKgNum,
      precio_total: precioTotalFinal,
      comprador_nombre: compradorNombre.trim() || null,
      base_precio: basePrecio,
      precio_kg: basePrecio === 'por_kg' ? precioKgNum : null,
      peso_vivo_pre_beneficio_kg: pesoVivoNum,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos.')
      return
    }

    setGuardando(true)
    try {
      const { error: insertError } = await supabase.from('PECUARIO_VENTAS').insert(parsed.data)
      if (insertError) {
        setError(insertError.message)
        return
      }

      // Fix decidido (spec §3): UPDATE explícito, no atómico -- ningún
      // trigger real descuenta cantidad_actual cuando lote_id está
      // seteado (a diferencia de animal_id, que el propio trigger de
      // venta da de baja solo).
      if (modo === 'lote' && loteId && loteSeleccionado?.cantidad_actual != null) {
        const { error: updateError } = await supabase
          .from('PECUARIO_LOTES')
          .update({ cantidad_actual: loteSeleccionado.cantidad_actual - cantidadEfectiva })
          .eq('id', loteId)
        if (updateError) {
          setError(`Venta guardada, pero no se pudo actualizar la cantidad del lote: ${updateError.message}`)
          return
        }
      }

      setGuardadoOk(true)
      setLoteId(null)
      setAnimalId(null)
      setCantidad(1)
      setPrecioUnitario('')
      setPrecioKg('')
      setPrecioTotalManual('')
      setPesoTotalKg('')
      setPesoVivoPreBeneficioKg('')
      setCompradorNombre('')
      cargar()
    } finally {
      setGuardando(false)
    }
  }

  async function handleGuardarGuano() {
    setError(null)
    setGuardadoOk(false)
    if (!organizacion) return

    const cantidadGuanoNum = Number(cantidadGuano)
    const precioTotalGuanoNum = precioTotalGuano.trim() ? Number(precioTotalGuano) : null

    const parsed = VentaGuanoSchema.safeParse({
      ID_Organizacion: organizacion,
      fecha: fechaGuano,
      producto: 'guano',
      cantidad: cantidadGuanoNum,
      unidad: unidadGuano,
      precio_total: precioTotalGuanoNum,
      galpon_id: galponId,
      comprador_nombre: compradorGuano.trim() || null,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos.')
      return
    }

    setGuardando(true)
    try {
      const { error: insertError } = await supabase.from('PECUARIO_VENTAS_SUBPRODUCTOS').insert(parsed.data)
      if (insertError) {
        setError(insertError.message)
        return
      }
      setGuardadoOk(true)
      setCantidadGuano('')
      setPrecioTotalGuano('')
      setGalponId(null)
      setCompradorGuano('')
    } finally {
      setGuardando(false)
    }
  }

  const reproductoresFiltrados = reproductores.filter((r) =>
    r.codigo_arete.toLowerCase().includes(busquedaAnimal.trim().toLowerCase())
  )

  const puedeGuardarAnimal =
    !!organizacion &&
    (modo === 'lote' ? !!loteId : !!animalId) &&
    (basePrecio === 'por_kg' ? pesoTotalKgNum != null && precioKgNum != null && pesoVivoNum != null : true)

  const puedeGuardarGuano = !!organizacion && cantidadGuano.trim() !== ''

  if (cargando) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.bg }]} contentContainerStyle={styles.content}>
      <BackToInicioButton />
      <Text style={[styles.title, { color: colors.ink }]}>Registrar venta</Text>
      <Text style={[styles.subtitle, { color: colors.inkSoft }]}>
        Salida de animales o de subproductos del plantel
      </Text>

      <Text style={[styles.label, { color: colors.inkSoft }]}>¿Qué se vende?</Text>
      <View style={styles.chipsRow}>
        <Chip
          label="Animales"
          selected={queVende === 'animales'}
          onPress={() => {
            setQueVende('animales')
            setError(null)
            setGuardadoOk(false)
          }}
        />
        <Chip
          label="Guano (subproducto)"
          selected={queVende === 'guano'}
          onPress={() => {
            setQueVende('guano')
            setError(null)
            setGuardadoOk(false)
          }}
        />
      </View>

      {queVende === 'animales' ? (
        <>
          <View style={styles.chipsRow}>
            <Chip
              label="Lote (poblacional)"
              selected={modo === 'lote'}
              onPress={() => {
                setModo('lote')
                setAnimalId(null)
                setError(null)
                setGuardadoOk(false)
              }}
            />
            <Chip
              label="Reproductor identificado"
              selected={modo === 'reproductor'}
              onPress={() => {
                setModo('reproductor')
                setLoteId(null)
                setCantidad(1)
                setError(null)
                setGuardadoOk(false)
              }}
            />
          </View>

          {modo === 'lote' ? (
            <>
              <Text style={[styles.label, { color: colors.inkSoft }]}>Lote</Text>
              {lotes.length === 0 ? (
                <Text style={[styles.hint, { color: colors.inkFaint }]}>No hay lotes disponibles para vender.</Text>
              ) : (
                <View style={styles.chipsRow}>
                  {lotes.map((l) => (
                    <Chip key={l.id} label={l.codigo_lote} selected={loteId === l.id} onPress={() => seleccionarLote(l)} />
                  ))}
                </View>
              )}

              <Text style={[styles.label, { color: colors.inkSoft }]}>Cantidad</Text>
              <Stepper
                value={cantidad}
                onChange={(v) => {
                  setCantidad(v)
                  setError(null)
                  setGuardadoOk(false)
                }}
                min={1}
                max={maxCantidad}
              />
              {maxCantidad != null && (
                <Text style={[styles.hint, { color: colors.inkFaint }]}>Máximo disponible en el lote: {maxCantidad}</Text>
              )}
            </>
          ) : (
            <>
              <Text style={[styles.label, { color: colors.inkSoft }]}>Reproductor/a</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
                placeholder="Código de arete (ej. M-009)"
                placeholderTextColor={colors.inkFaint}
                value={busquedaAnimal}
                onChangeText={setBusquedaAnimal}
              />
              {reproductores.length === 0 ? (
                <Text style={[styles.hint, { color: colors.inkFaint }]}>No hay reproductores identificados activos.</Text>
              ) : (
                <View style={styles.chipsRow}>
                  {reproductoresFiltrados.map((r) => (
                    <Chip
                      key={r.id}
                      label={r.codigo_arete}
                      selected={animalId === r.id}
                      onPress={() => {
                        setAnimalId(r.id)
                        setError(null)
                        setGuardadoOk(false)
                      }}
                    />
                  ))}
                </View>
              )}
              <Text style={[styles.hint, { color: colors.inkFaint }]}>
                Venta de un solo reproductor — la cantidad queda fija en 1.
              </Text>
            </>
          )}

          <Text style={[styles.label, { color: colors.inkSoft }]}>Fecha</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
            placeholder="AAAA-MM-DD"
            placeholderTextColor={colors.inkFaint}
            value={fechaVenta}
            onChangeText={setFechaVenta}
          />

          <Text style={[styles.label, { color: colors.inkSoft }]}>Tipo de salida</Text>
          <View style={styles.chipsRow}>
            {TIPOS_SALIDA.map((t) => (
              <Chip key={t.valor} label={t.label} selected={tipoSalida === t.valor} onPress={() => seleccionarTipoSalida(t.valor)} />
            ))}
          </View>

          {tipoSalida === 'pelado_beneficiado' && (
            <>
              <Text style={[styles.label, { color: colors.inkSoft }]}>Base del precio</Text>
              <View style={styles.chipsRow}>
                <Chip
                  label="Por kilogramo"
                  selected={basePrecio === 'por_kg'}
                  onPress={() => {
                    setBasePrecio('por_kg')
                    setError(null)
                    setGuardadoOk(false)
                  }}
                />
                <Chip
                  label="Por animal"
                  selected={basePrecio === 'por_animal'}
                  onPress={() => {
                    setBasePrecio('por_animal')
                    setPrecioKg('')
                    setError(null)
                    setGuardadoOk(false)
                  }}
                />
              </View>
            </>
          )}

          {basePrecio === 'por_kg' ? (
            <>
              <Text style={[styles.label, { color: colors.inkSoft }]}>Precio por kilogramo (S/ por kg)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
                placeholder="Ej. 22"
                placeholderTextColor={colors.inkFaint}
                keyboardType="numeric"
                value={precioKg}
                onChangeText={(v) => {
                  setPrecioKg(v)
                  setError(null)
                  setGuardadoOk(false)
                }}
              />
            </>
          ) : (
            <>
              <Text style={[styles.label, { color: colors.inkSoft }]}>Precio individual (S/ por animal, opcional)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
                placeholder="Ej. 18"
                placeholderTextColor={colors.inkFaint}
                keyboardType="numeric"
                value={precioUnitario}
                onChangeText={(v) => {
                  setPrecioUnitario(v)
                  setError(null)
                  setGuardadoOk(false)
                }}
              />
            </>
          )}

          <Text style={[styles.label, { color: colors.inkSoft }]}>Precio total (S/)</Text>
          {totalDirecto ? (
            <>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
                placeholder="Ej. 200"
                placeholderTextColor={colors.inkFaint}
                keyboardType="numeric"
                value={precioTotalManual}
                onChangeText={(v) => {
                  setPrecioTotalManual(v)
                  setError(null)
                  setGuardadoOk(false)
                }}
              />
              <Text style={[styles.hint, { color: colors.inkFaint }]}>
                Sin precio individual: acordá el total directamente.
              </Text>
            </>
          ) : (
            <View style={[styles.computedBox, { backgroundColor: colors.accentSoft }]}>
              <Text style={{ color: colors.inkSoft, fontSize: 13 }}>Se calcula solo</Text>
              <Text style={{ color: colors.accentDim, fontWeight: '800', fontSize: 15 }}>
                {precioTotalCalculado != null ? `S/ ${precioTotalCalculado.toFixed(2)}` : '—'}
              </Text>
            </View>
          )}

          <Text style={[styles.label, { color: colors.inkSoft }]}>
            Peso total (kg){basePrecio === 'por_kg' ? '' : ' — opcional, referencial'}
          </Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
            placeholder="Ej. 14.5"
            placeholderTextColor={colors.inkFaint}
            keyboardType="numeric"
            value={pesoTotalKg}
            onChangeText={(v) => {
              setPesoTotalKg(v)
              setError(null)
              setGuardadoOk(false)
            }}
          />

          {basePrecio === 'por_kg' && (
            <>
              <Text style={[styles.label, { color: colors.inkSoft }]}>Peso vivo antes del beneficio (kg)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
                placeholder="Ej. 18"
                placeholderTextColor={colors.inkFaint}
                keyboardType="numeric"
                value={pesoVivoPreBeneficioKg}
                onChangeText={(v) => {
                  setPesoVivoPreBeneficioKg(v)
                  setError(null)
                  setGuardadoOk(false)
                }}
              />
              <View style={[styles.computedBox, { backgroundColor: colors.accentSoft }]}>
                <Text style={{ color: colors.inkSoft, fontSize: 13 }}>Rendimiento de carcasa</Text>
                <Text style={{ color: colors.accentDim, fontWeight: '800', fontSize: 15 }}>
                  {rendimientoCarcasa != null ? `${rendimientoCarcasa}%` : '—'}
                </Text>
              </View>
            </>
          )}

          <Text style={[styles.label, { color: colors.inkSoft }]}>Comprador (opcional)</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
            placeholder="Nombre del comprador"
            placeholderTextColor={colors.inkFaint}
            value={compradorNombre}
            onChangeText={setCompradorNombre}
          />
          <Text style={[styles.hint, { color: colors.inkFaint }]}>
            🔒 Este dato queda solo en tu organización — nunca se muestra en la trazabilidad pública.
          </Text>

          {error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}
          {guardadoOk && (
            <Text style={[styles.hint, { color: colors.success, fontWeight: '700' }]}>Venta guardada. ✓</Text>
          )}

          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.accent }, !puedeGuardarAnimal && styles.buttonDisabled]}
            onPress={handleGuardarVentaAnimal}
            disabled={!puedeGuardarAnimal || guardando}
          >
            {guardando ? (
              <ActivityIndicator color={colors.accentInk} />
            ) : (
              <Text style={[styles.buttonText, { color: colors.accentInk }]}>Guardar venta</Text>
            )}
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={[styles.label, { color: colors.inkSoft }]}>Fecha</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
            placeholder="AAAA-MM-DD"
            placeholderTextColor={colors.inkFaint}
            value={fechaGuano}
            onChangeText={setFechaGuano}
          />

          <Text style={[styles.label, { color: colors.inkSoft }]}>Producto</Text>
          <View style={styles.chipsRow}>
            <Chip label="Guano" selected onPress={() => {}} />
          </View>

          <Text style={[styles.label, { color: colors.inkSoft }]}>Cantidad</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
            placeholder="Ej. 40"
            placeholderTextColor={colors.inkFaint}
            keyboardType="numeric"
            value={cantidadGuano}
            onChangeText={(v) => {
              setCantidadGuano(v)
              setError(null)
              setGuardadoOk(false)
            }}
          />

          <Text style={[styles.label, { color: colors.inkSoft }]}>Unidad</Text>
          <View style={styles.chipsRow}>
            <Chip label="Sacos" selected={unidadGuano === 'sacos'} onPress={() => setUnidadGuano('sacos')} />
            <Chip label="Kg" selected={unidadGuano === 'kg'} onPress={() => setUnidadGuano('kg')} />
          </View>

          <Text style={[styles.label, { color: colors.inkSoft }]}>Precio total (S/, opcional)</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
            placeholder="Ej. 80"
            placeholderTextColor={colors.inkFaint}
            keyboardType="numeric"
            value={precioTotalGuano}
            onChangeText={setPrecioTotalGuano}
          />

          <Text style={[styles.label, { color: colors.inkSoft }]}>Galpón de origen (opcional)</Text>
          {galpones.length === 0 ? (
            <Text style={[styles.hint, { color: colors.inkFaint }]}>No hay galpones creados.</Text>
          ) : (
            <View style={styles.chipsRow}>
              {galpones.map((g) => (
                <Chip
                  key={g.id}
                  label={g.codigo_galpon}
                  selected={galponId === g.id}
                  onPress={() => setGalponId(galponId === g.id ? null : g.id)}
                />
              ))}
            </View>
          )}

          <Text style={[styles.label, { color: colors.inkSoft }]}>Comprador (opcional)</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
            placeholder="Nombre del comprador"
            placeholderTextColor={colors.inkFaint}
            value={compradorGuano}
            onChangeText={setCompradorGuano}
          />

          {error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}
          {guardadoOk && (
            <Text style={[styles.hint, { color: colors.success, fontWeight: '700' }]}>Venta guardada. ✓</Text>
          )}

          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.accent }, !puedeGuardarGuano && styles.buttonDisabled]}
            onPress={handleGuardarGuano}
            disabled={!puedeGuardarGuano || guardando}
          >
            {guardando ? (
              <ActivityIndicator color={colors.accentInk} />
            ) : (
              <Text style={[styles.buttonText, { color: colors.accentInk }]}>Guardar venta</Text>
            )}
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
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginTop: 4,
  },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  computedBox: {
    borderRadius: 10,
    padding: 10,
    marginTop: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 12,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  stepperButton: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  stepperButtonText: { fontSize: 20, fontWeight: '700' },
  stepperValue: { minWidth: 48, textAlign: 'center', fontSize: 16, fontWeight: '800' },
  error: { fontFamily: 'PublicSans_600SemiBold', fontSize: 13, marginTop: 12 },
  button: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontFamily: 'PublicSans_700Bold', fontSize: 14 },
})
