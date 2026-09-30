// Registrar traslado -- specs/app_granja_valencia_traslado.md. Backend
// real PECUARIO_TRASLADOS, trg_procesar_traslado resuelve TODO del lado
// del servidor: origen_jaula_id (siempre, en ambos modos) y
// cantidad_actual/lote_nuevo_id (traslado parcial) -- el cliente nunca
// los calcula ni los manda. Único dato real que el cliente decide y
// valida: destino_jaula_id (excluyendo el origen, por
// chk_traslados_origen_destino_distintos) y, en modo lote parcial,
// cantidad/codigo_lote_nuevo (con el mismo tope de UX que Pesaje,
// aunque acá el trigger también lo rechaza si se pasa).
import { useCallback, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { TrasladoSchema } from '../../../../../../lib/validations/pecuario'
import { supabase } from '../../../../lib/supabase/client'
import { useProfile } from '../../../../lib/supabase/useProfile'
import { useThemeColors } from '../../../../theme/useThemeColors'
import { BackToInicioButton } from '../../../../components/ui/BackToInicioButton'
import { Chip } from '../../../../components/ui/Chip'

type LoteOption = { id: string; codigo_lote: string; poza_actual_id: string | null; cantidad_actual: number | null }
type ReproductorOption = { id: string; codigo_arete: string; jaula_actual_id: string }
type JaulaOption = { id: string; codigo_poza: string }

const MOTIVOS = [
  { valor: 'enfermedad_aislamiento' as const, label: 'Enfermedad / aislamiento' },
  { valor: 'recomposicion_poza' as const, label: 'Recomposición de poza' },
  { valor: 'sobrepoblacion' as const, label: 'Sobrepoblación' },
  { valor: 'otro' as const, label: 'Otro' },
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

export default function RegistrarTrasladoScreen() {
  const colors = useThemeColors()
  const { organizacion } = useProfile()

  const [cargando, setCargando] = useState(true)
  const [lotes, setLotes] = useState<LoteOption[]>([])
  const [reproductores, setReproductores] = useState<ReproductorOption[]>([])
  const [jaulas, setJaulas] = useState<JaulaOption[]>([])

  const [modo, setModo] = useState<'lote' | 'reproductor'>('lote')

  // Modo lote
  const [loteId, setLoteId] = useState<string | null>(null)
  const [alcance, setAlcance] = useState<'completo' | 'parcial'>('completo')
  const [cantidad, setCantidad] = useState(1)
  const [codigoLoteNuevo, setCodigoLoteNuevo] = useState('')

  // Modo reproductor
  const [busquedaAnimal, setBusquedaAnimal] = useState('')
  const [animalId, setAnimalId] = useState<string | null>(null)

  // Comunes
  const [destinoJaulaId, setDestinoJaulaId] = useState<string | null>(null)
  const [fecha, setFecha] = useState(hoyISO())
  const [motivo, setMotivo] = useState<(typeof MOTIVOS)[number]['valor']>('enfermedad_aislamiento')
  const [observaciones, setObservaciones] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [guardadoOk, setGuardadoOk] = useState(false)

  const cargar = useCallback(() => {
    if (!organizacion) return
    setCargando(true)
    Promise.all([
      supabase
        .from('PECUARIO_LOTES')
        .select('id, codigo_lote, poza_actual_id, cantidad_actual')
        .eq('ID_Organizacion', organizacion)
        .order('created_at'),
      supabase
        .from('PECUARIO_REPRODUCTORES')
        .select('id, codigo_arete, jaula_actual_id')
        .eq('ID_Organizacion', organizacion)
        .eq('estado', 'activo')
        .not('jaula_actual_id', 'is', null)
        .order('codigo_arete'),
      supabase
        .from('PECUARIO_JAULAS')
        .select('id, codigo_poza')
        .eq('ID_Organizacion', organizacion)
        .order('codigo_poza'),
    ]).then(([lotesRes, reproductoresRes, jaulasRes]) => {
      setLotes((lotesRes.data ?? []) as LoteOption[])
      setReproductores((reproductoresRes.data ?? []) as ReproductorOption[])
      setJaulas((jaulasRes.data ?? []) as JaulaOption[])
      setCargando(false)
    })
  }, [organizacion])

  useFocusEffect(cargar)

  const loteSeleccionado = lotes.find((l) => l.id === loteId) ?? null
  const animalSeleccionado = reproductores.find((r) => r.id === animalId) ?? null
  const maxCantidad = loteSeleccionado?.cantidad_actual ?? null
  const codigoPozaPorId = new Map(jaulas.map((j) => [j.id, j.codigo_poza]))

  const origenJaulaId = modo === 'lote' ? loteSeleccionado?.poza_actual_id ?? null : animalSeleccionado?.jaula_actual_id ?? null
  // chk_traslados_origen_destino_distintos es real -- no se ofrece la
  // jaula/poza de origen como destino posible.
  const jaulasDestino = jaulas.filter((j) => j.id !== origenJaulaId)

  async function sugerirCodigoLoteNuevo() {
    if (!organizacion) return
    const { data } = await supabase.from('PECUARIO_LOTES').select('codigo_lote').eq('ID_Organizacion', organizacion)
    let max = 0
    for (const row of data ?? []) {
      const match = /^L-(\d+)$/.exec(row.codigo_lote ?? '')
      if (match) {
        const n = parseInt(match[1], 10)
        if (n > max) max = n
      }
    }
    setCodigoLoteNuevo(`L-${String(max + 1).padStart(3, '0')}`)
  }

  function seleccionarLote(l: LoteOption) {
    setLoteId(l.id)
    setError(null)
    setGuardadoOk(false)
    if (destinoJaulaId === l.poza_actual_id) setDestinoJaulaId(null)
    // Mismo criterio que Pesaje: si el lote nuevo tiene menos animales
    // que la cantidad ya ingresada, se ajusta hacia abajo.
    if (l.cantidad_actual != null && cantidad > l.cantidad_actual) {
      setCantidad(Math.max(1, l.cantidad_actual))
    }
  }

  function seleccionarAnimal(r: ReproductorOption) {
    setAnimalId(r.id)
    setError(null)
    setGuardadoOk(false)
    if (destinoJaulaId === r.jaula_actual_id) setDestinoJaulaId(null)
  }

  function seleccionarAlcance(nuevo: 'completo' | 'parcial') {
    setAlcance(nuevo)
    setError(null)
    setGuardadoOk(false)
    if (nuevo === 'parcial' && !codigoLoteNuevo) sugerirCodigoLoteNuevo()
  }

  async function handleGuardar() {
    setError(null)
    setGuardadoOk(false)
    if (!organizacion || !destinoJaulaId) return
    if (modo === 'lote' && !loteId) return
    if (modo === 'reproductor' && !animalId) return

    // No confiar solo en el tope del stepper -- valida de nuevo contra
    // el dato real justo antes de guardar (el trigger también lo
    // rechaza, esto es una segunda capa de defensa del lado del
    // cliente, spec §0).
    if (modo === 'lote' && alcance === 'parcial' && maxCantidad != null && cantidad > maxCantidad) {
      setError(`No puedes trasladar más de los ${maxCantidad} animales que tiene el lote.`)
      return
    }

    const parsed = TrasladoSchema.safeParse({
      ID_Organizacion: organizacion,
      tipo_origen: modo,
      lote_id: modo === 'lote' ? loteId : null,
      animal_id: modo === 'reproductor' ? animalId : null,
      destino_jaula_id: destinoJaulaId,
      alcance: modo === 'lote' ? alcance : null,
      cantidad: modo === 'lote' && alcance === 'parcial' ? cantidad : null,
      codigo_lote_nuevo: modo === 'lote' && alcance === 'parcial' ? codigoLoteNuevo : null,
      fecha,
      motivo_traslado: motivo,
      observaciones: observaciones || null,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos.')
      return
    }

    setGuardando(true)
    try {
      const { error: insertError } = await supabase.from('PECUARIO_TRASLADOS').insert(parsed.data)
      if (insertError) {
        // Mensaje real de Postgres tal cual (incluye el RAISE EXCEPTION
        // del trigger si algo se escapó del lado del cliente).
        setError(insertError.message)
        return
      }

      setGuardadoOk(true)
      setLoteId(null)
      setAnimalId(null)
      setDestinoJaulaId(null)
      setCantidad(1)
      setCodigoLoteNuevo('')
      setObservaciones('')
      cargar()
    } finally {
      setGuardando(false)
    }
  }

  const reproductoresFiltrados = reproductores.filter((r) =>
    r.codigo_arete.toLowerCase().includes(busquedaAnimal.trim().toLowerCase())
  )

  const puedeGuardar =
    !!organizacion &&
    !!destinoJaulaId &&
    (modo === 'lote' ? !!loteId && (alcance === 'completo' || (cantidad > 0 && !!codigoLoteNuevo.trim())) : !!animalId)

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
      <Text style={[styles.title, { color: colors.ink }]}>Registrar traslado</Text>
      <Text style={[styles.subtitle, { color: colors.inkSoft }]}>
        Movimiento interno entre pozas o jaulas
      </Text>

      <View style={styles.chipsRow}>
        <Chip
          label="Lote (poblacional)"
          selected={modo === 'lote'}
          onPress={() => {
            setModo('lote')
            setError(null)
            setGuardadoOk(false)
            setDestinoJaulaId(null)
          }}
        />
        <Chip
          label="Reproductor identificado"
          selected={modo === 'reproductor'}
          onPress={() => {
            setModo('reproductor')
            setError(null)
            setGuardadoOk(false)
            setDestinoJaulaId(null)
          }}
        />
      </View>

      {modo === 'lote' ? (
        <>
          <Text style={[styles.label, { color: colors.inkSoft }]}>Lote</Text>
          {lotes.length === 0 ? (
            <Text style={[styles.hint, { color: colors.inkFaint }]}>Todavía no hay lotes creados.</Text>
          ) : (
            <View style={styles.chipsRow}>
              {lotes.map((l) => (
                <Chip
                  key={l.id}
                  label={`${l.codigo_lote}${l.poza_actual_id ? ` (${codigoPozaPorId.get(l.poza_actual_id) ?? '—'})` : ''}`}
                  selected={loteId === l.id}
                  onPress={() => seleccionarLote(l)}
                />
              ))}
            </View>
          )}

          <Text style={[styles.label, { color: colors.inkSoft }]}>¿Cuánto se traslada?</Text>
          <View style={styles.chipsRow}>
            <Chip label="Todo el lote" selected={alcance === 'completo'} onPress={() => seleccionarAlcance('completo')} />
            <Chip label="Una parte" selected={alcance === 'parcial'} onPress={() => seleccionarAlcance('parcial')} />
          </View>

          {alcance === 'parcial' && (
            <>
              <Text style={[styles.label, { color: colors.inkSoft }]}>Cantidad a trasladar</Text>
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

              <Text style={[styles.label, { color: colors.inkSoft }]}>Código del lote nuevo</Text>
              <View style={styles.row}>
                <TextInput
                  style={[
                    styles.input,
                    styles.inputFlex,
                    { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink },
                  ]}
                  placeholder="Ej. L-006"
                  placeholderTextColor={colors.inkFaint}
                  value={codigoLoteNuevo}
                  onChangeText={(v) => {
                    setCodigoLoteNuevo(v)
                    setError(null)
                    setGuardadoOk(false)
                  }}
                  autoCapitalize="characters"
                />
                <TouchableOpacity
                  style={[styles.sugerirButton, { backgroundColor: colors.accentSoft }]}
                  onPress={sugerirCodigoLoteNuevo}
                >
                  <Text style={[styles.sugerirText, { color: colors.accentDim }]}>Sugerir</Text>
                </TouchableOpacity>
              </View>
            </>
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
            <Text style={[styles.hint, { color: colors.inkFaint }]}>
              No hay reproductores identificados asignados a una jaula.
            </Text>
          ) : (
            <View style={styles.chipsRow}>
              {reproductoresFiltrados.map((r) => (
                <Chip key={r.id} label={r.codigo_arete} selected={animalId === r.id} onPress={() => seleccionarAnimal(r)} />
              ))}
            </View>
          )}
        </>
      )}

      <Text style={[styles.label, { color: colors.inkSoft }]}>Jaula/poza destino</Text>
      {jaulasDestino.length === 0 ? (
        <Text style={[styles.hint, { color: colors.inkFaint }]}>No hay otra jaula/poza disponible como destino.</Text>
      ) : (
        <View style={styles.chipsRow}>
          {jaulasDestino.map((j) => (
            <Chip
              key={j.id}
              label={j.codigo_poza}
              selected={destinoJaulaId === j.id}
              onPress={() => {
                setDestinoJaulaId(j.id)
                setError(null)
                setGuardadoOk(false)
              }}
            />
          ))}
        </View>
      )}

      <Text style={[styles.label, { color: colors.inkSoft }]}>Fecha</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
        placeholder="AAAA-MM-DD"
        placeholderTextColor={colors.inkFaint}
        value={fecha}
        onChangeText={setFecha}
      />

      <Text style={[styles.label, { color: colors.inkSoft }]}>Motivo del traslado</Text>
      <View style={styles.chipsRow}>
        {MOTIVOS.map((m) => (
          <Chip
            key={m.valor}
            label={m.label}
            selected={motivo === m.valor}
            onPress={() => {
              setMotivo(m.valor)
              setError(null)
              setGuardadoOk(false)
            }}
          />
        ))}
      </View>

      <Text style={[styles.label, { color: colors.inkSoft }]}>Observaciones (opcional)</Text>
      <TextInput
        style={[styles.input, styles.textArea, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
        placeholder="Ej. 3 gazapos con síntomas respiratorios"
        placeholderTextColor={colors.inkFaint}
        value={observaciones}
        onChangeText={setObservaciones}
        multiline
      />

      {error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}
      {guardadoOk && (
        <Text style={[styles.hint, { color: colors.success, fontWeight: '700' }]}>Traslado guardado. ✓</Text>
      )}

      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.accent }, !puedeGuardar && styles.buttonDisabled]}
        onPress={handleGuardar}
        disabled={!puedeGuardar || guardando}
      >
        {guardando ? (
          <ActivityIndicator color={colors.accentInk} />
        ) : (
          <Text style={[styles.buttonText, { color: colors.accentInk }]}>Guardar traslado</Text>
        )}
      </TouchableOpacity>
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
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginTop: 4,
  },
  inputFlex: { flex: 1 },
  textArea: { minHeight: 70, textAlignVertical: 'top' },
  sugerirButton: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 12, marginTop: 4 },
  sugerirText: { fontFamily: 'PublicSans_700Bold', fontSize: 13 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
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
