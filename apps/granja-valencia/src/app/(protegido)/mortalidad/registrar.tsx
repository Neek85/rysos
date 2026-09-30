// Registrar mortalidad -- specs/app_granja_valencia_mortalidad.md. Backend
// real PECUARIO_MORTALIDAD + PECUARIO_MORTALIDAD_FOTOS (evidencia
// fotográfica, bucket evidencias_pecuario). trg_dar_baja_animal_por_
// mortalidad solo actúa si animal_id IS NOT NULL (mismo gap que Venta)
// -- si el origen es un lote, el cliente hace el UPDATE explícito de
// cantidad_actual (spec §0.b). Sin ningún CHECK/trigger real que ate
// `etapa` a poza_id/lote_id -- esa correlación es 100% convención de
// cliente, siguiendo el mockup.
import { useCallback, useState } from 'react'
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { decode } from 'base64-arraybuffer'
import { MortalidadFotoInsertSchema, MortalidadSchema } from '../../../../../../lib/validations/pecuario'
import { supabase } from '../../../../lib/supabase/client'
import { useProfile } from '../../../../lib/supabase/useProfile'
import { useThemeColors } from '../../../../theme/useThemeColors'
import { BackToInicioButton } from '../../../../components/ui/BackToInicioButton'
import { Chip } from '../../../../components/ui/Chip'

type LoteOption = { id: string; codigo_lote: string; cantidad_actual: number | null }
type JaulaOption = { id: string; codigo_poza: string; tipo_uso: string }
type ReproductorOption = { id: string; codigo_arete: string }
type FotoLocal = { uri: string; base64: string | null }

const ETAPAS = [
  { valor: 'lactancia' as const, label: 'Lactancia', tipoUsoPoza: 'maternidad' },
  { valor: 'recria' as const, label: 'Recría' },
  { valor: 'engorde' as const, label: 'Engorde' },
  { valor: 'reproductor' as const, label: 'Reproductor (sin identificar)', tipoUsoPoza: 'empadre' },
]

const CAUSAS = [
  { valor: 'neumonia' as const, label: 'Neumonía' },
  { valor: 'distocia' as const, label: 'Distocia' },
  { valor: 'aplastamiento' as const, label: 'Aplastamiento' },
  { valor: 'gastroenteritis' as const, label: 'Gastroenteritis' },
  { valor: 'depredador' as const, label: 'Depredador' },
  { valor: 'desconocido' as const, label: 'Desconocida' },
  { valor: 'otro' as const, label: 'Otro' },
]

function hoyISO() {
  return new Date().toISOString().slice(0, 10)
}

function Stepper({
  value,
  onChange,
  min = 1,
  max,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number | null
}) {
  const colors = useThemeColors()
  return (
    <View style={[styles.stepper, { borderColor: colors.border }]}>
      <TouchableOpacity
        style={[styles.stepperButton, { backgroundColor: colors.surface2 }]}
        onPress={() => onChange(Math.max(min, value - 1))}
      >
        <Text style={[styles.stepperButtonText, { color: colors.accentDim }]}>−</Text>
      </TouchableOpacity>
      <Text style={[styles.stepperValue, { color: colors.ink }]}>{value}</Text>
      <TouchableOpacity
        style={[styles.stepperButton, { backgroundColor: colors.surface2 }]}
        onPress={() => onChange(max != null ? Math.min(max, value + 1) : value + 1)}
      >
        <Text style={[styles.stepperButtonText, { color: colors.accentDim }]}>+</Text>
      </TouchableOpacity>
    </View>
  )
}

