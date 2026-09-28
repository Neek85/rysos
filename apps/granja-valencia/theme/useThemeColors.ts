import { useColorScheme } from 'react-native'
import { lightColors, darkColors } from './colors'

export function useThemeColors() {
  const scheme = useColorScheme()
  return scheme === 'dark' ? darkColors : lightColors
}
