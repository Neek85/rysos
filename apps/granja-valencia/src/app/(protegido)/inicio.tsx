// Pantalla Inicio (hub post-login) -- specs/app_granja_valencia_inicio.md.
// Réplica del mockup real (claude.ai/artifact/7vebvnVwLNR15TT9DL2DyX,
// líneas 727-816). Reemplaza a galpones-pozas.tsx como pantalla raíz
// autenticada -- galpones-pozas sigue existiendo, alcanzable desde el
// tile "Pozas" del grid.
import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { PoblacionResumenSchema } from '../../../../../lib/validations/pecuario'
import { supabase } from '../../../lib/supabase/client'
import { useProfile } from '../../../lib/supabase/useProfile'
import { useThemeColors } from '../../../theme/useThemeColors'
import { Icon, type IconName } from '../../../components/ui/Icon'

type Accion = {
  label: string
  icon: IconName
  route: '/galpones-pozas' | { pathname: '/proximamente/[title]'; params: { title: string } }
  danger?: boolean
}

// Mismo orden que el grid de 12 acciones del mockup. "Empadre" queda
// SIEMPRE visible -- desviación deliberada, ver spec §5 (el mockup lo
// condiciona a un toggle de "identificación individual" que no existe
// como columna real en PECUARIO_CONFIGURACION).
const ACCIONES: Accion[] = [
  { label: 'Parto', icon: 'parto', route: { pathname: '/proximamente/[title]', params: { title: 'Parto' } } },
  { label: 'Destete', icon: 'destete', route: { pathname: '/proximamente/[title]', params: { title: 'Destete' } } },
  { label: 'Pesaje', icon: 'pesaje', route: { pathname: '/proximamente/[title]', params: { title: 'Pesaje' } } },
  {
    label: 'Mortalidad',
    icon: 'mortalidad',
    route: { pathname: '/proximamente/[title]', params: { title: 'Mortalidad' } },
    danger: true,
  },
  { label: 'Traslado', icon: 'traslado', route: { pathname: '/proximamente/[title]', params: { title: 'Traslado' } } },
  { label: 'Venta', icon: 'venta', route: { pathname: '/proximamente/[title]', params: { title: 'Venta' } } },
  { label: 'Sanidad', icon: 'sanidad', route: { pathname: '/proximamente/[title]', params: { title: 'Sanidad' } } },
  { label: 'Insumos', icon: 'insumos', route: { pathname: '/proximamente/[title]', params: { title: 'Insumos' } } },
  { label: 'Compras', icon: 'compras', route: { pathname: '/proximamente/[title]', params: { title: 'Compras' } } },
  { label: 'Empadre', icon: 'empadre', route: { pathname: '/proximamente/[title]', params: { title: 'Empadre' } } },
  { label: 'Lotes', icon: 'lotes', route: { pathname: '/proximamente/[title]', params: { title: 'Lotes' } } },
  { label: 'Pozas', icon: 'pozas', route: '/galpones-pozas' },
]

export default function InicioScreen() {
  const colors = useThemeColors()
  const { organizacion } = useProfile()
  const [poblacionTotal, setPoblacionTotal] = useState<number | null>(null)
  const [reproductorasActivas, setReproductorasActivas] = useState<number | null>(null)

  useEffect(() => {
    if (!organizacion) return
    let cancelled = false

    supabase
      .from('vw_pecuario_poblacion_resumen')
      .select('*')
      .eq('ID_Organizacion', organizacion)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        if (!data) {
          setPoblacionTotal(0)
          return
        }
        const parsed = PoblacionResumenSchema.safeParse(data)
        setPoblacionTotal(parsed.success ? parsed.data.total_poblacion : 0)
      })

    supabase
      .from('PECUARIO_REPRODUCTORES')
      .select('*', { count: 'exact', head: true })
      .eq('ID_Organizacion', organizacion)
      .eq('sexo', 'hembra')
      .eq('estado', 'activo')
      .then(({ count }) => {
        if (cancelled) return
        setReproductorasActivas(count ?? 0)
      })

    return () => {
      cancelled = true
    }
  }, [organizacion])

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.bg }]} contentContainerStyle={styles.content}>
      <TouchableOpacity
        onPress={() => router.push({ pathname: '/proximamente/[title]', params: { title: 'Dashboard' } })}
      >
        <View style={styles.statRow}>
          <View style={[styles.statTile, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
            <Text style={[styles.statNum, { color: colors.ink }]}>{poblacionTotal ?? '—'}</Text>
            <Text style={[styles.statLabel, { color: colors.inkSoft }]}>Población total</Text>
          </View>
          <View style={[styles.statTile, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
            <Text style={[styles.statNum, { color: colors.ink }]}>{reproductorasActivas ?? '—'}</Text>
            <Text style={[styles.statLabel, { color: colors.inkSoft }]}>Reproductoras activas</Text>
          </View>
          {/* Única tile ilustrativa -- opacity 0.7, valor de ejemplo fijo
              (no hay todavía registro histórico de mortalidad por fecha
              para calcular una tasa mensual real). Ver spec §5. */}
          <View style={[styles.statTile, styles.statTileEjemplo, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
            <Text style={[styles.statNum, { color: colors.success }]}>2.1%</Text>
            <Text style={[styles.statLabel, { color: colors.inkSoft }]}>Mortalidad del mes (ejemplo)</Text>
          </View>
        </View>
        <Text style={[styles.statCta, { color: colors.accentDim }]}>Ver panel completo →</Text>
      </TouchableOpacity>

      <View>
        <Text style={[styles.sectionLabel, { color: colors.inkFaint }]}>Alertas</Text>
        <Text style={[styles.hint, { color: colors.inkFaint }]}>
          No hay tareas ni sugerencias pendientes por ahora.
        </Text>
      </View>

      <View>
        <Text style={[styles.sectionLabel, { color: colors.inkFaint }]}>Registrar</Text>
        <View style={styles.grid}>
          {ACCIONES.map((accion) => (
            <TouchableOpacity
              key={accion.label}
              style={[styles.actionCard, { backgroundColor: colors.surface2, borderColor: colors.border }]}
              onPress={() => router.push(accion.route as never)}
            >
              <View
                style={[
                  styles.iconWrap,
                  { backgroundColor: accion.danger ? colors.dangerSoft : colors.accentSoft },
                ]}
              >
                <Icon name={accion.icon} size={18} color={accion.danger ? colors.danger : colors.accentDim} />
              </View>
              <Text style={[styles.actionLabel, { color: colors.ink }]}>{accion.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 18,
    paddingBottom: 40,
    gap: 16,
  },
  statRow: {
    flexDirection: 'row',
    gap: 10,
  },
  statTile: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 2,
  },
  statTileEjemplo: {
    opacity: 0.7,
  },
  statNum: {
    fontFamily: 'PublicSans_800ExtraBold',
    fontSize: 20,
  },
  statLabel: {
    fontFamily: 'PublicSans_600SemiBold',
    fontSize: 11,
  },
  statCta: {
    textAlign: 'right',
    fontFamily: 'PublicSans_700Bold',
    fontSize: 12,
    marginTop: 6,
  },
  sectionLabel: {
    fontFamily: 'PublicSans_700Bold',
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  hint: {
    fontFamily: 'PublicSans_400Regular',
    fontSize: 13,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionCard: {
    width: '47%',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 8,
    alignItems: 'flex-start',
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    fontFamily: 'PublicSans_700Bold',
    fontSize: 13,
  },
})