export default function RegistrarMortalidadScreen() {
  const colors = useThemeColors()
  const { organizacion } = useProfile()

  const [cargando, setCargando] = useState(true)
  const [lotes, setLotes] = useState<LoteOption[]>([])
  const [pozas, setPozas] = useState<JaulaOption[]>([])
  const [reproductores, setReproductores] = useState<ReproductorOption[]>([])

  const [modo, setModo] = useState<'poblacional' | 'reproductor'>('poblacional')
  const [etapa, setEtapa] = useState<(typeof ETAPAS)[number]['valor']>('lactancia')
  const [origenId, setOrigenId] = useState<string | null>(null)
  const [busquedaAnimal, setBusquedaAnimal] = useState('')
  const [animalId, setAnimalId] = useState<string | null>(null)

  const [fecha, setFecha] = useState(hoyISO())
  const [cantidad, setCantidad] = useState(1)
  const [causa, setCausa] = useState<(typeof CAUSAS)[number]['valor']>('desconocido')
  const [descripcionSintomas, setDescripcionSintomas] = useState('')
  const [fotos, setFotos] = useState<FotoLocal[]>([])

  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [guardadoOk, setGuardadoOk] = useState(false)

  const etapaUsaLote = etapa === 'recria' || etapa === 'engorde'
  const etapaCfg = ETAPAS.find((e) => e.valor === etapa)

  const cargarLotes = useCallback(
    (organizacionActual: string) =>
      supabase
        .from('PECUARIO_LOTES')
        .select('id, codigo_lote, cantidad_actual')
        .eq('ID_Organizacion', organizacionActual)
        .eq('etapa', etapa)
        // Hallazgo cerrado en Pesaje/Traslado/Venta: un lote en 0 no
        // tiene nada para dar de baja.
        .gt('cantidad_actual', 0)
        .order('created_at'),
    [etapa]
  )

  const cargar = useCallback(() => {
    if (!organizacion) return
    setCargando(true)
    Promise.all([
      etapaUsaLote
        ? cargarLotes(organizacion)
        : Promise.resolve({ data: [] as LoteOption[] }),
      supabase.from('PECUARIO_JAULAS').select('id, codigo_poza, tipo_uso').eq('ID_Organizacion', organizacion).order('codigo_poza'),
      supabase
        .from('PECUARIO_REPRODUCTORES')
        .select('id, codigo_arete')
        .eq('ID_Organizacion', organizacion)
        .eq('estado', 'activo')
        .order('codigo_arete'),
    ]).then(([lotesRes, pozasRes, reproductoresRes]) => {
      setLotes((lotesRes.data ?? []) as LoteOption[])
      setPozas((pozasRes.data ?? []) as JaulaOption[])
      setReproductores((reproductoresRes.data ?? []) as ReproductorOption[])
      setCargando(false)
    })
  }, [organizacion, etapaUsaLote, cargarLotes])

  useFocusEffect(cargar)

  const pozasFiltradas = etapaCfg?.tipoUsoPoza ? pozas.filter((p) => p.tipo_uso === etapaCfg.tipoUsoPoza) : pozas
  const loteSeleccionado = lotes.find((l) => l.id === origenId) ?? null
  const maxCantidad = modo === 'poblacional' && etapaUsaLote ? loteSeleccionado?.cantidad_actual ?? null : null

  const reproductoresFiltrados = reproductores.filter((r) =>
    r.codigo_arete.toLowerCase().includes(busquedaAnimal.trim().toLowerCase())
  )

  function seleccionarEtapa(valor: (typeof ETAPAS)[number]['valor']) {
    setEtapa(valor)
    setOrigenId(null)
    setError(null)
    setGuardadoOk(false)
  }

  function seleccionarOrigen(id: string, cantidadActualLote: number | null) {
    setOrigenId(id)
    setError(null)
    setGuardadoOk(false)
    if (cantidadActualLote != null && cantidad > cantidadActualLote) {
      setCantidad(Math.max(1, cantidadActualLote))
    }
  }

  async function agregarFotos() {
    const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permiso.granted) {
      setError('Sin permiso para acceder a tus fotos.')
      return
    }
    const resultado = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.7,
      allowsMultipleSelection: true,
    })
    if (resultado.canceled || !resultado.assets) return
    setFotos((prev) => [...prev, ...resultado.assets.map((a) => ({ uri: a.uri, base64: a.base64 ?? null }))])
  }

  function quitarFoto(index: number) {
    setFotos((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleGuardar() {
    setError(null)
    setGuardadoOk(false)
    if (!organizacion) return
    if (modo === 'poblacional' && !origenId) return
    if (modo === 'reproductor' && !animalId) return

    const cantidadFinal = modo === 'reproductor' ? 1 : cantidad

    // No confiar solo en el tope del stepper -- ningún CHECK/trigger
    // real valida cantidad contra cantidad_actual en PECUARIO_MORTALIDAD
    // (spec §0.b), mismo nivel de riesgo que Venta/Pesaje.
    if (modo === 'poblacional' && etapaUsaLote && maxCantidad != null && cantidadFinal > maxCantidad) {
      setError(`No puedes registrar más de los ${maxCantidad} animales que tiene el lote.`)
      return
    }

    const parsed = MortalidadSchema.safeParse({
      ID_Organizacion: organizacion,
      poza_id: modo === 'poblacional' && !etapaUsaLote ? origenId : null,
      lote_id: modo === 'poblacional' && etapaUsaLote ? origenId : null,
      animal_id: modo === 'reproductor' ? animalId : null,
      fecha_evento: fecha,
      cantidad: cantidadFinal,
      etapa,
      causa,
      descripcion_sintomas: descripcionSintomas.trim() || null,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos.')
      return
    }

    setGuardando(true)
    try {
      const { data: mortalidad, error: insertError } = await supabase
        .from('PECUARIO_MORTALIDAD')
        .insert(parsed.data)
        .select('id')
        .single()
      if (insertError || !mortalidad) {
        setError(insertError?.message ?? 'No se pudo registrar la mortalidad.')
        return
      }

      // Fix decidido (spec §0.b): UPDATE explícito, no atómico -- ningún
      // trigger real descuenta cantidad_actual cuando lote_id está
      // seteado (mismo patrón ya usado en Venta).
      if (modo === 'poblacional' && etapaUsaLote && origenId && loteSeleccionado?.cantidad_actual != null) {
        const { error: updateError } = await supabase
          .from('PECUARIO_LOTES')
          .update({ cantidad_actual: loteSeleccionado.cantidad_actual - cantidadFinal })
          .eq('id', origenId)
        if (updateError) {
          setError(`Mortalidad guardada, pero no se pudo actualizar la cantidad del lote: ${updateError.message}`)
          return
        }
      }

      // Fotos de evidencia (opcional) -- storage_path real:
      // {ID_Organizacion}/mortalidad/{mortalidad_id}/{filename}.
      for (let i = 0; i < fotos.length; i++) {
        const foto = fotos[i]
        if (!foto.base64) continue
        const filename = `foto-${Date.now()}-${i}.jpg`
        const storagePath = `${organizacion}/mortalidad/${mortalidad.id}/${filename}`
        const { error: uploadError } = await supabase.storage
          .from('evidencias_pecuario')
          .upload(storagePath, decode(foto.base64), { contentType: 'image/jpeg' })
        if (uploadError) {
          setError(`Mortalidad guardada, pero falló la subida de una foto: ${uploadError.message}`)
          return
        }
        const parsedFoto = MortalidadFotoInsertSchema.safeParse({
          ID_Organizacion: organizacion,
          mortalidad_id: mortalidad.id,
          storage_path: storagePath,
        })
        if (parsedFoto.success) {
          await supabase.from('PECUARIO_MORTALIDAD_FOTOS').insert(parsedFoto.data)
        }
      }

      setGuardadoOk(true)
      setOrigenId(null)
      setAnimalId(null)
      setCantidad(1)
      setCausa('desconocido')
      setDescripcionSintomas('')
      setFotos([])
      cargar()
    } finally {
      setGuardando(false)
    }
  }

  const puedeGuardar = !!organizacion && (modo === 'poblacional' ? !!origenId : !!animalId)

  if (cargando) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.bg }]} contentContainerStyle={styles.content}>
      <BackToInicioButton />
      <Text style={[styles.title, { color: colors.ink }]}>Registrar mortalidad</Text>
      <Text style={[styles.subtitle, { color: colors.inkSoft }]}>Anotá la baja apenas la detectes</Text>

      <View style={styles.chipsRow}>
        <Chip
          label="Poblacional"
          selected={modo === 'poblacional'}
          onPress={() => {
            setModo('poblacional')
            setAnimalId(null)
            setError(null)
            setGuardadoOk(false)
          }}
        />
        <Chip
          label="Reproductor identificado"
          selected={modo === 'reproductor'}
          onPress={() => {
            setModo('reproductor')
            setOrigenId(null)
            setCantidad(1)
            setError(null)
            setGuardadoOk(false)
          }}
        />
      </View>

      {modo === 'poblacional' ? (
        <>
          <Text style={[styles.label, { color: colors.inkSoft }]}>Etapa</Text>
          <View style={styles.chipsRow}>
            {ETAPAS.map((e) => (
              <Chip key={e.valor} label={e.label} selected={etapa === e.valor} onPress={() => seleccionarEtapa(e.valor)} />
            ))}
          </View>
          <Text style={[styles.hint, { color: colors.inkFaint }]}>La etapa decide de dónde se descuenta — elegila primero.</Text>

          <Text style={[styles.label, { color: colors.inkSoft }]}>{etapaUsaLote ? 'Lote afectado' : 'Poza afectada'}</Text>
          {etapaUsaLote ? (
            lotes.length === 0 ? (
              <Text style={[styles.hint, { color: colors.inkFaint }]}>No hay lotes disponibles en esta etapa.</Text>
            ) : (
              <View style={styles.chipsRow}>
                {lotes.map((l) => (
                  <Chip
                    key={l.id}
                    label={l.codigo_lote}
                    selected={origenId === l.id}
                    onPress={() => seleccionarOrigen(l.id, l.cantidad_actual)}
                  />
                ))}
              </View>
            )
          ) : pozasFiltradas.length === 0 ? (
            <Text style={[styles.hint, { color: colors.inkFaint }]}>No hay pozas disponibles para esta etapa.</Text>
          ) : (
            <View style={styles.chipsRow}>
              {pozasFiltradas.map((p) => (
                <Chip key={p.id} label={p.codigo_poza} selected={origenId === p.id} onPress={() => seleccionarOrigen(p.id, null)} />
              ))}
            </View>
          )}
        </>
      ) : (
        <>
          <Text style={[styles.label, { color: colors.inkSoft }]}>Reproductor/a</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
            placeholder="Código de arete (ej. H-014)"
            placeholderTextColor={colors.inkFaint}
            value={busquedaAnimal}
            onChangeText={setBusquedaAnimal}
          />
          {reproductores.length === 0 ? (
            <Text style={[styles.hint, { color: colors.inkFaint }]}>No hay reproductores identificados activos.</Text>
          ) : (
            <View style={styles.chipsRow}>
              {reproductoresFiltrados.map((r) => (
                <Chip
                  key={r.id}
                  label={r.codigo_arete}
                  selected={animalId === r.id}
                  onPress={() => {
                    setAnimalId(r.id)
                    setError(null)
                    setGuardadoOk(false)
                  }}
                />
              ))}
            </View>
          )}
          <Text style={[styles.hint, { color: colors.inkFaint }]}>
            Se da de baja automáticamente al reproductor identificado — no hace falta indicar cantidad.
          </Text>
        </>
      )}

      <Text style={[styles.label, { color: colors.inkSoft }]}>Fecha</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
        placeholder="AAAA-MM-DD"
        placeholderTextColor={colors.inkFaint}
        value={fecha}
        onChangeText={setFecha}
      />

      {modo === 'poblacional' && (
        <>
          <Text style={[styles.label, { color: colors.inkSoft }]}>Cantidad</Text>
          <Stepper
            value={cantidad}
            onChange={(v) => {
              setCantidad(v)
              setError(null)
              setGuardadoOk(false)
            }}
            min={1}
            max={maxCantidad}
          />
          {maxCantidad != null && (
            <Text style={[styles.hint, { color: colors.inkFaint }]}>Máximo disponible en el lote: {maxCantidad}</Text>
          )}
        </>
      )}

      <Text style={[styles.label, { color: colors.inkSoft }]}>Causa probable</Text>
      <View style={styles.chipsRow}>
        {CAUSAS.map((c) => (
          <Chip
            key={c.valor}
            label={c.label}
            selected={causa === c.valor}
            onPress={() => {
              setCausa(c.valor)
              setError(null)
              setGuardadoOk(false)
            }}
          />
        ))}
      </View>

      <Text style={[styles.label, { color: colors.inkSoft }]}>Síntomas observados (opcional)</Text>
      <TextInput
        style={[styles.input, styles.textArea, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
        placeholder="Ej. decaimiento, secreción nasal…"
        placeholderTextColor={colors.inkFaint}
        value={descripcionSintomas}
        onChangeText={setDescripcionSintomas}
        multiline
      />

      <Text style={[styles.label, { color: colors.inkSoft }]}>Fotos de evidencia (opcional)</Text>
      <TouchableOpacity style={[styles.ghostButton, { borderColor: colors.border }]} onPress={agregarFotos}>
        <Text style={{ color: colors.accentDim, fontWeight: '700', fontSize: 13 }}>+ Agregar foto</Text>
      </TouchableOpacity>
      {fotos.length > 0 && (
        <View style={styles.fotosRow}>
          {fotos.map((f, i) => (
            <TouchableOpacity key={f.uri} onPress={() => quitarFoto(i)}>
              <Image source={{ uri: f.uri }} style={styles.fotoPreview} />
            </TouchableOpacity>
          ))}
        </View>
      )}
      <Text style={[styles.hint, { color: colors.inkFaint }]}>
        Sirve para consultar con el veterinario a distancia o para revisar el caso después — nunca obligatorio.
      </Text>

      {error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}
      {guardadoOk && (
        <Text style={[styles.hint, { color: colors.success, fontWeight: '700' }]}>Mortalidad guardada. ✓</Text>
      )}

      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.danger }, !puedeGuardar && styles.buttonDisabled]}
        onPress={handleGuardar}
        disabled={!puedeGuardar || guardando}
      >
        {guardando ? (
          <ActivityIndicator color={colors.accentInk} />
        ) : (
          <Text style={[styles.buttonText, { color: colors.accentInk }]}>Guardar mortalidad</Text>
        )}
      </TouchableOpacity>
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
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginTop: 4,
  },
  textArea: { minHeight: 70, textAlignVertical: 'top' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ghostButton: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  fotosRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  fotoPreview: { width: 64, height: 64, borderRadius: 8 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 12,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  stepperButton: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  stepperButtonText: { fontSize: 20, fontWeight: '700' },
  stepperValue: { minWidth: 48, textAlign: 'center', fontSize: 16, fontWeight: '800' },
  error: { fontFamily: 'PublicSans_600SemiBold', fontSize: 13, marginTop: 12 },
  button: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontFamily: 'PublicSans_700Bold', fontSize: 14 },
})
