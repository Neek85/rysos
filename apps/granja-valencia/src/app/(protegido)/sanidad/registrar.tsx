// Sanidad -- specs/app_granja_valencia_sanidad.md. Dos sub-flujos sobre
// el catálogo real PECUARIO_ACTIVIDADES_SANIDAD y el transaccional
// PECUARIO_SANIDAD_REGISTROS. El alcance es 'granja' | 'galpon' (NO
// lote/poza/reproductor). La guarda galpon_id-según-alcance vive en el
// trigger de la base; acá se repite solo para dar feedback inmediato.
// "Actividades (admin)" se oculta por rol en la UI, pero la RLS real no
// distingue rol (spec §0.f) -- no es una barrera de seguridad.
import { useCallback, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { SanidadActividadCrearSchema, SanidadRegistroCrearSchema } from '../../../../../../lib/validations/pecuario'
import { supabase } from '../../../../lib/supabase/client'
import { useProfile } from '../../../../lib/supabase/useProfile'
import { useThemeColors } from '../../../../theme/useThemeColors'
import { BackToInicioButton } from '../../../../components/ui/BackToInicioButton'
import { Chip } from '../../../../components/ui/Chip'

type Alcance = 'granja' | 'galpon'
type Actividad = { id: string; nombre: string; alcance: Alcance; frecuencia_dias: number; activo: boolean }
type Galpon = { id: string; codigo_galpon: string; nombre: string | null }
type RegistroResumen = { actividad_id: string; galpon_id: string | null; fecha: string }

const ALCANCES: { valor: Alcance; label: string }[] = [
  { valor: 'granja', label: 'Toda la granja' },
  { valor: 'galpon', label: 'Por galpón' },
]

function hoyISO() {
  return new Date().toISOString().slice(0, 10)
}

function esFechaValida(f: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return false
  const d = new Date(`${f}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f
}

function sumarDias(fechaISO: string, dias: number) {
  const d = new Date(`${fechaISO}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export default function SanidadScreen() {
  const colors = useThemeColors()
  const { organizacion, rol } = useProfile()
  const esAdmin = rol === 'admin'

  const [cargando, setCargando] = useState(true)
  const [actividades, setActividades] = useState<Actividad[]>([])
  const [galpones, setGalpones] = useState<Galpon[]>([])
  const [registros, setRegistros] = useState<RegistroResumen[]>([])

  const [modo, setModo] = useState<'registrar' | 'config'>('registrar')
  const [actividadId, setActividadId] = useState<string | null>(null)
  const [galponId, setGalponId] = useState<string | null>(null)
  const [fecha, setFecha] = useState(hoyISO())
  const [producto, setProducto] = useState('')
  const [responsable, setResponsable] = useState('')
  const [observaciones, setObservaciones] = useState('')

  const [nombreNueva, setNombreNueva] = useState('')
  const [alcanceNueva, setAlcanceNueva] = useState<Alcance>('granja')
  const [frecuenciaNueva, setFrecuenciaNueva] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [guardadoOk, setGuardadoOk] = useState<string | null>(null)

  const cargar = useCallback(() => {
    if (!organizacion) return
    setCargando(true)
    Promise.all([
      supabase
        .from('PECUARIO_ACTIVIDADES_SANIDAD')
        .select('id, nombre, alcance, frecuencia_dias, activo')
        .eq('ID_Organizacion', organizacion)
        .order('created_at'),
      supabase.from('PECUARIO_GALPONES').select('id, codigo_galpon, nombre').eq('ID_Organizacion', organizacion).order('codigo_galpon'),
      supabase.from('PECUARIO_SANIDAD_REGISTROS').select('actividad_id, galpon_id, fecha').eq('ID_Organizacion', organizacion),
    ]).then(([actRes, galRes, regRes]) => {
      setActividades((actRes.data ?? []) as Actividad[])
      setGalpones((galRes.data ?? []) as Galpon[])
      setRegistros((regRes.data ?? []) as RegistroResumen[])
      setCargando(false)
    })
  }, [organizacion])

  useFocusEffect(cargar)

  const activas = actividades.filter((a) => a.activo)
  const actividad = activas.find((a) => a.id === actividadId) ?? null
  const porGalpon = actividad?.alcance === 'galpon'

  function ultimaFecha(act: Actividad, galpon: string | null) {
    const fechas = registros
      .filter((r) => r.actividad_id === act.id && (act.alcance === 'galpon' ? r.galpon_id === galpon : true))
      .map((r) => r.fecha)
    return fechas.length ? fechas.sort().at(-1)! : null
  }

  function limpiarEstado() {
    setError(null)
    setGuardadoOk(null)
  }

  async function handleGuardarRegistro() {
    limpiarEstado()
    if (!organizacion || !actividad) return
    if (porGalpon && !galponId) {
      setError('Esta actividad es por galpón: elegí un galpón.')
      return
    }
    if (!esFechaValida(fecha)) {
      setError('Ingresá una fecha válida (AAAA-MM-DD).')
      return
    }
    const parsed = SanidadRegistroCrearSchema.safeParse({
      ID_Organizacion: organizacion,
      actividad_id: actividad.id,
      galpon_id: porGalpon ? galponId : null,
      fecha,
      producto_usado: producto.trim() || null,
      responsable: responsable.trim() || null,
      observaciones: observaciones.trim() || null,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos.')
      return
    }
    setGuardando(true)
    try {
      const { error: insertError } = await supabase.from('PECUARIO_SANIDAD_REGISTROS').insert(parsed.data)
      if (insertError) {
        setError(insertError.message)
        return
      }
      setGuardadoOk(`Actividad registrada: ${actividad.nombre} · ${fecha}. ✓`)
      setProducto('')
      setResponsable('')
      setObservaciones('')
      cargar()
    } finally {
      setGuardando(false)
    }
  }

  async function handleAgregarActividad() {
    limpiarEstado()
    if (!organizacion || !esAdmin) return
    const frecuencia = Number(frecuenciaNueva.trim())
    const parsed = SanidadActividadCrearSchema.safeParse({
      ID_Organizacion: organizacion,
      nombre: nombreNueva,
      alcance: alcanceNueva,
      frecuencia_dias: frecuenciaNueva.trim() === '' ? NaN : frecuencia,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos.')
      return
    }
    setGuardando(true)
    try {
      const { error: insertError } = await supabase.from('PECUARIO_ACTIVIDADES_SANIDAD').insert(parsed.data)
      if (insertError) {
        setError(insertError.message)
        return
      }
      setGuardadoOk(`Actividad "${parsed.data.nombre}" agregada al catálogo ✓`)
      setNombreNueva('')
      setFrecuenciaNueva('')
      cargar()
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  const ultima = actividad ? ultimaFecha(actividad, porGalpon ? galponId : null) : null
  const puedeGuardarRegistro = !!actividad && (!porGalpon || !!galponId)

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.bg }]} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <BackToInicioButton />
      <Text style={[styles.title, { color: colors.ink }]}>Sanidad</Text>
      <Text style={[styles.subtitle, { color: colors.inkSoft }]}>Bioseguridad y limpieza — actividades configuradas por tu organización</Text>

      {esAdmin && (
        <View style={styles.chipsRow}>
          <Chip label="Registrar" selected={modo === 'registrar'} onPress={() => { setModo('registrar'); limpiarEstado() }} />
          <Chip label="Actividades (admin)" selected={modo === 'config'} onPress={() => { setModo('config'); limpiarEstado() }} />
        </View>
      )}

      {modo === 'registrar' ? (
        <>
          <Text style={[styles.label, { color: colors.inkSoft }]}>Actividad</Text>
          {activas.length === 0 ? (
            <Text style={[styles.hint, { color: colors.inkFaint }]}>
              {esAdmin
                ? 'Tu organización todavía no tiene actividades. Creá la primera en "Actividades (admin)".'
                : 'Tu organización todavía no tiene actividades configuradas. Pedile a un administrador que las cree.'}
            </Text>
          ) : (
            <View style={styles.chipsRow}>
              {activas.map((a) => (
                <Chip
                  key={a.id}
                  label={a.nombre}
                  selected={actividadId === a.id}
                  onPress={() => { setActividadId(a.id); setGalponId(null); limpiarEstado() }}
                />
              ))}
            </View>
          )}

          {porGalpon && (
            <>
              <Text style={[styles.label, { color: colors.inkSoft }]}>Galpón</Text>
              {galpones.length === 0 ? (
                <Text style={[styles.hint, { color: colors.inkFaint }]}>No hay galpones. Creá uno en Galpones y pozas.</Text>
              ) : (
                <View style={styles.chipsRow}>
                  {galpones.map((g) => (
                    <Chip
                      key={g.id}
                      label={g.nombre ? `${g.codigo_galpon} · ${g.nombre}` : g.codigo_galpon}
                      selected={galponId === g.id}
                      onPress={() => { setGalponId(g.id); limpiarEstado() }}
                    />
                  ))}
                </View>
              )}
            </>
          )}

          {actividad && (
            <View style={[styles.card, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.ink }]}>{actividad.nombre}</Text>
              <Text style={[styles.hint, { color: colors.inkSoft }]}>Cada {actividad.frecuencia_dias} días</Text>
              <Text style={[styles.hint, { color: colors.accentDim, fontWeight: '700' }]}>
                {porGalpon && !galponId
                  ? 'Elegí un galpón para ver su calendario'
                  : ultima
                    ? `Última: ${ultima} · Próxima: ${sumarDias(ultima, actividad.frecuencia_dias)}`
                    : 'Sin registro previo'}
              </Text>
            </View>
          )}

          <Text style={[styles.label, { color: colors.inkSoft }]}>Fecha</Text>
          <TextInput style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]} placeholder="AAAA-MM-DD" placeholderTextColor={colors.inkFaint} value={fecha} onChangeText={setFecha} />

          <Text style={[styles.label, { color: colors.inkSoft }]}>Producto usado (opcional)</Text>
          <TextInput style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]} placeholder="Ej. amonio cuaternario" placeholderTextColor={colors.inkFaint} value={producto} onChangeText={setProducto} maxLength={150} />

          <Text style={[styles.label, { color: colors.inkSoft }]}>Responsable (opcional)</Text>
          <TextInput style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]} placeholder="Nombre de quien aplicó" placeholderTextColor={colors.inkFaint} value={responsable} onChangeText={setResponsable} maxLength={150} />

          <Text style={[styles.label, { color: colors.inkSoft }]}>Observaciones (opcional)</Text>
          <TextInput style={[styles.input, styles.textArea, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]} placeholder="Ej. cambio de viruta completo" placeholderTextColor={colors.inkFaint} value={observaciones} onChangeText={setObservaciones} multiline maxLength={500} />

          {error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}
          {guardadoOk && <Text style={[styles.hint, { color: colors.success, fontWeight: '700' }]}>{guardadoOk}</Text>}

          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.accent }, !puedeGuardarRegistro && styles.buttonDisabled]}
            onPress={handleGuardarRegistro}
            disabled={!puedeGuardarRegistro || guardando}
          >
            {guardando ? <ActivityIndicator color={colors.accentInk} /> : <Text style={[styles.buttonText, { color: colors.accentInk }]}>Guardar</Text>}
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={[styles.hint, { color: colors.inkFaint }]}>
            Solo el rol admin configura qué actividades usa tu organización — cada una arma las suyas (frecuencia y nombres propios).
          </Text>

          <Text style={[styles.label, { color: colors.inkSoft }]}>Actividades configuradas</Text>
          {actividades.length === 0 ? (
            <Text style={[styles.hint, { color: colors.inkFaint }]}>Aún no hay actividades.</Text>
          ) : (
            actividades.map((a) => (
              <View key={a.id} style={[styles.card, styles.cardRow, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.ink }]}>{a.nombre}</Text>
                  <Text style={[styles.hint, { color: colors.inkSoft }]}>
                    {a.alcance === 'granja' ? 'Toda la granja' : 'Por galpón'}{a.activo ? '' : ' · inactiva'}
                  </Text>
                </View>
                <Text style={[styles.cardTitle, { color: colors.ink }]}>{a.frecuencia_dias} días</Text>
              </View>
            ))
          )}

          <Text style={[styles.label, { color: colors.inkSoft }]}>Agregar actividad</Text>
          <Text style={[styles.hint, { color: colors.inkSoft }]}>Nombre</Text>
          <TextInput style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]} placeholder="Ej. Control de roedores" placeholderTextColor={colors.inkFaint} value={nombreNueva} onChangeText={setNombreNueva} maxLength={100} />

          <Text style={[styles.label, { color: colors.inkSoft }]}>Alcance</Text>
          <View style={styles.chipsRow}>
            {ALCANCES.map((al) => (
              <Chip key={al.valor} label={al.label} selected={alcanceNueva === al.valor} onPress={() => { setAlcanceNueva(al.valor); limpiarEstado() }} />
            ))}
          </View>
          <Text style={[styles.hint, { color: colors.inkFaint }]}>
            "Toda la granja" lleva un solo calendario (ej. desinfección general). "Por galpón" se repite con su propio calendario en cada galpón (ej. limpieza).
          </Text>

          <Text style={[styles.label, { color: colors.inkSoft }]}>Frecuencia (cada cuántos días)</Text>
          <TextInput style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]} placeholder="Ej. 15" placeholderTextColor={colors.inkFaint} value={frecuenciaNueva} onChangeText={setFrecuenciaNueva} keyboardType="number-pad" />

          {error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}
          {guardadoOk && <Text style={[styles.hint, { color: colors.success, fontWeight: '700' }]}>{guardadoOk}</Text>}

          <TouchableOpacity style={[styles.button, { backgroundColor: colors.accent }]} onPress={handleAgregarActividad} disabled={guardando}>
            {guardando ? <ActivityIndicator color={colors.accentInk} /> : <Text style={[styles.buttonText, { color: colors.accentInk }]}>+ Agregar actividad</Text>}
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 18, paddingBottom: 40 },
  title: { fontFamily: 'Archivo_800ExtraBold', fontSize: 20, marginBottom: 4 },
  subtitle: { fontFamily: 'PublicSans_400Regular', fontSize: 13, marginBottom: 12 },
  label: { fontFamily: 'PublicSans_700Bold', fontSize: 13, marginBottom: 6, marginTop: 12 },
  hint: { fontFamily: 'PublicSans_400Regular', fontSize: 13, marginTop: 6 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginTop: 4 },
  textArea: { minHeight: 70, textAlignVertical: 'top' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 12 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  cardTitle: { fontFamily: 'PublicSans_700Bold', fontSize: 14 },
  error: { fontFamily: 'PublicSans_600SemiBold', fontSize: 13, marginTop: 12 },
  button: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontFamily: 'PublicSans_700Bold', fontSize: 14 },
})
