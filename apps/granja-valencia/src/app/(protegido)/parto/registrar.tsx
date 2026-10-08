// Registrar parto -- specs/app_granja_valencia_parto.md. Solo modo
// "Reproductora identificada" (madre_id obligatorio) -- el modo
// poblacional del mockup queda fuera de esta pantalla (spec §1).
// macho_id se resuelve acá contra PECUARIO_HISTORIAL_MACHOS -- ningún
// trigger real lo completa solo (confirmado en vivo antes de escribir
// esto). Landmine real documentado en el spec: trg_generar_destete_parto
// asume columnas de TAREAS que no están confirmadas contra el esquema
// real -- si un INSERT falla por eso, se muestra el error real de
// Postgres, sin reintentar ciegamente.
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { PartoRegistroSchema } from '../../../../../../lib/validations/pecuario'
import { supabase } from '../../../../lib/supabase/client'
import { useProfile } from '../../../../lib/supabase/useProfile'
import { hoyOperativo } from '../../../../lib/fecha/hoyOperativo'
import { useThemeColors } from '../../../../theme/useThemeColors'
import { BackToInicioButton } from '../../../../components/ui/BackToInicioButton'
import { Chip } from '../../../../components/ui/Chip'

type MadreOption = { id: string; codigo_arete: string; jaula_actual_id: string }

function Stepper({
  value,
  onChange,
  min = 0,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
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
        onPress={() => onChange(value + 1)}
      >
        <Text style={[styles.stepperButtonText, { color: colors.accentDim }]}>+</Text>
      </TouchableOpacity>
    </View>
  )
}

