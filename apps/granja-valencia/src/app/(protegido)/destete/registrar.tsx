// Destete: recolección semanal + conformación de lotes por sexo --
// specs/app_granja_valencia_destete.md. Backend real ya construido, sin
// hotfixes (PECUARIO_RECOLECCIONES_DESTETE / PECUARIO_RECOLECCION_PARTOS
// / PECUARIO_LOTES.recoleccion_origen_id). La selección de partos es
// todo-o-nada -- trg_recoleccion_partos_validar fija cantidad_incluida
// al remanente completo, nunca a lo que mande el cliente.
import { useCallback, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import {
  LoteDesteteSchema,
  RecoleccionDesteteSchema,
  RecoleccionPartoSchema,
  SEXO_LOTE_DESTETE,
} from '../../../../../../lib/validations/pecuario'
import { supabase } from '../../../../lib/supabase/client'
import { useProfile } from '../../../../lib/supabase/useProfile'
import { useThemeColors } from '../../../../theme/useThemeColors'
import { BackToInicioButton } from '../../../../components/ui/BackToInicioButton'
import { Chip } from '../../../../components/ui/Chip'

type PartoLactancia = {
  parto_id: string
  poza_id: string
  fecha_parto: string
  n_vivos: number
  cantidad_restante: number
}

type PozaOption = { id: string; codigo_poza: string }
type LoteConformado = { codigo_lote: string; sexo: string; cantidad_inicial: number }

function hoyISO() {
  return new Date().toISOString().slice(0, 10)
}

function Stepper({ value, onChange, min = 1 }: { value: number; onChange: (v: number) => void; min?: number }) {
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
        onPress={() => onChange(value + 1)}
      >
        <Text style={[styles.stepperButtonText, { color: colors.accentDim }]}>+</Text>
      </TouchableOpacity>
    </View>
  )
}

