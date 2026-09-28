import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native'
import { useThemeColors } from '../../theme/useThemeColors'

type Props = TextInputProps & {
  label: string
}

export function Field({ label, style, ...inputProps }: Props) {
  const colors = useThemeColors()

  return (
    <View style={styles.wrapper}>
      <Text style={[styles.label, { color: colors.inkSoft }]}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.inkFaint}
        style={[
          styles.input,
          { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink },
          style,
        ]}
        {...inputProps}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 14,
  },
  label: {
    fontFamily: 'PublicSans_600SemiBold',
    fontSize: 13,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: 'PublicSans_400Regular',
    fontSize: 15,
  },
})