export default function RegistrarPartoScreen() {
  const colors = useThemeColors()
  const { organizacion } = useProfile()

  const [madres, setMadres] = useState<MadreOption[]>([])
  const [busquedaMadre, setBusquedaMadre] = useState('')
  const [madreId, setMadreId] = useState<string | null>(null)

  const [pozaCodigo, setPozaCodigo] = useState<string | null>(null)
  const [machoId, setMachoId] = useState<string | null>(null)
  const [machoCodigo, setMachoCodigo] = useState<string | null>(null)
  const [resolviendoMacho, setResolviendoMacho] = useState(false)

  const [fechaParto, setFechaParto] = useState(hoyOperativo())
  const [nVivos, setNVivos] = useState(0)
  const [nMuertos, setNMuertos] = useState(0)
  const [pesoTotalCamada, setPesoTotalCamada] = useState('')
  const [observaciones, setObservaciones] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!organizacion) return
    supabase
      .from('PECUARIO_REPRODUCTORES')
      .select('id, codigo_arete, jaula_actual_id')
      .eq('ID_Organizacion', organizacion)
      .eq('sexo', 'hembra')
      .eq('estado', 'activo')
      .not('jaula_actual_id', 'is', null)
      .then(({ data }) => data && setMadres(data as MadreOption[]))
  }, [organizacion])

  const resolverPozaYMacho = useCallback(async (madre: MadreOption) => {
    setResolviendoMacho(true)
    try {
      const { data: poza } = await supabase
        .from('PECUARIO_JAULAS')
        .select('codigo_poza')
        .eq('id', madre.jaula_actual_id)
        .maybeSingle()
      setPozaCodigo(poza?.codigo_poza ?? null)

      // Ningún trigger real completa esto solo -- se resuelve acá contra
      // PECUARIO_HISTORIAL_MACHOS (fecha_salida IS NULL = todavía activo
      // en esa jaula), confirmado en vivo antes de escribir esta pantalla.
      const { data: historial } = await supabase
        .from('PECUARIO_HISTORIAL_MACHOS')
        .select('macho_id')
        .eq('jaula_id', madre.jaula_actual_id)
        .is('fecha_salida', null)
        .maybeSingle()

      if (historial?.macho_id) {
        const { data: macho } = await supabase
          .from('PECUARIO_REPRODUCTORES')
          .select('codigo_arete')
          .eq('id', historial.macho_id)
          .maybeSingle()
        setMachoId(historial.macho_id)
        setMachoCodigo(macho?.codigo_arete ?? null)
      } else {
        setMachoId(null)
        setMachoCodigo(null)
      }
    } finally {
      setResolviendoMacho(false)
    }
  }, [])

  function handleElegirMadre(madre: MadreOption) {
    setMadreId(madre.id)
    setPozaCodigo(null)
    setMachoId(null)
    setMachoCodigo(null)
    resolverPozaYMacho(madre)
  }

  async function handleGuardar() {
    setError(null)
    if (!organizacion || !madreId) return

    const madre = madres.find((m) => m.id === madreId)
    if (!madre) return

    const parsed = PartoRegistroSchema.safeParse({
      ID_Organizacion: organizacion,
      poza_id: madre.jaula_actual_id,
      madre_id: madreId,
      macho_id: machoId,
      fecha_parto: fechaParto,
      n_vivos: nVivos,
      n_muertos: nMuertos,
      peso_total_camada_g: pesoTotalCamada || undefined,
      observaciones: observaciones || undefined,
    })

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos.')
      return
    }

    setSaving(true)
    try {
      const { error: insertError } = await supabase.from('PECUARIO_PARTOS').insert(parsed.data)
      if (insertError) {
        // Landmine real de trg_generar_destete_parto/TAREAS (spec §3) --
        // se muestra tal cual, sin reintentar ciegamente.
        setError(insertError.message)
        return
      }
      router.back()
    } finally {
      setSaving(false)
    }
  }

  const madresFiltradas = madres.filter((m) =>
    m.codigo_arete.toLowerCase().includes(busquedaMadre.trim().toLowerCase())
  )

  const pesoPromedio =
    pesoTotalCamada && nVivos > 0 ? (Number(pesoTotalCamada) / nVivos).toFixed(1) : null

  const puedeGuardar = !!organizacion && !!madreId && !resolviendoMacho

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.bg }]} contentContainerStyle={styles.content}>
      <BackToInicioButton />
      <Text style={[styles.title, { color: colors.ink }]}>Registrar parto</Text>

      <Text style={[styles.label, { color: colors.inkSoft }]}>Reproductora (madre)</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
        placeholder="Código de arete (ej. H-014)"
        placeholderTextColor={colors.inkFaint}
        value={busquedaMadre}
        onChangeText={setBusquedaMadre}
      />
      {madres.length === 0 ? (
        <Text style={[styles.hint, { color: colors.inkFaint }]}>
          No hay reproductoras identificadas asignadas a una poza.
        </Text>
      ) : (
        <View style={styles.chipsRow}>
          {madresFiltradas.map((m) => (
            <Chip
              key={m.id}
              label={m.codigo_arete}
              selected={madreId === m.id}
              onPress={() => handleElegirMadre(m)}
            />
          ))}
        </View>
      )}

      {madreId && (
        <View style={[styles.panel, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
          <Text style={{ color: colors.inkSoft, fontSize: 13 }}>
            Poza: <Text style={{ color: colors.ink, fontWeight: '700' }}>{pozaCodigo ?? '—'}</Text>
          </Text>
          <Text style={{ color: colors.inkSoft, fontSize: 13, marginTop: 4 }}>
            Macho activo:{' '}
            <Text style={{ color: colors.ink, fontWeight: '700' }}>
              {resolviendoMacho ? '…' : machoCodigo ?? 'Sin macho activo asignado'}
            </Text>
          </Text>
        </View>
      )}

      <Text style={[styles.label, { color: colors.inkSoft }]}>Fecha</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
        placeholder="AAAA-MM-DD"
        placeholderTextColor={colors.inkFaint}
        value={fechaParto}
        onChangeText={setFechaParto}
      />

      <Text style={[styles.label, { color: colors.inkSoft }]}>Gazapos nacidos vivos</Text>
      <Stepper value={nVivos} onChange={setNVivos} min={0} />

      <Text style={[styles.label, { color: colors.inkSoft }]}>Nacidos muertos</Text>
      <Stepper value={nMuertos} onChange={setNMuertos} min={0} />

      <Text style={[styles.label, { color: colors.inkSoft }]}>Peso total de la camada (g, opcional)</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
        placeholder="Ej. 420"
        placeholderTextColor={colors.inkFaint}
        keyboardType="numeric"
        value={pesoTotalCamada}
        onChangeText={setPesoTotalCamada}
      />
      {pesoPromedio && (
        <View style={[styles.computedBox, { backgroundColor: colors.accentSoft }]}>
          <Text style={{ color: colors.inkSoft, fontSize: 13 }}>Peso promedio por cría</Text>
          <Text style={{ color: colors.accentDim, fontWeight: '800', fontSize: 15 }}>{pesoPromedio} g</Text>
        </View>
      )}

      <Text style={[styles.label, { color: colors.inkSoft }]}>Observaciones (opcional)</Text>
      <TextInput
        style={[styles.input, styles.textArea, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
        placeholder="Ej. parto asistido, camada uniforme…"
        placeholderTextColor={colors.inkFaint}
        value={observaciones}
        onChangeText={setObservaciones}
        multiline
      />

      {error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}

      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.accent }, !puedeGuardar && styles.buttonDisabled]}
        onPress={handleGuardar}
        disabled={!puedeGuardar || saving}
      >
        {saving ? (
          <ActivityIndicator color={colors.accentInk} />
        ) : (
          <Text style={[styles.buttonText, { color: colors.accentInk }]}>Guardar parto</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 18, paddingBottom: 40 },
  title: { fontFamily: 'Archivo_800ExtraBold', fontSize: 20, marginBottom: 16 },
  label: { fontFamily: 'PublicSans_700Bold', fontSize: 13, marginBottom: 6, marginTop: 12 },
  hint: { fontFamily: 'PublicSans_400Regular', fontSize: 13 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginTop: 4,
  },
  textArea: { minHeight: 70, textAlignVertical: 'top' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  panel: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 12 },
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
  computedBox: {
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  error: { fontFamily: 'PublicSans_600SemiBold', fontSize: 13, marginTop: 12 },
  button: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontFamily: 'PublicSans_700Bold', fontSize: 14 },
})
