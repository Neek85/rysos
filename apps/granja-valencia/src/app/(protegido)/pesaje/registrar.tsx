// Registrar pesaje -- specs/app_granja_valencia_pesaje.md. Backend real
// PECUARIO_PESAJES, sin hotfixes. peso_promedio_g es GENERATED ALWAYS
// (confirmado en vivo) -- nunca se manda en el INSERT, solo se replica la
// misma fórmula en el cliente para el computed-box. ganancia_diaria_estimada_g
// no es generada -- se calcula acá buscando el pesaje anterior más
// reciente del mismo lote; si no hay ninguno (primer pesaje real del
// lote, sin línea base en ningún lado), queda NULL a propósito (spec §0).
import { useCallback, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { PesajeSchema } from '../../../../../../lib/validations/pecuario'
import { supabase } from '../../../../lib/supabase/client'
import { useProfile } from '../../../../lib/supabase/useProfile'
import { useThemeColors } from '../../../../theme/useThemeColors'
import { BackToInicioButton } from '../../../../components/ui/BackToInicioButton'
import { Chip } from '../../../../components/ui/Chip'

type LoteOption = { id: string; codigo_lote: string; cantidad_actual: number | null }
type PesajeAnterior = { fecha_pesaje: string; peso_promedio_g: number }

function hoyISO() {
  return new Date().toISOString().slice(0, 10)
}

function diasEntre(anteriorISO: string, actualISO: string) {
  const anterior = new Date(`${anteriorISO}T00:00:00Z`).getTime()
  const actual = new Date(`${actualISO}T00:00:00Z`).getTime()
  return Math.round((actual - anterior) / 86400000)
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

export default function RegistrarPesajeScreen() {
  const colors = useThemeColors()
  const { organizacion } = useProfile()

  const [cargando, setCargando] = useState(true)
  const [lotes, setLotes] = useState<LoteOption[]>([])
  const [loteId, setLoteId] = useState<string | null>(null)
  const [fechaPesaje, setFechaPesaje] = useState(hoyISO())
  const [animalesMuestreados, setAnimalesMuestreados] = useState(1)
  const [pesoMuestra, setPesoMuestra] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [guardadoOk, setGuardadoOk] = useState(false)

  const cargar = useCallback(() => {
    if (!organizacion) return
    setCargando(true)
    supabase
      .from('PECUARIO_LOTES')
      .select('id, codigo_lote, cantidad_actual')
      .eq('ID_Organizacion', organizacion)
      // cantidad_actual=0 (lote vendido/trasladado por completo) no
      // tiene nada que pesar -- PECUARIO_LOTES.estado nunca cambia
      // solo cuando un lote se agota, así que este filtro es la única
      // forma real de excluirlo (hallazgo cerrado junto con Venta, ver
      // specs/app_granja_valencia_venta.md §1).
      .gt('cantidad_actual', 0)
      .order('created_at')
      .then(({ data }) => {
        setLotes((data ?? []) as LoteOption[])
        setCargando(false)
      })
  }, [organizacion])

  useFocusEffect(cargar)

  const loteSeleccionado = lotes.find((l) => l.id === loteId) ?? null
  const maxAnimales = loteSeleccionado?.cantidad_actual ?? null

  function seleccionarLote(l: LoteOption) {
    setLoteId(l.id)
    setError(null)
    setGuardadoOk(false)
    // Si el lote nuevo tiene menos animales que el valor ya ingresado
    // (o que se venía de un lote anterior con más cabezas), se ajusta
    // hacia abajo -- nunca se deja un valor que ya sabemos inválido para
    // este lote (spec: PECUARIO_PESAJES no tiene ningún CHECK/trigger
    // real que limite animales_muestreados contra cantidad_actual, así
    // que esto vive 100% del lado del cliente).
    if (l.cantidad_actual != null && animalesMuestreados > l.cantidad_actual) {
      setAnimalesMuestreados(Math.max(1, l.cantidad_actual))
    }
  }

  const pesoMuestraNum = parseFloat(pesoMuestra)
  const pesoPromedio =
    Number.isFinite(pesoMuestraNum) && pesoMuestraNum > 0 && animalesMuestreados > 0
      ? pesoMuestraNum / animalesMuestreados
      : null

  async function handleGuardar() {
    setError(null)
    setGuardadoOk(false)
    if (!organizacion || !loteId || pesoPromedio === null) return

    // No confiar solo en el tope del stepper -- valida de nuevo contra
    // el dato real justo antes de guardar (cubre cualquier vía por la
    // que animales_muestreados haya llegado a superar cantidad_actual).
    if (maxAnimales != null && animalesMuestreados > maxAnimales) {
      setError(`No puedes muestrear más de los ${maxAnimales} animales que tiene el lote.`)
      return
    }

    setGuardando(true)
    try {
      // Pesaje anterior más reciente de este lote -- misma consulta que
      // usa vw_pecuario_seguimiento_lote (fecha_pesaje DESC, created_at
      // DESC) para elegir "el más reciente" cuando hay más de uno el
      // mismo día.
      const { data: anterior } = await supabase
        .from('PECUARIO_PESAJES')
        .select('fecha_pesaje, peso_promedio_g')
        .eq('lote_id', loteId)
        .order('fecha_pesaje', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      let gananciaDiaria: number | null = null
      if (anterior) {
        const previa = anterior as PesajeAnterior
        const dias = diasEntre(previa.fecha_pesaje, fechaPesaje)
        if (dias > 0) {
          gananciaDiaria = Math.round(((pesoPromedio - previa.peso_promedio_g) / dias) * 100) / 100
        }
      }

      const parsed = PesajeSchema.safeParse({
        ID_Organizacion: organizacion,
        lote_id: loteId,
        fecha_pesaje: fechaPesaje,
        animales_muestreados: animalesMuestreados,
        peso_total_muestra_g: pesoMuestraNum,
        peso_promedio_g: pesoPromedio,
        ganancia_diaria_estimada_g: gananciaDiaria,
      })
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? 'Datos inválidos.')
        return
      }

      // peso_promedio_g es GENERATED ALWAYS -- se excluye del INSERT, la
      // calcula Postgres sola (spec §0/§2).
      const { peso_promedio_g: _pesoPromedioIgnorado, ...payload } = parsed.data
      const { error: insertError } = await supabase.from('PECUARIO_PESAJES').insert(payload)
      if (insertError) {
        setError(insertError.message)
        return
      }

      setGuardadoOk(true)
      setPesoMuestra('')
      setAnimalesMuestreados(1)
    } finally {
      setGuardando(false)
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
      <Text style={[styles.title, { color: colors.ink }]}>Registrar pesaje</Text>
      <Text style={[styles.subtitle, { color: colors.inkSoft }]}>
        Control de crecimiento del lote
      </Text>

      <Text style={[styles.label, { color: colors.inkSoft }]}>Lote</Text>
      {lotes.length === 0 ? (
        <Text style={[styles.hint, { color: colors.inkFaint }]}>Todavía no hay lotes creados.</Text>
      ) : (
        <View style={styles.chipsRow}>
          {lotes.map((l) => (
            <Chip
              key={l.id}
              label={l.codigo_lote}
              selected={loteId === l.id}
              onPress={() => seleccionarLote(l)}
            />
          ))}
        </View>
      )}

      <Text style={[styles.label, { color: colors.inkSoft }]}>Fecha</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
        placeholder="AAAA-MM-DD"
        placeholderTextColor={colors.inkFaint}
        value={fechaPesaje}
        onChangeText={(v) => {
          setFechaPesaje(v)
          setError(null)
          setGuardadoOk(false)
        }}
      />

      <Text style={[styles.label, { color: colors.inkSoft }]}>Animales muestreados</Text>
      <Stepper
        value={animalesMuestreados}
        onChange={(v) => {
          setAnimalesMuestreados(v)
          setError(null)
          setGuardadoOk(false)
        }}
        min={1}
        max={maxAnimales}
      />
      {maxAnimales != null && (
        <Text style={[styles.hint, { color: colors.inkFaint }]}>Máximo disponible en este lote: {maxAnimales}</Text>
      )}

      <Text style={[styles.label, { color: colors.inkSoft }]}>Peso total de la muestra (g)</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
        placeholder="Ej. 6400"
        placeholderTextColor={colors.inkFaint}
        keyboardType="numeric"
        value={pesoMuestra}
        onChangeText={(v) => {
          setPesoMuestra(v)
          setError(null)
          setGuardadoOk(false)
        }}
      />

      <View style={[styles.computedBox, { backgroundColor: colors.accentSoft }]}>
        <Text style={{ color: colors.inkSoft, fontSize: 13 }}>Peso promedio por animal</Text>
        <Text style={{ color: colors.accentDim, fontWeight: '800', fontSize: 15 }}>
          {pesoPromedio !== null ? `${pesoPromedio.toFixed(1)} g` : '—'}
        </Text>
      </View>

      {error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}
      {guardadoOk && (
        <Text style={[styles.hint, { color: colors.success, fontWeight: '700' }]}>Pesaje guardado. ✓</Text>
      )}

      <TouchableOpacity
        style={[
          styles.button,
          { backgroundColor: colors.accent },
          (!loteId || pesoPromedio === null) && styles.buttonDisabled,
        ]}
        onPress={handleGuardar}
        disabled={!loteId || pesoPromedio === null || guardando}
      >
        {guardando ? (
          <ActivityIndicator color={colors.accentInk} />
        ) : (
          <Text style={[styles.buttonText, { color: colors.accentInk }]}>Guardar pesaje</Text>
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
    marginTop: 16,
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
