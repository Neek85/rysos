// Pantalla de Login (specs/app_granja_valencia_login.md) -- adaptación al
// cliente Expo/React Native del patrón real ya implementado en
// app/login/page.jsx (Fase B). Mismo mecanismo de auth
// (PERFILES_USUARIO_INTERNOS + Supabase Auth signInWithPassword), sin
// "¿Olvidaste tu contraseña?" ni lógica condicional por rol (fuera de
// alcance en v1, ver spec §1).
import { useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { supabase } from '../../lib/supabase/client'
import { LoginFormSchema } from '../../lib/validations/auth'

export default function LoginScreen() {
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
      router.replace('/dashboard-stub')
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>RYZOS</Text>
      <Text style={styles.subtitle}>Ingresá con tu cuenta interna.</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Contraseña"
        secureTextEntry
        autoComplete="password"
        value={password}
        onChangeText={setPassword}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Ingresar</Text>}
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f9fafb',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1f2937',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 24,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    fontSize: 14,
    backgroundColor: '#fff',
  },
  error: {
    color: '#dc2626',
    fontSize: 13,
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#166534',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
})
