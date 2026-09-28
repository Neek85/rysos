import { z } from 'zod'

export const LoginFormSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email inválido.'),
  password: z.string().min(1, 'La contraseña es obligatoria.'),
})

export type LoginFormValues = z.infer<typeof LoginFormSchema>
