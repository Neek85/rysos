import { StyleSheet, Text, TouchableOpacity, type GestureResponderEvent } from 'react-native'
import { useThemeColors } from '../../theme/useThemeColors'

type Props = {
  label: string
  onPress: (e: GestureResponderEvent) => void
  disabled?: boolean
}

export function GhostButton({ label, onPress, disabled }: Props) {
  const colors = useThemeColors()

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, disabled && { opacity: 0.5 }]}
    >
      <Text style={[styles.label, { color: colors.accent }]}>{label}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  label: {
    fontFamily: 'PublicSans_600SemiBold',
    fontSize: 14,
  },
})
