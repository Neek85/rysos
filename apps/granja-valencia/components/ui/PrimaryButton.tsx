import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, type GestureResponderEvent } from 'react-native'
import { useThemeColors } from '../../theme/useThemeColors'

type Props = {
  label: string
  onPress: (e: GestureResponderEvent) => void
  loading?: boolean
  disabled?: boolean
}

export function PrimaryButton({ label, onPress, loading, disabled }: Props) {
  const colors = useThemeColors()
  const isDisabled = !!disabled || !!loading

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      style={[
        styles.button,
        { backgroundColor: colors.accent },
        isDisabled && { opacity: 0.5 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.accentInk} />
      ) : (
        <Text style={[styles.label, { color: colors.accentInk }]}>{label}</Text>
      )}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  label: {
    fontFamily: 'PublicSans_700Bold',
    fontSize: 15,
  },
})
