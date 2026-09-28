// Pozas (directorio) -- specs/app_granja_valencia_pozas_reproductores.md
// §2. Nuevo destino real del tile "Pozas" de Inicio (antes apuntaba
// directo a galpones-pozas.tsx, que sigue existiendo -- reubicada al
// botón "+ Nueva poza / galpón" acá abajo, no eliminada ni modificada).
import { useCallback, useEffect, useState } from 'react'
import { FlatList, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { supabase } from '../../../../lib/supabase/client'
import { useProfile } from '../../../../lib/supabase/useProfile'
import { useThemeColors } from '../../../../theme/useThemeColors'
import { BackToInicioButton } from '../../../../components/ui/BackToInicioButton'

type OcupacionPoza = {
  id: string
  codigo_poza: string
  galpon_id: string | null
  tipo_uso: string
  capacidad_max: number | null
  total_animales: number
  sobre_capacidad: boolean
}

type Galpon = { id: string; codigo_galpon: string; nombre: string | null }
type ReproductorResumen = { id: string; codigo_arete: string; sexo: string; estado: string }

export default function PozasDirectorioScreen() {
  const colors = useThemeColors()
  const { organizacion } = useProfile()

  const [pozas, setPozas] = useState<OcupacionPoza[]>([])
  const [galpones, setGalpones] = useState<Galpon[]>([])
  const [sinAsignar, setSinAsignar] = useState<ReproductorResumen[]>([])
  const [historial, setHistorial] = useState<ReproductorResumen[]>([])
  const [busqueda, setBusqueda] = useState('')

  const cargar = useCallback(async () => {
    if (!organizacion) return
    const [pozasRes, galponesRes, sinAsignarRes, historialRes] = await Promise.all([
      supabase.from('vw_pecuario_ocupacion_poza').select('*').eq('ID_Organizacion', organizacion),
      supabase.from('PECUARIO_GALPONES').select('id, codigo_galpon, nombre').eq('ID_Organizacion', organizacion),
      supabase
        .from('PECUARIO_REPRODUCTORES')
        .select('id, codigo_arete, sexo, estado')
        .eq('ID_Organizacion', organizacion)
        .is('jaula_actual_id', null)
        .eq('estado', 'activo'),
      supabase
        .from('PECUARIO_REPRODUCTORES')
        .select('id, codigo_arete, sexo, estado')
        .eq('ID_Organizacion', organizacion)
        .in('estado', ['vendido', 'muerto']),
    ])
    if (pozasRes.data) setPozas(pozasRes.data as OcupacionPoza[])
    if (galponesRes.data) setGalpones(galponesRes.data as Galpon[])
    if (sinAsignarRes.data) setSinAsignar(sinAsignarRes.data as ReproductorResumen[])
    if (historialRes.data) setHistorial(historialRes.data as ReproductorResumen[])
  }, [organizacion])

  useEffect(() => {
    cargar()
  }, [cargar])

  function nombreGalpon(galponId: string | null) {
    if (!galponId) return null
    const g = galpones.find((x) => x.id === galponId)
    return g ? g.nombre ?? g.codigo_galpon : null
  }

  const pozasFiltradas = pozas.filter((p) =>
    p.codigo_poza.toLowerCase().includes(busqueda.trim().toLowerCase())
  )

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.bg }]} contentContainerStyle={styles.content}>
      <BackToInicioButton />
      <Text style={[styles.title, { color: colors.ink }]}>Pozas</Text>

      <TextInput
        style={[styles.search, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.ink }]}
        placeholder="Buscar por código de poza…"
        placeholderTextColor={colors.inkFaint}
        value={busqueda}
        onChangeText={setBusqueda}
      />

      <FlatList
        data={pozasFiltradas}
        keyExtractor={(item) => item.id}
        scrollEnabled={false}
        renderItem={({ item }) => {
          const galpon = nombreGalpon(item.galpon_id)
          return (
            <TouchableOpacity
              style={[styles.pozaCard, { backgroundColor: colors.surface2, borderColor: colors.border }]}
              onPress={() => router.push({ pathname: '/pozas/[id]', params: { id: item.id } })}
            >
              <View style={styles.pozaCardInfo}>
                <Text style={[styles.pozaCodigo, { color: colors.ink }]}>{item.codigo_poza}</Text>
                <Text style={[styles.pozaMeta, { color: colors.inkSoft }]}>
                  {galpon ? `${galpon} · ` : ''}
                  {item.tipo_uso}
                </Text>
              </View>
              <View
                style={[
                  styles.badge,
                  { backgroundColor: item.sobre_capacidad ? colors.dangerSoft : colors.successSoft },
                ]}
              >
                <Text style={[styles.badgeText, { color: item.sobre_capacidad ? colors.danger : colors.success }]}>
                  {item.total_animales} / {item.capacidad_max ?? '—'}
                </Text>
              </View>
            </TouchableOpacity>
          )
        }}
        ListEmptyComponent={
          <Text style={[styles.itemListaVacia, { color: colors.inkFaint }]}>
            {busqueda ? 'Ninguna poza coincide con esa búsqueda.' : 'Todavía no hay pozas creadas.'}
          </Text>
        }
      />

      <TouchableOpacity
        style={[styles.nuevaPozaButton, { backgroundColor: colors.accentSoft }]}
        onPress={() => router.push('/galpones-pozas')}
      >
        <Text style={[styles.nuevaPozaText, { color: colors.accentDim }]}>+ Nueva poza / galpón</Text>
      </TouchableOpacity>

      {/* "Escanear" (QR) del mockup queda fuera de alcance -- no hay
          lector implementado todavía, se omite en vez de fingir que
          funciona (spec §2). */}

      <View style={[styles.seccionFija, { borderColor: colors.border }]}>
        <Text style={[styles.seccionTitulo, { color: colors.inkFaint }]}>Sin asignar</Text>
        {sinAsignar.length === 0 ? (
          <Text style={[styles.itemListaVacia, { color: colors.inkFaint }]}>
            No hay reproductores sin asignar.
          </Text>
        ) : (
          sinAsignar.map((r) => (
            <Text key={r.id} style={[styles.itemLista, { color: colors.ink }]}>
              {r.codigo_arete} · {r.sexo}
            </Text>
          ))
        )}
      </View>

      <View style={[styles.seccionFija, { borderColor: colors.border }]}>
        <Text style={[styles.seccionTitulo, { color: colors.inkFaint }]}>Historial</Text>
        {historial.length === 0 ? (
          <Text style={[styles.itemListaVacia, { color: colors.inkFaint }]}>
            No hay historial de bajas todavía.
          </Text>
        ) : (
          historial.map((r) => (
            <Text key={r.id} style={[styles.itemLista, { color: colors.ink }]}>
              {r.codigo_arete} · {r.sexo} · {r.estado}
            </Text>
          ))
        )}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 18, paddingBottom: 40 },
  title: { fontFamily: 'Archivo_800ExtraBold', fontSize: 20, marginBottom: 12 },
  search: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 14,
  },
  pozaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
  },
  pozaCardInfo: { flex: 1 },
  pozaCodigo: { fontFamily: 'Archivo_700Bold', fontSize: 15 },
  pozaMeta: { fontFamily: 'PublicSans_400Regular', fontSize: 12, marginTop: 2 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontFamily: 'PublicSans_700Bold', fontSize: 12 },
  itemListaVacia: { fontFamily: 'PublicSans_400Regular', fontSize: 13, paddingVertical: 4 },
  itemLista: { fontFamily: 'PublicSans_400Regular', fontSize: 13, paddingVertical: 4 },
  nuevaPozaButton: {
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  nuevaPozaText: { fontFamily: 'PublicSans_700Bold', fontSize: 13 },
  seccionFija: {
    borderTopWidth: 1,
    paddingTop: 14,
    marginTop: 6,
  },
  seccionTitulo: {
    fontFamily: 'PublicSans_700Bold',
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
})
