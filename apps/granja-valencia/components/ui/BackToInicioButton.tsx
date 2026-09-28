// Réplica de .back-btn del mockup -- todas las pantallas que no son
// Inicio lo tienen. AppHeader (header persistente) no lo incluye porque
// en el mockup vive separado del statusbar, dentro del cuerpo de cada
// pantalla.
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { router } from 'expo-router'
import { useThemeColors } from '../../theme/useThemeColors'
import { Icon } from './Icon'

export function BackToInicioButton() {
  const colors = useThemeColors()

  return (
    <TouchableOpacity
      style={[styles.button, { backgroundColor: colors.surface2, borderColor: colors.border }]}
      onPress={() => router.back()}
    >
      <Icon name="back" size={16} color={colors.inkSoft} />
      <Text style={[styles.label, { color: colors.inkSoft }]}>Inicio</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 9,
    paddingLeft: 11,
    paddingRight: 15,
    marginBottom: 12,
  },
  label: {
    fontFamily: 'PublicSans_700Bold',
    fontSize: 13,
  },
})
