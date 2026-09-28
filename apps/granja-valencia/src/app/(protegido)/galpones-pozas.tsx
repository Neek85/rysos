// Alta de Galpones y Pozas/Jaulas (specs/app_granja_valencia_galpones_jaulas.md)
// -- alcanzable desde el grid de acciones de Inicio (tile "Pozas"). El
// header (con logout) ya no vive acá -- lo monta
// src/app/(protegido)/_layout.tsx una sola vez para todo el grupo
// protegido (specs/app_granja_valencia_inicio.md §3).
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { GalponAltaSchema, PozaAltaSchema, TIPO_USO_POZA } from '../../../../../lib/validations/pecuario'
import { supabase } from '../../../lib/supabase/client'
import { useProfile } from '../../../lib/supabase/useProfile'
import { BackToInicioButton } from '../../../components/ui/BackToInicioButton'

type Galpon = {
  id: string
  codigo_galpon: string
  nombre: string | null
  capacidad_pozas: number | null
}

type Poza = {
  id: string
  codigo_poza: string
  tipo_uso: string
  galpon_id: string | null
  capacidad_max: number | null
}

export default function GalponesPozasScreen() {
  const { organizacion, loading: profileLoading } = useProfile()

  const [galpones, setGalpones] = useState<Galpon[]>([])
  const [pozas, setPozas] = useState<Poza[]>([])

  const [galponForm, setGalponForm] = useState({
    codigo_galpon: '',
    nombre: '',
    capacidad_pozas: '',
    dias_frecuencia_limpieza: '',
  })
  const [galponError, setGalponError] = useState<string | null>(null)
  const [savingGalpon, setSavingGalpon] = useState(false)

  const [pozaForm, setPozaForm] = useState({
    codigo_poza: '',
    tipo_uso: TIPO_USO_POZA[0] as string,
    galpon_id: null as string | null,
    capacidad_max: '',
    macho_codigo: '',
    linea_genetica: '',
  })
  const [pozaError, setPozaError] = useState<string | null>(null)
  const [savingPoza, setSavingPoza] = useState(false)

  const cargarListas = useCallback(async () => {
    if (!organizacion) return
    const [galponesRes, pozasRes] = await Promise.all([
      supabase.from('PECUARIO_GALPONES').select('*').eq('ID_Organizacion', organizacion),
      supabase.from('PECUARIO_JAULAS').select('*').eq('ID_Organizacion', organizacion),
    ])
    if (galponesRes.data) setGalpones(galponesRes.data as Galpon[])
    if (pozasRes.data) setPozas(pozasRes.data as Poza[])
  }, [organizacion])

  useEffect(() => {
    cargarListas()
  }, [cargarListas])

  const perfilListo = !profileLoading && !!organizacion
  const perfilMensaje = profileLoading
    ? 'Cargando tu perfil…'
    : !organizacion
      ? 'No se encontró tu perfil activo — contactá al admin.'
      : null

  async function handleGuardarGalpon() {
    setGalponError(null)
    if (!organizacion) return

    const parsed = GalponAltaSchema.safeParse({
      ID_Organizacion: organizacion,
      codigo_galpon: galponForm.codigo_galpon,
      nombre: galponForm.nombre || undefined,
      capacidad_pozas: galponForm.capacidad_pozas || undefined,
      dias_frecuencia_limpieza: galponForm.dias_frecuencia_limpieza || undefined,
    })

    if (!parsed.success) {
      setGalponError(parsed.error.issues[0]?.message ?? 'Datos inválidos.')
      return
    }

    setSavingGalpon(true)
    try {
      const { error } = await supabase.from('PECUARIO_GALPONES').insert(parsed.data)
      if (error) {
        setGalponError(error.message)
        return
      }
      setGalponForm({ codigo_galpon: '', nombre: '', capacidad_pozas: '', dias_frecuencia_limpieza: '' })
      await cargarListas()
    } finally {
      setSavingGalpon(false)
    }
  }

  async function handleGuardarPoza() {
    setPozaError(null)
    if (!organizacion) return

    const parsed = PozaAltaSchema.safeParse({
      ID_Organizacion: organizacion,
      codigo_poza: pozaForm.codigo_poza,
      tipo_uso: pozaForm.tipo_uso,
      galpon_id: pozaForm.galpon_id,
      capacidad_max: pozaForm.capacidad_max || undefined,
      macho_codigo: pozaForm.macho_codigo || undefined,
      linea_genetica: pozaForm.linea_genetica || undefined,
    })

    if (!parsed.success) {
      setPozaError(parsed.error.issues[0]?.message ?? 'Datos inválidos.')
      return
    }

    setSavingPoza(true)
    try {
      const { error } = await supabase.from('PECUARIO_JAULAS').insert({
        ...parsed.data,
        n_hembras_activas: 0,
      })
      if (error) {
        setPozaError(error.message)
        return
      }
      setPozaForm({
        codigo_poza: '',
        tipo_uso: TIPO_USO_POZA[0],
        galpon_id: null,
        capacidad_max: '',
        macho_codigo: '',
        linea_genetica: '',
      })
      await cargarListas()
    } finally {
      setSavingPoza(false)
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <BackToInicioButton />

      {perfilMensaje && <Text style={styles.perfilMensaje}>{perfilMensaje}</Text>}

      <Text style={styles.seccionTitulo}>Galpones</Text>
      <FlatList
        data={galpones}
        keyExtractor={(item) => item.id}
        scrollEnabled={false}
        renderItem={({ item }) => (
          <Text style={styles.itemLista}>
            {item.codigo_galpon}
            {item.nombre ? ` — ${item.nombre}` : ''}
          </Text>
        )}
        ListEmptyComponent={<Text style={styles.itemListaVacia}>Todavía no hay galpones creados.</Text>}
      />

      <TextInput
        style={styles.input}
        placeholder="Código de galpón"
        value={galponForm.codigo_galpon}
        onChangeText={(v) => setGalponForm((f) => ({ ...f, codigo_galpon: v }))}
      />
      <TextInput
        style={styles.input}
        placeholder="Nombre (opcional)"
        value={galponForm.nombre}
        onChangeText={(v) => setGalponForm((f) => ({ ...f, nombre: v }))}
      />
      <TextInput
        style={styles.input}
        placeholder="Capacidad de pozas (opcional)"
        keyboardType="numeric"
        value={galponForm.capacidad_pozas}
        onChangeText={(v) => setGalponForm((f) => ({ ...f, capacidad_pozas: v }))}
      />
      <TextInput
        style={styles.input}
        placeholder="Días de frecuencia de limpieza (opcional)"
        keyboardType="numeric"
        value={galponForm.dias_frecuencia_limpieza}
        onChangeText={(v) => setGalponForm((f) => ({ ...f, dias_frecuencia_limpieza: v }))}
      />
      {galponError && <Text style={styles.error}>{galponError}</Text>}
      <TouchableOpacity
        style={[styles.button, !perfilListo && styles.buttonDisabled]}
        onPress={handleGuardarGalpon}
        disabled={!perfilListo || savingGalpon}
      >
        {savingGalpon ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Guardar galpón</Text>}
      </TouchableOpacity>

      <Text style={styles.seccionTitulo}>Pozas / Jaulas</Text>
      <FlatList
        data={pozas}
        keyExtractor={(item) => item.id}
        scrollEnabled={false}
        renderItem={({ item }) => (
          <Text style={styles.itemLista}>
            {item.codigo_poza} — {item.tipo_uso}
          </Text>
        )}
        ListEmptyComponent={<Text style={styles.itemListaVacia}>Todavía no hay pozas creadas.</Text>}
      />

      <TextInput
        style={styles.input}
        placeholder="Código de poza"
        value={pozaForm.codigo_poza}
        onChangeText={(v) => setPozaForm((f) => ({ ...f, codigo_poza: v }))}
      />

      <Text style={styles.label}>Tipo de uso</Text>
      <View style={styles.chipsRow}>
        {TIPO_USO_POZA.map((valor) => (
          <TouchableOpacity
            key={valor}
            style={[styles.chip, pozaForm.tipo_uso === valor && styles.chipSelected]}
            onPress={() => setPozaForm((f) => ({ ...f, tipo_uso: valor }))}
          >
            <Text style={[styles.chipText, pozaForm.tipo_uso === valor && styles.chipTextSelected]}>{valor}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Galpón</Text>
      <View style={styles.chipsRow}>
        <TouchableOpacity
          style={[styles.chip, pozaForm.galpon_id === null && styles.chipSelected]}
          onPress={() => setPozaForm((f) => ({ ...f, galpon_id: null }))}
        >
          <Text style={[styles.chipText, pozaForm.galpon_id === null && styles.chipTextSelected]}>Sin asignar</Text>
        </TouchableOpacity>
        {galpones.map((g) => (
          <TouchableOpacity
            key={g.id}
            style={[styles.chip, pozaForm.galpon_id === g.id && styles.chipSelected]}
            onPress={() => setPozaForm((f) => ({ ...f, galpon_id: g.id }))}
          >
            <Text style={[styles.chipText, pozaForm.galpon_id === g.id && styles.chipTextSelected]}>
              {g.codigo_galpon}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TextInput
        style={styles.input}
        placeholder="Capacidad máxima (opcional)"
        keyboardType="numeric"
        value={pozaForm.capacidad_max}
        onChangeText={(v) => setPozaForm((f) => ({ ...f, capacidad_max: v }))}
      />
      <TextInput
        style={styles.input}
        placeholder="Código de macho (opcional)"
        value={pozaForm.macho_codigo}
        onChangeText={(v) => setPozaForm((f) => ({ ...f, macho_codigo: v }))}
      />
      <TextInput
        style={styles.input}
        placeholder="Línea genética (opcional)"
        value={pozaForm.linea_genetica}
        onChangeText={(v) => setPozaForm((f) => ({ ...f, linea_genetica: v }))}
      />
      {pozaError && <Text style={styles.error}>{pozaError}</Text>}
      <TouchableOpacity
        style={[styles.button, !perfilListo && styles.buttonDisabled]}
        onPress={handleGuardarPoza}
        disabled={!perfilListo || savingPoza}
      >
        {savingPoza ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Guardar poza</Text>}
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  perfilMensaje: {
    fontSize: 13,
    color: '#b45309',
    backgroundColor: '#fffbeb',
    padding: 8,
    borderRadius: 6,
    marginBottom: 16,
  },
  seccionTitulo: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1f2937',
    marginTop: 8,
    marginBottom: 8,
  },
  itemLista: {
    fontSize: 13,
    color: '#374151',
    paddingVertical: 4,
  },
  itemListaVacia: {
    fontSize: 13,
    color: '#9ca3af',
    paddingVertical: 4,
  },
  label: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 6,
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    fontSize: 14,
    backgroundColor: '#fff',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  chip: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#fff',
  },
  chipSelected: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  chipText: {
    fontSize: 12,
    color: '#374151',
  },
  chipTextSelected: {
    color: '#fff',
  },
  error: {
    color: '#dc2626',
    fontSize: 13,
    marginBottom: 8,
  },
  button: {
    backgroundColor: '#166534',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 24,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
})
