// Asignar macho a jaula (Empadre) -- specs/app_granja_valencia_empadre.md.
// INSERT en PECUARIO_HISTORIAL_MACHOS -- jaula_actual_id del macho y
// PECUARIO_RETIROS_MACHO_PENDIENTES los escriben los triggers reales
// (trg_historial_macho_efectos, trg_cerrar_historial_macho_anterior),
// nunca el cliente. Reasignar un macho que ya está en otra jaula
// funciona igual -- el trigger cierra su asignación anterior solo.
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { EmpadreAsignacionSchema } from '../../../../../../lib/validations/pecuario'
import { supabase } from '../../../../lib/supabase/client'
import { useProfile } from '../../../../lib/supabase/useProfile'
import { hoyOperativo } from '../../../../lib/fecha/hoyOperativo'
import { useThemeColors } from '../../../../theme/useThemeColors'
import { BackToInicioButton } from '../../../../components/ui/BackToInicioButton'
import { Chip } from '../../../../components/ui/Chip'
import { AdvertenciaBanner } from '../../../../components/ui/AdvertenciaBanner'

type PozaOption = { id: string; codigo_poza: string }
type MachoOption = { id: string; codigo_arete: string }

export default function AsignarMachoScreen() {
  const colors = useThemeColors()
  const { organizacion } = useProfile()

  const [jaulas, setJaulas] = useState<PozaOption[]>([])
  const [machos, setMachos] = useState<MachoOption[]>([])
  const [busquedaMacho, setBusquedaMacho] = useState('')

  const [jaulaId, setJaulaId] = useState<string | null>(null)
  const [machoId, setMachoId] = useState<string | null>(null)
  const [fechaEntrada, setFechaEntrada] = useState(hoyOperativo())
  const [fechaSalida, setFechaSalida] = useState('')

  const [advertencias, setAdvertencias] = useState<string[]>([])
  const [entiendoRiesgo, setEntiendoRiesgo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!organizacion) return
    // Solo pozas de empadre -- el macho candidato va a esa jaula, no a
    // maternidad/recría/engorde/aislamiento.
    supabase
      .from('PECUARIO_JAULAS')
      .select('id, codigo_poza')
      .eq('ID_Organizacion', organizacion)
      .eq('tipo_uso', 'empadre')
      .then(({ data }) => data && setJaulas(data as PozaOption[]))
    supabase
      .from('PECUARIO_REPRODUCTORES')
      .select('id, codigo_arete')
      .eq('ID_Organizacion', organizacion)
      .eq('sexo', 'macho')
      .eq('estado', 'activo')
      .then(({ data }) => data && setMachos(data as MachoOption[]))
  }, [organizacion])

  // Aviso NO bloqueante -- spec §... Gateado por
  // PECUARIO_CONFIGURACION.alerta_consanguinidad_activa (fallback true/3,
  // mismo criterio que Alta de reproductor). fn_son_parientes(macho_id,
  // hembra.id, generaciones) contra cada hembra activa de la jaula
  // elegida, + fn_jaula_tiene_otro_macho_activo(jaula_id, macho_id) para
  // detectar otro macho ya asignado.
  const verificarAdvertencias = useCallback(async () => {
    if (!jaulaId || !machoId || !organizacion) {
      setAdvertencias([])
      return
    }

    const { data: config } = await supabase
      .from('PECUARIO_CONFIGURACION')
      .select('alerta_consanguinidad_activa, generaciones_consanguinidad')
      .eq('ID_Organizacion', organizacion)
      .maybeSingle()
    const activa = config?.alerta_consanguinidad_activa ?? true
    const generaciones = config?.generaciones_consanguinidad ?? 3

    if (!activa) {
      setAdvertencias([])
      return
    }

    const detalle: string[] = []
    const { data: hembras } = await supabase
      .from('PECUARIO_REPRODUCTORES')
      .select('id, codigo_arete')
      .eq('jaula_actual_id', jaulaId)
      .eq('estado', 'activo')
      .eq('sexo', 'hembra')

    for (const hembra of hembras ?? []) {
      const { data: rel } = await supabase.rpc('fn_son_parientes', {
        animal_a: machoId,
        animal_b: hembra.id,
        generaciones,
      })
      if (rel) detalle.push(`Emparentado con ${hembra.codigo_arete}.`)
    }

    const { data: otroMacho } = await supabase.rpc('fn_jaula_tiene_otro_macho_activo', {
      p_jaula_id: jaulaId,
      p_macho_id_excluir: machoId,
    })
    if (otroMacho) detalle.push('Esta jaula ya tiene otro macho activo.')

    setAdvertencias(detalle)
    if (detalle.length === 0) setEntiendoRiesgo(false)
  }, [jaulaId, machoId, organizacion])

  useEffect(() => {
    verificarAdvertencias()
  }, [verificarAdvertencias])

  async function handleGuardar() {
    setError(null)
    if (!organizacion || !jaulaId || !machoId) return

    const parsed = EmpadreAsignacionSchema.safeParse({
      ID_Organizacion: organizacion,
      macho_id: machoId,
      jaula_id: jaulaId,
      fecha_entrada: fechaEntrada,
      fecha_salida: fechaSalida || undefined,
      advertencia_confirmada: advertencias.length > 0 ? entiendoRiesgo : false,
    })

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos.')
      return
    }

    setSaving(true)
    try {
      const { error: insertError } = await supabase.from('PECUARIO_HISTORIAL_MACHOS').insert(parsed.data)
      if (insertError) {
        setError(insertError.message)
        return
      }
      router.back()
    } finally {
      setSaving(false)
    }
  }

  const machosFiltrados = machos.filter((m) =>
    m.codigo_arete.toLowerCase().includes(busquedaMacho.trim().toLowerCase())
  )

  const puedeGuardar =
    !!organizacion && !!jaulaId && !!machoId && (advertencias.length === 0 || entiendoRiesgo)

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.bg }]} contentContainerStyle={styles.content}>
      <BackToInicioButton />
      <Text style={[styles.title, { color: colors.ink }]}>Asignar macho a jaula</Text>
      {/* Empadre continuo es el comportamiento real de hoy -- fijo, no
          condicional. No hay selector de "sistema de cría" -- sin efecto
          real todavía (spec §1). */}
      <Text style={[styles.subtitle, { color: colors.inkSoft }]}>
        Empadre continuo — el macho queda hasta que decidas rotarlo
      </Text>

      <Text style={[styles.label, { color: colors.inkSoft }]}>Jaula</Text>
      <View style={styles.chipsRow}>
        {jaulas.map((j) => (
          <Chip key={j.id} label={j.codigo_poza} selected={jaulaId === j.id} onPress={() => setJaulaId(j.id)} />
        ))}
      </View>
      {jaulas.length === 0 && (
        <Text style={[styles.hint, { color: colors.inkFaint }]}>Todavía no hay pozas de empadre creadas.</Text>
      )}

      <Text style={[styles.label, { color: colors.inkSoft }]}>Macho candidato</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
        placeholder="Código de arete (ej. M-009)"
        placeholderTextColor={colors.inkFaint}
        value={busquedaMacho}
        onChangeText={setBusquedaMacho}
      />
      <View style={styles.chipsRow}>
        {machosFiltrados.map((m) => (
          <Chip key={m.id} label={m.codigo_arete} selected={machoId === m.id} onPress={() => setMachoId(m.id)} />
        ))}
      </View>
      {machos.length === 0 && (
        <Text style={[styles.hint, { color: colors.inkFaint }]}>Todavía no hay machos activos.</Text>
      )}

      <AdvertenciaBanner
        advertencias={advertencias}
        entiendoRiesgo={entiendoRiesgo}
        onToggleEntiendoRiesgo={() => setEntiendoRiesgo((v) => !v)}
      />

      <Text style={[styles.label, { color: colors.inkSoft }]}>Fecha de ingreso</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
        placeholder="AAAA-MM-DD"
        placeholderTextColor={colors.inkFaint}
        value={fechaEntrada}
        onChangeText={setFechaEntrada}
      />

      <Text style={[styles.label, { color: colors.inkSoft }]}>Fecha de retiro (opcional)</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
        placeholder="AAAA-MM-DD"
        placeholderTextColor={colors.inkFaint}
        value={fechaSalida}
        onChangeText={setFechaSalida}
      />
      <Text style={[styles.hint, { color: colors.inkFaint }]}>
        Podés dejarlo en blanco — el macho queda en la jaula hasta que decidas rotarlo.
      </Text>

      {error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}

      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.accent }, !puedeGuardar && styles.buttonDisabled]}
        onPress={handleGuardar}
        disabled={!puedeGuardar || saving}
      >
        {saving ? (
          <ActivityIndicator color={colors.accentInk} />
        ) : (
          <Text style={[styles.buttonText, { color: colors.accentInk }]}>Guardar asignación</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 18, paddingBottom: 40 },
  title: { fontFamily: 'Archivo_800ExtraBold', fontSize: 20 },
  subtitle: { fontFamily: 'PublicSans_400Regular', fontSize: 13, marginTop: 2, marginBottom: 16 },
  label: { fontFamily: 'PublicSans_700Bold', fontSize: 13, marginBottom: 6, marginTop: 12 },
  hint: { fontFamily: 'PublicSans_400Regular', fontSize: 12, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginTop: 4,
    marginBottom: 8,
  },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  error: { fontFamily: 'PublicSans_600SemiBold', fontSize: 13, marginTop: 12 },
  button: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontFamily: 'PublicSans_700Bold', fontSize: 14 },
})
