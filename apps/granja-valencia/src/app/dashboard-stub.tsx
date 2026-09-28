// Stub temporal (specs/app_granja_valencia_login.md §5) -- placeholder
// hasta que se construya la pantalla real de Dashboard/Población en la
// siguiente tarea. No es la pantalla final.
import { StyleSheet, Text, View } from 'react-native'

export default function DashboardStubScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Dashboard — próximamente</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  text: {
    fontSize: 16,
    color: '#374151',
  },
})
