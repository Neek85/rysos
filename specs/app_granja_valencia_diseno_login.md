# Spec — App Granja Valencia: Sistema de diseño (extraído del mockup) + rediseño de Login

> Traduce el sistema de diseño real del artifact "Granja Valencia"
> (mockup validado, `claude.ai/artifact/7vebvnVwLNR15TT9DL2DyX`) a React
> Native. Valores tomados literal del CSS del mockup — no reinventados.

## 1. Tema — colores exactos (claro y oscuro)

`apps/granja-valencia/theme/colors.ts`:
```ts
export const lightColors = {
  bg: '#EEF1E7', surface: '#FFFFFF', surface2: '#F6F7F1',
  ink: '#1E2A1E', inkSoft: '#5C6B58', inkFaint: '#8A9684',
  border: '#DCE2D5', accent: '#3C6E4F', accentDim: '#2E5A3F',
  accentSoft: '#DCEADF', accentInk: '#FBFDF9',
  amber: '#B9741E', amberSoft: '#F3E1C4',
  danger: '#A8442F', dangerSoft: '#F1DAD3',
  success: '#3E7A3C', successSoft: '#DCEBDA',
}
export const darkColors = {
  bg: '#10140E', surface: '#1A2117', surface2: '#202A1C',
  ink: '#E9EFE3', inkSoft: '#A7B49F', inkFaint: '#6E7A67',
  border: '#2C3626', accent: '#74B27E', accentDim: '#8FC498',
  accentSoft: '#22371F', accentInk: '#0C130A',
  amber: '#E3A855', amberSoft: '#3B2C15',
  danger: '#E28E76', dangerSoft: '#3C241C',
  success: '#86C583', successSoft: '#1F3620',
}
```
Selección de tema: `useColorScheme()` de RN (mismo criterio que
`prefers-color-scheme` del mockup) — sin toggle manual todavía, no estaba
en el mockup.

## 2. Tipografía

Mockup usa Archivo (700/800, encabezados) + Public Sans (400/600/700/800,
cuerpo), vía Google Fonts. Traducir con los paquetes de Expo Google Fonts —
**confirmar los nombres reales de paquete en npm antes de instalar**
(`@expo-google-fonts/archivo`, `@expo-google-fonts/public-sans` — verificar,
no asumir de memoria) y cargar con `useFonts` + `expo-splash-screen` para
no mostrar texto sin estilo mientras cargan.

## 3. Componentes base (los mínimos para Login; se suman más por pantalla)

`apps/granja-valencia/components/ui/`: `PrimaryButton`, `GhostButton`,
`Field` (label + input, mismo estilo `surface2`/`border` del mockup).
Steppers, chips, action-cards, etc. se agregan cuando la pantalla que los
usa se construya (Inicio, Parto, etc.) — no de una vez, para no adivinar
props que no sabemos usar todavía.

## 4. Rediseño de Login

Mismo mecanismo de auth real ya construido y probado (§2.2 del roadmap) —
NO se toca `useSession`/`Stack.Protected`/`LoginFormSchema`. Solo cambia lo
visual y dos cosas de contenido:
- Campo "Email" (no "Usuario" como el mockup) — el mecanismo real es
  email+password de Supabase Auth, no un usuario de texto libre.
- **Se elimina la sección "Configuración de tu granja"** del mockup — el
  propio mockup aclara que es solo para simular escenarios, no
  funcionalidad real (la config vive en `PECUARIO_CONFIGURACION`).

Layout: título "Granja Valencia" + emoji 🐹 centrado arriba (igual al
mockup), campos Email/Contraseña con el estilo `surface2`+`border` del
mockup, botón primario verde (`accent`) "Entrar" (el mockup dice "Entrar",
no "Ingresar" — se ajusta el texto).

## 5. Pruebas

- Visual: capturas en dispositivo real comparadas contra el mockup
  (colores, tipografía, espaciado) — Neyser confirma que se parece.
- Funcional: las 3 pruebas ya superadas en la versión anterior (login
  exitoso, error genérico, persistencia de sesión) siguen pasando — no se
  tocó el mecanismo, solo el envoltorio visual.

## 6. Estado

EN DISEÑO (2026-09-28).
