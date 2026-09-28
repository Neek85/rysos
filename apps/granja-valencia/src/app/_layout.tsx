import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { Stack } from 'expo-router'
import { useSession } from '../../lib/supabase/useSession'

export default function RootLayout() {
  const { session, isLoading } = useSession()

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    )
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="index" />
      </Stack.Protected>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="dashboard-stub" />
      </Stack.Protected>
    </Stack>
  )
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
})
