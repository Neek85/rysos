// Header persistente de las rutas protegidas (specs/app_granja_valencia_inicio.md)
// -- replica visual del statusbar del mockup real. Reemplaza el botón de
// texto "Cerrar sesión" que vivía suelto en galpones-pozas.tsx -- ese
// comportamiento pasa a vivir acá. Montado UNA SOLA VEZ, vía
// screenOptions.header en src/app/(protegido)/_layout.tsx -- no se
// repite por pantalla.
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase/client'
import { useProfile } from '../lib/supabase/useProfile'
import { useThemeColors } from '../theme/useThemeColors'
import { Icon } from './ui/Icon'

export function AppHeader() {
  const insets = useSafeAreaInsets()
  const colors = useThemeColors()
  const { organizacion, nombreOrganizacion } = useProfile()

  async function handleCerrarSesion() {
    await supabase.auth.signOut()
  }

  return (
    <View style={[styles.statusbar, { backgroundColor: colors.accent, paddingTop: insets.top + 14 }]}>
      <View style={styles.row}>
        <View>
          <Text style={[styles.orgName, { color: colors.accentInk }]}>{nombreOrganizacion ?? '—'}</Text>
          <Text style={[styles.orgCode, { color: colors.accentInk }]}>{organizacion ?? '—'}</Text>
        </View>
        <View style={styles.rightGroup}>
          <View style={[styles.connPill, { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
            <View style={[styles.connDot, { backgroundColor: '#dff3df' }]} />
            <Text style={[styles.connLabel, { color: colors.accentInk }]}>En línea</Text>
          </View>
          <TouchableOpacity
            style={[styles.logoutBtn, { backgroundColor: 'rgba(255,255,255,0.18)' }]}
            onPress={handleCerrarSesion}
            accessibilityLabel="Cerrar sesión"
          >
            <Icon name="logout" size={16} color={colors.accentInk} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  statusbar: {
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  orgName: {
    fontFamily: 'Archivo_800ExtraBold',
    fontSize: 17,
  },
  orgCode: {
    fontFamily: 'PublicSans_600SemiBold',
    fontSize: 11,
    opacity: 0.82,
    letterSpacing: 0.5,
  },
  rightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  connPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  connDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  connLabel: {
    fontFamily: 'PublicSans_700Bold',
    fontSize: 11,
  },
  logoutBtn: {
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
