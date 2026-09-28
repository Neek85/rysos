// Ficha de poza -- specs/app_granja_valencia_pozas_reproductores.md §3.
// Usa vw_pecuario_ocupacion_poza directo (ya trae los totales) -- no
// duplica ese cálculo a mano.
import { useCallback, useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { supabase } from '../../../../lib/supabase/client'
import { useThemeColors } from '../../../../theme/useThemeColors'
import { BackToInicioButton } from '../../../../components/ui/BackToInicioButton'

type OcupacionPoza = {
  id: string
  codigo_poza: string
  galpon_id: string | null
  tipo_uso: string
  capacidad_max: number | null
  total_animales: number
  total_hembras: number
  total_machos: number
  total_reproductores: number
  total_lotes: number
  total_lactancia: number
  sobre_capacidad: boolean
}

type Ocupante = { id: string; codigo_arete: string; sexo: string }
type LoteResumen = { id: string; codigo_lote: string; cantidad_actual: number }

// El botón de alta solo aplica a pozas donde tiene sentido un
// reproductor identificado -- regla real por tipo de poza (mockup), no
// un toggle de organización.
const TIPOS_CON_ALTA_REPRODUCTOR = ['empadre', 'maternidad']

export default function FichaPozaScreen() {
  const colors = useThemeColors()
  const { id } = useLocalSearchParams<{ id: string }>()

  const [poza, setPoza] = useState<OcupacionPoza | null>(null)
  const [galponNombre, setGalponNombre] = useState<string | null>(null)
  const [ocupantes, setOcupantes] = useState<Ocupante[]>([])
  const [lotes, setLotes] = useState<LoteResumen[]>([])

  const cargar = useCallback(async () => {
    if (!id) return
    const { data: pozaData } = await supabase.from('vw_pecuario_ocupacion_poza').select('*').eq('id', id).maybeSingle()
    if (!pozaData) return
    setPoza(pozaData as OcupacionPoza)

    if (pozaData.galpon_id) {
      const { data: galponData } = await supabase
        .from('PECUARIO_GALPONES')
        .select('codigo_galpon, nombre')
        .eq('id', pozaData.galpon_id)
        .maybeSingle()
      setGalponNombre(galponData ? galponData.nombre ?? galponData.codigo_galpon : null)
    } else {
      setGalponNombre(null)
    }

    const [ocupantesRes, lotesRes] = await Promise.all([
      supabase
        .from('PECUARIO_REPRODUCTORES')
        .select('id, codigo_arete, sexo')
        .eq('jaula_actual_id', id)
        .eq('estado', 'activo'),
      supabase.from('PECUARIO_LOTES').select('id, codigo_lote, cantidad_actual').eq('poza_actual_id', id),
    ])
    if (ocupantesRes.data) setOcupantes(ocupantesRes.data as Ocupante[])
    if (lotesRes.data) setLotes(lotesRes.data as LoteResumen[])
  }, [id])

  useEffect(() => {
    cargar()
  }, [cargar])

  if (!poza) {
    return (
      <ScrollView style={[styles.container, { backgroundColor: colors.bg }]} contentContainerStyle={styles.content}>
        <BackToInicioButton />
        <Text style={{ color: colors.inkSoft }}>Cargando…</Text>
      </ScrollView>
    )
  }

  const permiteAltaReproductor = TIPOS_CON_ALTA_REPRODUCTOR.includes(poza.tipo_uso)

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.bg }]} contentContainerStyle={styles.content}>
      <BackToInicioButton />

      <View style={styles.header}>
        <View>
          <Text style={[styles.codigo, { color: colors.ink }]}>{poza.codigo_poza}</Text>
          <Text style={[styles.meta, { color: colors.inkSoft }]}>
            {galponNombre ? `${galponNombre} · ` : ''}
            {poza.tipo_uso}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: poza.sobre_capacidad ? colors.dangerSoft : colors.successSoft }]}>
          <Text style={[styles.badgeText, { color: poza.sobre_capacidad ? colors.danger : colors.success }]}>
            {poza.total_animales} / {poza.capacidad_max ?? '—'}
          </Text>
        </View>
      </View>

      <View style={[styles.panel, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
        <FichaRow label="Reproductores" value={String(poza.total_reproductores)} colors={colors} />
        <FichaRow label="Hembras" value={String(poza.total_hembras)} colors={colors} />
        <FichaRow label="Machos" value={String(poza.total_machos)} colors={colors} />
        <FichaRow label="Lotes" value={String(poza.total_lotes)} colors={colors} />
        <FichaRow label="Lactancia" value={String(poza.total_lactancia)} colors={colors} last />
      </View>

      <Text style={[styles.seccionTitulo, { color: colors.inkFaint }]}>Ocupantes</Text>
      {ocupantes.length === 0 ? (
        <Text style={[styles.itemListaVacia, { color: colors.inkFaint }]}>Sin reproductores activos en esta poza.</Text>
      ) : (
        ocupantes.map((o) => (
          <Text key={o.id} style={[styles.itemLista, { color: colors.ink }]}>
            {o.codigo_arete} · {o.sexo}
          </Text>
        ))
      )}

      <Text style={[styles.seccionTitulo, { color: colors.inkFaint, marginTop: 14 }]}>Lotes</Text>
      {lotes.length === 0 ? (
        <Text style={[styles.itemListaVacia, { color: colors.inkFaint }]}>
          Sin lotes todavía (llega con Destete).
        </Text>
      ) : (
        lotes.map((l) => (
          <Text key={l.id} style={[styles.itemLista, { color: colors.ink }]}>
            {l.codigo_lote} · {l.cantidad_actual}
          </Text>
        ))
      )}

      {permiteAltaReproductor && (
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.accent }]}
          onPress={() => router.push({ pathname: '/reproductores/nuevo', params: { jaula: poza.id } })}
        >
          <Text style={[styles.buttonText, { color: colors.accentInk }]}>+ Nuevo reproductor en esta poza</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  )
}

function FichaRow({
  label,
  value,
  colors,
  last,
}: {
  label: string
  value: string
  colors: ReturnType<typeof useThemeColors>
  last?: boolean
}) {
  return (
    <View style={[styles.fichaRow, !last && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
      <Text style={{ color: colors.inkSoft, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 13 }}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 18, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 },
  codigo: { fontFamily: 'Archivo_800ExtraBold', fontSize: 22 },
  meta: { fontFamily: 'PublicSans_400Regular', fontSize: 13, marginTop: 2 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontFamily: 'PublicSans_700Bold', fontSize: 12 },
  panel: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, marginBottom: 16 },
  fichaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  seccionTitulo: {
    fontFamily: 'PublicSans_700Bold',
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  itemListaVacia: { fontFamily: 'PublicSans_400Regular', fontSize: 13, paddingVertical: 4 },
  itemLista: { fontFamily: 'PublicSans_400Regular', fontSize: 13, paddingVertical: 4 },
  button: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  buttonText: { fontFamily: 'PublicSans_700Bold', fontSize: 14 },
})