export default function RegistrarDesteteScreen() {
  const colors = useThemeColors()
  const { organizacion } = useProfile()

  const [cargando, setCargando] = useState(true)
  const [paso, setPaso] = useState<1 | 2>(1)
  const [error, setError] = useState<string | null>(null)

  // Paso 1
  const [partosPendientes, setPartosPendientes] = useState<PartoLactancia[]>([])
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  const [fechaDestete, setFechaDestete] = useState(hoyISO())
  const [guardandoRecoleccion, setGuardandoRecoleccion] = useState(false)

  // Paso 2
  const [recoleccionId, setRecoleccionId] = useState<string | null>(null)
  const [cantidadPendiente, setCantidadPendiente] = useState(0)
  const [pozasRecria, setPozasRecria] = useState<PozaOption[]>([])
  const [sexoLote, setSexoLote] = useState<(typeof SEXO_LOTE_DESTETE)[number]>('hembra')
  const [pozaDestinoId, setPozaDestinoId] = useState<string | null>(null)
  const [cantidadLote, setCantidadLote] = useState(1)
  const [codigoLote, setCodigoLote] = useState('')
  const [lotesConformados, setLotesConformados] = useState<LoteConformado[]>([])
  const [guardandoLote, setGuardandoLote] = useState(false)

  const cargar = useCallback(() => {
    if (!organizacion) return
    setCargando(true)

    // Retomar una recolección abierta real (mejora sobre el mockup, que
    // solo la simulaba en memoria de sesión) -- spec §2.
    supabase
      .from('vw_pecuario_recolecciones_destete')
      .select('id, cantidad_pendiente, estado')
      .eq('ID_Organizacion', organizacion)
      .eq('estado', 'abierta')
      .maybeSingle()
      .then(async ({ data: abierta }) => {
        if (abierta) {
          setRecoleccionId(abierta.id)
          setCantidadPendiente(abierta.cantidad_pendiente)
          setPaso(2)
        } else {
          const { data: partos } = await supabase
            .from('vw_pecuario_lactancia_restante')
            .select('parto_id, poza_id, fecha_parto, n_vivos, cantidad_restante')
            .eq('ID_Organizacion', organizacion)
          setPartosPendientes((partos ?? []) as PartoLactancia[])
          setPaso(1)
        }

        const { data: pozas } = await supabase
          .from('PECUARIO_JAULAS')
          .select('id, codigo_poza')
          .eq('ID_Organizacion', organizacion)
          .eq('tipo_uso', 'recria')
        setPozasRecria((pozas ?? []) as PozaOption[])

        setCargando(false)
      })
  }, [organizacion])

  useFocusEffect(cargar)

  function toggleParto(partoId: string) {
    setSeleccionados((prev) => {
      const next = new Set(prev)
      if (next.has(partoId)) next.delete(partoId)
      else next.add(partoId)
      return next
    })
  }

  function seleccionarTodos() {
    setSeleccionados(new Set(partosPendientes.map((p) => p.parto_id)))
  }

  async function handleRegistrarRecoleccion() {
    setError(null)
    if (!organizacion || seleccionados.size === 0) return

    const parsedRecoleccion = RecoleccionDesteteSchema.safeParse({
      ID_Organizacion: organizacion,
      fecha_destete: fechaDestete,
    })
    if (!parsedRecoleccion.success) {
      setError(parsedRecoleccion.error.issues[0]?.message ?? 'Datos inválidos.')
      return
    }

    setGuardandoRecoleccion(true)
    try {
      const { data: recoleccion, error: recoleccionError } = await supabase
        .from('PECUARIO_RECOLECCIONES_DESTETE')
        .insert(parsedRecoleccion.data)
        .select('id')
        .single()
      if (recoleccionError || !recoleccion) {
        setError(recoleccionError?.message ?? 'No se pudo registrar la recolección.')
        return
      }

      const filas = Array.from(seleccionados).map((partoId) => {
        const parsed = RecoleccionPartoSchema.safeParse({
          ID_Organizacion: organizacion,
          recoleccion_id: recoleccion.id,
          parto_id: partoId,
        })
        return parsed.success ? parsed.data : null
      })
      if (filas.some((f) => f === null)) {
        setError('Datos inválidos al armar la recolección de partos.')
        return
      }

      const { error: partosError } = await supabase
        .from('PECUARIO_RECOLECCION_PARTOS')
        .insert(filas as NonNullable<(typeof filas)[number]>[])
      if (partosError) {
        setError(partosError.message)
        return
      }

      setSeleccionados(new Set())
      cargar()
    } finally {
      setGuardandoRecoleccion(false)
    }
  }

  async function sugerirCodigoLote() {
    if (!organizacion) return
    const { data } = await supabase
      .from('PECUARIO_LOTES')
      .select('codigo_lote')
      .eq('ID_Organizacion', organizacion)

    let max = 0
    for (const row of data ?? []) {
      const match = /^L-(\d+)$/.exec(row.codigo_lote ?? '')
      if (match) {
        const n = parseInt(match[1], 10)
        if (n > max) max = n
      }
    }
    setCodigoLote(`L-${String(max + 1).padStart(3, '0')}`)
  }

  async function handleAgregarLote() {
    setError(null)
    if (!organizacion || !recoleccionId || !pozaDestinoId) return

    const parsed = LoteDesteteSchema.safeParse({
      ID_Organizacion: organizacion,
      codigo_lote: codigoLote,
      poza_actual_id: pozaDestinoId,
      cantidad_inicial: cantidadLote,
      sexo: sexoLote,
      recoleccion_origen_id: recoleccionId,
      fecha_destete: fechaDestete,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos.')
      return
    }

    setGuardandoLote(true)
    try {
      // cantidad_actual no tiene default de columna ni trigger que la
      // inicialice (confirmado en vivo, hallazgo real de la primera
      // prueba: quedaba NULL, y vw_pecuario_seguimiento_lote/
      // vw_pecuario_ocupacion_poza/vw_pecuario_poblacion_resumen la usan
      // en SUM()/cálculos reales -- un lote con NULL quedaba invisible
      // en "Población total" pese a existir. Mismo criterio que
      // n_hembras_activas en el alta de poza (galpones-pozas.tsx): se
      // manda explícito, fuera del contrato Zod (es un valor derivado
      // al crear, no un campo que el usuario complete).
      const { error: insertError } = await supabase
        .from('PECUARIO_LOTES')
        .insert({ ...parsed.data, cantidad_actual: parsed.data.cantidad_inicial })
      if (insertError) {
        // trg_conformar_lote_destete -- mensaje real tal cual, sin reescribirlo.
        setError(insertError.message)
        return
      }

      setLotesConformados((prev) => [
        ...prev,
        { codigo_lote: codigoLote, sexo: sexoLote, cantidad_inicial: cantidadLote },
      ])
      setCodigoLote('')
      setCantidadLote(1)

      const { data: recoleccionActual } = await supabase
        .from('vw_pecuario_recolecciones_destete')
        .select('cantidad_pendiente')
        .eq('id', recoleccionId)
        .maybeSingle()
      setCantidadPendiente(recoleccionActual?.cantidad_pendiente ?? 0)
    } finally {
      setGuardandoLote(false)
    }
  }

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
      <Text style={[styles.title, { color: colors.ink }]}>Registrar destete</Text>

      {paso === 1 && (
        <>
          <Text style={[styles.subtitle, { color: colors.inkSoft }]}>
            Partos de la semana a destetar
          </Text>

          <Text style={[styles.label, { color: colors.inkSoft }]}>Fecha de destete</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
            placeholder="AAAA-MM-DD"
            placeholderTextColor={colors.inkFaint}
            value={fechaDestete}
            onChangeText={setFechaDestete}
          />

          {partosPendientes.length === 0 ? (
            <Text style={[styles.hint, { color: colors.inkFaint }]}>
              No hay camadas en lactancia pendientes de destete por ahora.
            </Text>
          ) : (
            <>
              <TouchableOpacity onPress={seleccionarTodos} style={{ marginTop: 8, marginBottom: 4 }}>
                <Text style={{ color: colors.accentDim, fontWeight: '700', fontSize: 13 }}>Seleccionar todos</Text>
              </TouchableOpacity>
              {partosPendientes.map((p) => {
                const marcado = seleccionados.has(p.parto_id)
                return (
                  <TouchableOpacity
                    key={p.parto_id}
                    style={[styles.checkRow, { backgroundColor: colors.surface2, borderColor: colors.border }]}
                    onPress={() => toggleParto(p.parto_id)}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        { borderColor: colors.accent },
                        marcado && { backgroundColor: colors.accent },
                      ]}
                    />
                    <Text style={{ color: colors.ink, fontSize: 13 }}>
                      Parto {p.fecha_parto} — {p.cantidad_restante} gazapo{p.cantidad_restante === 1 ? '' : 's'}
                    </Text>
                  </TouchableOpacity>
                )
              })}

              <View style={[styles.computedBox, { backgroundColor: colors.accentSoft }]}>
                <Text style={{ color: colors.inkSoft, fontSize: 13 }}>Total a recolectar</Text>
                <Text style={{ color: colors.accentDim, fontWeight: '800', fontSize: 15 }}>
                  {partosPendientes
                    .filter((p) => seleccionados.has(p.parto_id))
                    .reduce((sum, p) => sum + p.cantidad_restante, 0)}{' '}
                  gazapos
                </Text>
              </View>

              {error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}

              <TouchableOpacity
                style={[
                  styles.button,
                  { backgroundColor: colors.accent },
                  seleccionados.size === 0 && styles.buttonDisabled,
                ]}
                onPress={handleRegistrarRecoleccion}
                disabled={seleccionados.size === 0 || guardandoRecoleccion}
              >
                {guardandoRecoleccion ? (
                  <ActivityIndicator color={colors.accentInk} />
                ) : (
                  <Text style={[styles.buttonText, { color: colors.accentInk }]}>
                    Registrar recolección y conformar lotes
                  </Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </>
      )}

      {paso === 2 && (
        <>
          <View style={[styles.panel, { backgroundColor: colors.amberSoft }]}>
            <Text style={{ color: colors.amber, fontWeight: '700', fontSize: 14 }}>Recolección registrada</Text>
            <Text style={{ color: colors.inkSoft, fontSize: 13, marginTop: 4 }}>
              Ahora conformá los lotes por sexo, uno por uno.
            </Text>
          </View>

          <View style={[styles.computedBox, { backgroundColor: colors.accentSoft }]}>
            <Text style={{ color: colors.inkSoft, fontSize: 13 }}>Gazapos por conformar en lotes</Text>
            <Text style={{ color: colors.accentDim, fontWeight: '800', fontSize: 15 }}>
              {cantidadPendiente} pendientes
            </Text>
          </View>

          {lotesConformados.length > 0 && (
            <View style={{ marginTop: 12 }}>
              <Text style={[styles.label, { color: colors.inkFaint }]}>Lotes conformados en esta sesión</Text>
              {lotesConformados.map((l, i) => (
                <Text key={i} style={{ color: colors.ink, fontSize: 13, paddingVertical: 2 }}>
                  {l.codigo_lote} · {l.sexo} · {l.cantidad_inicial}
                </Text>
              ))}
            </View>
          )}

          {cantidadPendiente > 0 && (
            <>
              <Text style={[styles.label, { color: colors.inkSoft }]}>Sexo del lote</Text>
              <View style={styles.chipsRow}>
                {SEXO_LOTE_DESTETE.map((valor) => (
                  <Chip
                    key={valor}
                    label={valor === 'macho' ? 'Machos' : 'Hembras'}
                    selected={sexoLote === valor}
                    onPress={() => setSexoLote(valor)}
                  />
                ))}
              </View>

              <Text style={[styles.label, { color: colors.inkSoft }]}>Poza destino (recría)</Text>
              {pozasRecria.length === 0 ? (
                <Text style={[styles.hint, { color: colors.inkFaint }]}>
                  Todavía no hay pozas de recría creadas.
                </Text>
              ) : (
                <View style={styles.chipsRow}>
                  {pozasRecria.map((p) => (
                    <Chip
                      key={p.id}
                      label={p.codigo_poza}
                      selected={pozaDestinoId === p.id}
                      onPress={() => setPozaDestinoId(p.id)}
                    />
                  ))}
                </View>
              )}

              <Text style={[styles.label, { color: colors.inkSoft }]}>Cantidad para este lote</Text>
              <Stepper value={cantidadLote} onChange={setCantidadLote} min={1} />
              <Text style={[styles.hint, { color: colors.inkFaint }]}>Máximo disponible: {cantidadPendiente}</Text>

              <Text style={[styles.label, { color: colors.inkSoft }]}>Código de lote</Text>
              <View style={styles.row}>
                <TextInput
                  style={[
                    styles.input,
                    styles.inputFlex,
                    { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink },
                  ]}
                  placeholder="Ej. L-001"
                  placeholderTextColor={colors.inkFaint}
                  value={codigoLote}
                  onChangeText={setCodigoLote}
                  autoCapitalize="characters"
                />
                <TouchableOpacity
                  style={[styles.sugerirButton, { backgroundColor: colors.accentSoft }]}
                  onPress={sugerirCodigoLote}
                >
                  <Text style={[styles.sugerirText, { color: colors.accentDim }]}>Sugerir</Text>
                </TouchableOpacity>
              </View>

              {error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}

              <TouchableOpacity
                style={[
                  styles.button,
                  { backgroundColor: colors.accent },
                  (!pozaDestinoId || !codigoLote.trim()) && styles.buttonDisabled,
                ]}
                onPress={handleAgregarLote}
                disabled={!pozaDestinoId || !codigoLote.trim() || guardandoLote}
              >
                {guardandoLote ? (
                  <ActivityIndicator color={colors.accentInk} />
                ) : (
                  <Text style={[styles.buttonText, { color: colors.accentInk }]}>+ Agregar este lote</Text>
                )}
              </TouchableOpacity>
            </>
          )}

          {cantidadPendiente === 0 && (
            <Text style={[styles.hint, { color: colors.success, marginTop: 12, fontWeight: '700' }]}>
              Recolección cerrada — todos los gazapos ya quedaron en un lote. ✓
            </Text>
          )}
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
  sugerirButton: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 12 },
  sugerirText: { fontFamily: 'PublicSans_700Bold', fontSize: 13 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 2 },
  computedBox: {
    borderRadius: 10,
    padding: 10,
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  panel: { borderRadius: 12, padding: 12, marginTop: 8, marginBottom: 4 },
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
