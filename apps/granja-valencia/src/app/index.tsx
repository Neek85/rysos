// Pantalla de Login (specs/app_granja_valencia_login.md,
// specs/app_granja_valencia_diseno_login.md) -- adaptación al cliente
// Expo/React Native del patrón real ya implementado en
// app/login/page.jsx (Fase B). Mismo mecanismo de auth
// (PERFILES_USUARIO_INTERNOS + Supabase Auth signInWithPassword), sin
// "¿Olvidaste tu contraseña?" ni lógica condicional por rol (fuera de
// alcance en v1, ver spec de login §1). Rediseño visual sobre el mockup
// real (diseno_login.md §4) -- NO se tocó useSession/Stack.Protected/
// LoginFormSchema, solo el envoltorio visual.
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { supabase } from '../../lib/supabase/client'
import { LoginFormSchema } from '../../lib/validations/auth'
import { useThemeColors } from '../../theme/useThemeColors'
import { Field } from '../../components/ui/Field'
import { PrimaryButton } from '../../components/ui/PrimaryButton'

export default function LoginScreen() {
  const colors = useThemeColors()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit() {
    setError(null)

    const parsed = LoginFormSchema.safeParse({ email, password })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos.')
      return
    }

    setLoading(true)
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword(parsed.data)
      if (signInError) {
        // Mensaje genérico A PROPÓSITO -- mismo criterio anti-enumeración
        // que app/login/page.jsx, sin importar el código real de Supabase.
        setError('Email o contraseña incorrectos.')
        return
      }
      // Sin navegación manual acá -- el cambio de sesión disparado por
      // signInWithPassword llega a useSession() vía onAuthStateChange, y
      // el guard de Stack.Protected en _layout.tsx redirige solo a
      // /galpones-pozas. Navegar acá también sería redundante/racy.
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Text style={styles.emoji}>🐹</Text>
        <Text style={[styles.title, { color: colors.ink, fontFamily: 'Archivo_800ExtraBold' }]}>
          Granja Valencia
        </Text>
      </View>

      <Field
        label="Email"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <Field
        label="Contraseña"
        secureTextEntry
        autoComplete="password"
        value={password}
        onChangeText={setPassword}
      />

      {error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}

      <PrimaryButton label="Entrar" onPress={handleSubmit} loading={loading} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  emoji: {
    fontSize: 40,
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
  },
  error: {
    fontFamily: 'PublicSans_600SemiBold',
    fontSize: 13,
    marginBottom: 12,
  },
})
