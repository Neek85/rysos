// Alta de reproductor -- specs/app_granja_valencia_pozas_reproductores.md
// §4. proposito/estado quedan en su default de tabla, no se envían.
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { ReproductorAltaSchema, SEXO_CUY } from '../../../../../../lib/validations/pecuario'
import { supabase } from '../../../../lib/supabase/client'
import { useProfile } from '../../../../lib/supabase/useProfile'
import { useThemeColors } from '../../../../theme/useThemeColors'
import { BackToInicioButton } from '../../../../components/ui/BackToInicioButton'
import { Chip } from '../../../../components/ui/Chip'
import { AdvertenciaBanner } from '../../../../components/ui/AdvertenciaBanner'

const RAZAS = ['Andina', 'Perú', 'Inti', 'Otra'] as const

type PozaOption = { id: string; codigo_poza: string }
type ReproductorOption = { id: string; codigo_arete: string }

export default function AltaReproductorScreen() {
  const colors = useThemeColors()
  const { organizacion } = useProfile()
  const { jaula: jaulaParam } = useLocalSearchParams<{ jaula?: string }>()

  const [sexo, setSexo] = useState<(typeof SEXO_CUY)[number]>('hembra')
  const [codigoArete, setCodigoArete] = useState('')
  const [raza, setRaza] = useState<(typeof RAZAS)[number]>('Andina')
  const [razaOtra, setRazaOtra] = useState('')
  const [fechaNacimiento, setFechaNacimiento] = useState('')
  const [jaulaId, setJaulaId] = useState<string | null>(jaulaParam ?? null)
  const [madreId, setMadreId] = useState<string | null>(null)
  const [padreId, setPadreId] = useState<string | null>(null)

  const [pozas, setPozas] = useState<PozaOption[]>([])
  const [hembras, setHembras] = useState<ReproductorOption[]>([])
  const [machos, setMachos] = useState<ReproductorOption[]>([])

  const [advertencias, setAdvertencias] = useState<string[]>([])
  const [entiendoRiesgo, setEntiendoRiesgo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!organizacion) return
    supabase
      .from('PECUARIO_JAULAS')
      .select('id, codigo_poza')
      .eq('ID_Organizacion', organizacion)
      .then(({ data }) => data && setPozas(data as PozaOption[]))
    supabase
      .from('PECUARIO_REPRODUCTORES')
      .select('id, codigo_arete')
      .eq('ID_Organizacion', organizacion)
      .eq('sexo', 'hembra')
      .eq('estado', 'activo')
      .then(({ data }) => data && setHembras(data as ReproductorOption[]))
    supabase
      .from('PECUARIO_REPRODUCTORES')
      .select('id, codigo_arete')
      .eq('ID_Organizacion', organizacion)
      .eq('sexo', 'macho')
      .eq('estado', 'activo')
      .then(({ data }) => data && setMachos(data as ReproductorOption[]))
  }, [organizacion])

  // Aviso de consanguinidad NO bloqueante -- spec §4. Gateado por
  // PECUARIO_CONFIGURACION.alerta_consanguinidad_activa (fallback true/3
  // -- default de columna, igual al default de fn_son_parientes() -- si
  // la organización todavía no tiene fila propia, mismo criterio que el
  // resto del módulo). "Jaula ya ocupada" comparte el mismo banner y el
  // mismo toggle (ver comentario real de la migración 20260927100000).
  const verificarAdvertencias = useCallback(async () => {
    if (!jaulaId || !organizacion) {
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
    const sexoOpuesto = sexo === 'macho' ? 'hembra' : 'macho'
    const { data: ocupantes } = await supabase
      .from('PECUARIO_REPRODUCTORES')
      .select('id, codigo_arete')
      .eq('jaula_actual_id', jaulaId)
      .eq('estado', 'activo')
      .eq('sexo', sexoOpuesto)

    for (const ocupante of ocupantes ?? []) {
      if (madreId) {
        const { data: rel } = await supabase.rpc('fn_son_parientes', {
          animal_a: madreId,
          animal_b: ocupante.id,
          generaciones,
        })
        if (rel) detalle.push(`Emparentado con ${ocupante.codigo_arete} (vía madre).`)
      }
      if (padreId) {
        const { data: rel } = await supabase.rpc('fn_son_parientes', {
          animal_a: padreId,
          animal_b: ocupante.id,
          generaciones,
        })
        if (rel) detalle.push(`Emparentado con ${ocupante.codigo_arete} (vía padre).`)
      }
    }

    if (sexo === 'macho') {
      const { data: otroMacho } = await supabase.rpc('fn_jaula_tiene_otro_macho_activo', {
        p_jaula_id: jaulaId,
      })
      if (otroMacho) detalle.push('Esta jaula ya tiene otro macho activo.')
    }

    setAdvertencias(detalle)
    if (detalle.length === 0) setEntiendoRiesgo(false)
  }, [jaulaId, madreId, padreId, sexo, organizacion])

  useEffect(() => {
    verificarAdvertencias()
  }, [verificarAdvertencias])

  async function sugerirCodigo() {
    if (!organizacion) return
    const prefijo = sexo === 'macho' ? 'M' : 'H'
    const { data } = await supabase
      .from('PECUARIO_REPRODUCTORES')
      .select('codigo_arete')
      .eq('ID_Organizacion', organizacion)
      .ilike('codigo_arete', `${prefijo}-%`)

    let max = 0
    for (const row of data ?? []) {
      const match = /^([HM])-(\d+)$/.exec(row.codigo_arete)
      if (match && match[1] === prefijo) {
        const n = parseInt(match[2], 10)
        if (n > max) max = n
      }
    }
    setCodigoArete(`${prefijo}-${String(max + 1).padStart(3, '0')}`)
  }

  async function handleGuardar() {
    setError(null)
    if (!organizacion) return

    const parsed = ReproductorAltaSchema.safeParse({
      ID_Organizacion: organizacion,
      codigo_arete: codigoArete,
      sexo,
      raza: raza === 'Otra' ? razaOtra || undefined : raza,
      fecha_nacimiento: fechaNacimiento || undefined,
      jaula_actual_id: jaulaId,
      madre_id: madreId,
      padre_id: padreId,
      advertencia_confirmada: advertencias.length > 0 ? entiendoRiesgo : false,
    })

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos.')
      return
    }

    setSaving(true)
    try {
      const { error: insertError } = await supabase.from('PECUARIO_REPRODUCTORES').insert(parsed.data)
      if (insertError) {
        // uq_reproductor_org_arete -- unique_violation real de Postgres,
        // mensaje claro en vez del error crudo.
        if (insertError.code === '23505') {
          setError('Ya existe un reproductor con ese código de arete en esta organización.')
        } else {
          setError(insertError.message)
        }
        return
      }
      router.back()
    } finally {
      setSaving(false)
    }
  }

  const puedeGuardar = !!organizacion && codigoArete.trim().length > 0 && (advertencias.length === 0 || entiendoRiesgo)

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.bg }]} contentContainerStyle={styles.content}>
      <BackToInicioButton />
      <Text style={[styles.title, { color: colors.ink }]}>Nuevo reproductor</Text>

      <Text style={[styles.label, { color: colors.inkSoft }]}>Sexo</Text>
      <View style={styles.chipsRow}>
        {SEXO_CUY.map((valor) => (
          <Chip key={valor} label={valor === 'hembra' ? 'Hembra' : 'Macho'} selected={sexo === valor} onPress={() => setSexo(valor)} />
        ))}
      </View>

      <Text style={[styles.label, { color: colors.inkSoft }]}>Código de arete</Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.inputFlex, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
          placeholder={sexo === 'macho' ? 'Ej. M-001' : 'Ej. H-001'}
          placeholderTextColor={colors.inkFaint}
          value={codigoArete}
          onChangeText={setCodigoArete}
          autoCapitalize="characters"
        />
        <TouchableOpacity style={[styles.sugerirButton, { backgroundColor: colors.accentSoft }]} onPress={sugerirCodigo}>
          <Text style={[styles.sugerirText, { color: colors.accentDim }]}>Sugerir</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.label, { color: colors.inkSoft }]}>Raza</Text>
      <View style={styles.chipsRow}>
        {RAZAS.map((valor) => (
          <Chip key={valor} label={valor} selected={raza === valor} onPress={() => setRaza(valor)} />
        ))}
      </View>
      {raza === 'Otra' && (
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
          placeholder="Especificá la raza"
          placeholderTextColor={colors.inkFaint}
          value={razaOtra}
          onChangeText={setRazaOtra}
        />
      )}

      <Text style={[styles.label, { color: colors.inkSoft }]}>Fecha de nacimiento (opcional)</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
        placeholder="AAAA-MM-DD"
        placeholderTextColor={colors.inkFaint}
        value={fechaNacimiento}
        onChangeText={setFechaNacimiento}
      />

      <Text style={[styles.label, { color: colors.inkSoft }]}>Jaula asignada</Text>
      <View style={styles.chipsRow}>
        <Chip label="Sin asignar" selected={jaulaId === null} onPress={() => setJaulaId(null)} />
        {pozas.map((p) => (
          <Chip key={p.id} label={p.codigo_poza} selected={jaulaId === p.id} onPress={() => setJaulaId(p.id)} />
        ))}
      </View>

      <Text style={[styles.label, { color: colors.inkSoft }]}>Madre</Text>
      {hembras.length === 0 ? (
        <Text style={[styles.hint, { color: colors.inkFaint }]}>Sin madre identificada.</Text>
      ) : (
        <View style={styles.chipsRow}>
          <Chip label="Sin madre identificada" selected={madreId === null} onPress={() => setMadreId(null)} />
          {hembras.map((h) => (
            <Chip key={h.id} label={h.codigo_arete} selected={madreId === h.id} onPress={() => setMadreId(h.id)} />
          ))}
        </View>
      )}

      <Text style={[styles.label, { color: colors.inkSoft }]}>Padre</Text>
      {machos.length === 0 ? (
        <Text style={[styles.hint, { color: colors.inkFaint }]}>Sin padre identificado.</Text>
      ) : (
        <View style={styles.chipsRow}>
          <Chip label="Sin padre identificado" selected={padreId === null} onPress={() => setPadreId(null)} />
          {machos.map((m) => (
            <Chip key={m.id} label={m.codigo_arete} selected={padreId === m.id} onPress={() => setPadreId(m.id)} />
          ))}
        </View>
      )}

      <AdvertenciaBanner
        advertencias={advertencias}
        entiendoRiesgo={entiendoRiesgo}
        onToggleEntiendoRiesgo={() => setEntiendoRiesgo((v) => !v)}
      />

      {error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}

      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.accent }, !puedeGuardar && styles.buttonDisabled]}
        onPress={handleGuardar}
        disabled={!puedeGuardar || saving}
      >
        {saving ? <ActivityIndicator color={colors.accentInk} /> : <Text style={[styles.buttonText, { color: colors.accentInk }]}>Guardar reproductor</Text>}
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
  error: { fontFamily: 'PublicSans_600SemiBold', fontSize: 13, marginTop: 12 },
  button: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontFamily: 'PublicSans_700Bold', fontSize: 14 },
})
