// Placeholder reutilizable, parametrizado por título (specs/
// app_granja_valencia_inicio.md §4) -- una sola ruta dinámica para las
// 10 acciones del grid que todavía no tienen pantalla real, en vez de
// duplicar 10 archivos vacíos casi idénticos.
import { StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { useThemeColors } from '../../../../theme/useThemeColors'
import { BackToInicioButton } from '../../../../components/ui/BackToInicioButton'

export default function ProximamenteScreen() {
  const colors = useThemeColors()
  const { title } = useLocalSearchParams<{ title: string }>()

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <BackToInicioButton />
      <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
      <Text style={[styles.subtitle, { color: colors.inkSoft }]}>Próximamente</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 18,
  },
  title: {
    fontFamily: 'Archivo_800ExtraBold',
    fontSize: 20,
    marginTop: 24,
  },
  subtitle: {
    fontFamily: 'PublicSans_600SemiBold',
    fontSize: 14,
    marginTop: 4,
  },
})
