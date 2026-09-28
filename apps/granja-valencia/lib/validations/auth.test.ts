import { LoginFormSchema } from './auth'

describe('LoginFormSchema', () => {
  test('acepta email y password válidos', () => {
    const result = LoginFormSchema.safeParse({
      email: 'dneyser5@gmail.com',
      password: 'una-contraseña-real',
    })
    expect(result.success).toBe(true)
  })

  test('rechaza un email malformado', () => {
    const result = LoginFormSchema.safeParse({
      email: 'no-es-un-email',
      password: 'una-contraseña-real',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Email inválido.')
    }
  })

  test('rechaza una password vacía', () => {
    const result = LoginFormSchema.safeParse({
      email: 'dneyser5@gmail.com',
      password: '',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('La contraseña es obligatoria.')
    }
  })
})
