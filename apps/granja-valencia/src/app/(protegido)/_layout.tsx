// Layout de las rutas protegidas (specs/app_granja_valencia_inicio.md §3)
// -- monta AppHeader UNA SOLA VEZ vía screenOptions.header, para que
// Inicio, Galpones/Jaulas y cualquier pantalla futura dentro de este
// grupo lo hereden automáticamente sin repetir el componente por
// pantalla. Referenciado desde el _layout.tsx raíz como
// <Stack.Screen name="(protegido)" /> dentro de
// <Stack.Protected guard={!!session}> (patrón oficial de Expo Router,
// https://docs.expo.dev/router/advanced/authentication/).
import { Stack } from 'expo-router'
import { AppHeader } from '../../../components/AppHeader'

export default function ProtegidoLayout() {
  return (
    <Stack
      screenOptions={{
        header: () => <AppHeader />,
      }}
    >
      <Stack.Screen name="inicio" />
      <Stack.Screen name="galpones-pozas" />
      <Stack.Screen name="pozas/index" />
      <Stack.Screen name="pozas/[id]" />
      <Stack.Screen name="reproductores/nuevo" />
      <Stack.Screen name="empadre/asignar-macho" />
      <Stack.Screen name="parto/registrar" />
      <Stack.Screen name="proximamente/[title]" />
    </Stack>
  )
}
