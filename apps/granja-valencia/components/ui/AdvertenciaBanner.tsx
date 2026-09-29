// Banner no bloqueante de advertencia (consanguinidad y/o "jaula ya
// ocupada") + checkbox "Entiendo el riesgo" -- aislado de Alta de
// reproductor para reusarlo tal cual en Empadre (specs/
// app_granja_valencia_empadre.md), sin reescribirlo.
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useThemeColors } from '../../theme/useThemeColors'

type Props = {
  advertencias: string[]
  entiendoRiesgo: boolean
  onToggleEntiendoRiesgo: () => void
}

export function AdvertenciaBanner({ advertencias, entiendoRiesgo, onToggleEntiendoRiesgo }: Props) {
  const colors = useThemeColors()

  if (advertencias.length === 0) return null

  return (
    <View style={[styles.banner, { backgroundColor: colors.amberSoft }]}>
      {advertencias.map((a, i) => (
        <Text key={i} style={[styles.bannerText, { color: colors.amber }]}>
          ⚠ {a}
        </Text>
      ))}
      <TouchableOpacity style={styles.checkRow} onPress={onToggleEntiendoRiesgo}>
        <View
          style={[
            styles.checkbox,
            { borderColor: colors.amber },
            entiendoRiesgo && { backgroundColor: colors.amber },
          ]}
        />
        <Text style={[styles.checkLabel, { color: colors.amber }]}>Entiendo el riesgo</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: { borderRadius: 12, padding: 12, marginTop: 16, gap: 8 },
  bannerText: { fontFamily: 'PublicSans_600SemiBold', fontSize: 13 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 2 },
  checkLabel: { fontFamily: 'PublicSans_700Bold', fontSize: 13 },
})
