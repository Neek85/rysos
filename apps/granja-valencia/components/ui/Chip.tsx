// Chip seleccionable -- aislado de Alta de reproductor para reusarlo
// tal cual en Empadre y en las próximas pantallas de selección.
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { useThemeColors } from '../../theme/useThemeColors'

type Props = {
  label: string
  selected: boolean
  onPress: () => void
}

export function Chip({ label, selected, onPress }: Props) {
  const colors = useThemeColors()

  return (
    <TouchableOpacity
      style={[
        styles.chip,
        { borderColor: colors.border, backgroundColor: colors.surface },
        selected && { backgroundColor: colors.accent, borderColor: colors.accent },
      ]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, { color: colors.inkSoft }, selected && { color: colors.accentInk }]}>{label}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  chip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  chipText: { fontFamily: 'PublicSans_600SemiBold', fontSize: 13 },
})
