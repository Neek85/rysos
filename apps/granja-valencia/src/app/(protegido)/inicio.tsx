// Pantalla Inicio (hub post-login) -- specs/app_granja_valencia_inicio.md.
// Réplica del mockup real (claude.ai/artifact/7vebvnVwLNR15TT9DL2DyX,
// líneas 727-816). Reemplaza a galpones-pozas.tsx como pantalla raíz
// autenticada. El tile "Pozas" apunta a pozas/index.tsx (directorio real
// del mockup, specs/app_granja_valencia_pozas_reproductores.md) -- ya no
// a galpones-pozas.tsx directo; esa pantalla sigue intacta, reubicada
// como "+ Nueva poza / galpón" dentro del directorio.
import { useCallback, useState } from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { PoblacionResumenSchema } from '../../../../../lib/validations/pecuario'
import { supabase } from '../../../lib/supabase/client'
import { useProfile } from '../../../lib/supabase/useProfile'
import { useThemeColors } from '../../../theme/useThemeColors'
import { Icon, type IconName } from '../../../components/ui/Icon'

type Accion = {
  label: string
  icon: IconName
  route:
    | '/galpones-pozas'
    | '/pozas'
    | '/empadre/asignar-macho'
    | '/parto/registrar'
    | '/destete/registrar'
    | '/pesaje/registrar'
    | '/traslado/registrar'
    | { pathname: '/proximamente/[title]'; params: { title: string } }
  danger?: boolean
}

// Mismo orden que el grid de 12 acciones del mockup. "Empadre" queda
// SIEMPRE visible -- desviación deliberada, ver spec §5 (el mockup lo
// condiciona a un toggle de "identificación individual" que no existe
// como columna real en PECUARIO_CONFIGURACION).
const ACCIONES: Accion[] = [
  { label: 'Parto', icon: 'parto', route: '/parto/registrar' },
  { label: 'Destete', icon: 'destete', route: '/destete/registrar' },
  { label: 'Pesaje', icon: 'pesaje', route: '/pesaje/registrar' },
  {
    label: 'Mortalidad',
    icon: 'mortalidad',
    route: { pathname: '/proximamente/[title]', params: { title: 'Mortalidad' } },
    danger: true,
  },
  { label: 'Traslado', icon: 'traslado', route: '/traslado/registrar' },
  { label: 'Venta', icon: 'venta', route: { pathname: '/proximamente/[title]', params: { title: 'Venta' } } },
  { label: 'Sanidad', icon: 'sanidad', route: { pathname: '/proximamente/[title]', params: { title: 'Sanidad' } } },
  { label: 'Insumos', icon: 'insumos', route: { pathname: '/proximamente/[title]', params: { title: 'Insumos' } } },
  { label: 'Compras', icon: 'compras', route: { pathname: '/proximamente/[title]', params: { title: 'Compras' } } },
  { label: 'Empadre', icon: 'empadre', route: '/empadre/asignar-macho' },
  { label: 'Lotes', icon: 'lotes', route: { pathname: '/proximamente/[title]', params: { title: 'Lotes' } } },
  { label: 'Pozas', icon: 'pozas', route: '/pozas' },
]

export default function InicioScreen() {
  const colors = useThemeColors()
  const { organizacion } = useProfile()
  const [poblacionTotal, setPoblacionTotal] = useState<number | null>(null)
  const [reproductorasActivas, setReproductorasActivas] = useState<number | null>(null)

  // Fix (2026-09-29): antes era un useEffect([organizacion]) plano --
  // Expo Router mantiene Inicio montado al navegar, así que volver acá
  // con router.back() (ej. después de Registrar parto) NO remonta el
  // componente ni cambia `organizacion`, y el fetch nunca se repetía --
  // los stat-tiles quedaban con el valor de la primera vez que Inicio se
  // montó, aunque la base ya tuviera el dato real actualizado
  // (confirmado en vivo: vw_pecuario_poblacion_resumen ya devolvía el
  // total correcto, el problema era 100% de refetch del cliente).
  // useFocusEffect (re-exportado por expo-router, mismo hook de
  // @react-navigation/native -- se usa ese import por consistencia con
  // el resto de la app, que ya importa todo lo de routing desde
  // 'expo-router') corre de nuevo cada vez que la pantalla gana foco,
  // no solo al montar. reproductorasActivas comparte el mismo problema
  // (mismo bloque de efecto, mismos datos que cambian en otra pantalla)
  // así que se envuelve junto con población -- no es una tile aparte sin
  // relación.
  const cargarStats = useCallback(() => {
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

  useFocusEffect(cargarStats)

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
