// Reemplazo/descarte -- specs/app_granja_valencia_reemplazo.md. Lista de
// reproductoras con sugerencias de reemplazo pendientes, agrupada por jaula, con
// "Confirmar descarte" / "Ignorar por ahora" por animal. La acción es en BLOQUE por
// reproductor (todas sus sugerencias pendientes) y no se puede deshacer, así que va
// precedida de un diálogo de confirmación. Los botones se ocultan por rol (admin y
// tecnico_campo) solo por cosmética: la barrera real es la RLS. El cliente escribe
// únicamente `estado`; `resuelta_en` y `proposito='descarte'` los escribe la base.
// Sin escritura offline (spec §6): es un UPDATE sobre filas que ya existen.
import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { leerSugerenciasPendientes, resolverSugerencias } from '../../../../lib/reemplazo/datos'
import {
  agruparPorJaula,
  contarAnimales,
  ETIQUETA_MOTIVO,
  mensajeDialogo,
  mensajeExito,
  puedeResolver,
  tituloGrupo,
  type AccionResolver,
  type AnimalSugerido,
  type FilaSugerencia,
} from '../../../../lib/reemplazo/logica'
import { useProfile } from '../../../../lib/supabase/useProfile'
import { useThemeColors } from '../../../../theme/useThemeColors'
import { BackToInicioButton } from '../../../../components/ui/BackToInicioButton'

export default function ReemplazoScreen() {
  const colors = useThemeColors()
  const { organizacion, rol } = useProfile()
  const puedeActuar = puedeResolver(rol)

  const [cargando, setCargando] = useState(true)
  const [filas, setFilas] = useState<FilaSugerencia[]>([])
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null) // banner de la acción: no se pierde al reintentar
  const [aviso, setAviso] = useState<string | null>(null)
  const [enCurso, setEnCurso] = useState<string[]>([]) // reproductor_id con una acción en vuelo

  const cargar = useCallback(async () => {
    if (!organizacion) return
    const { filas: nuevas, error: errLectura } = await leerSugerenciasPendientes(organizacion)
    setFilas(nuevas)
    setErrorCarga(errLectura)
    setCargando(false)
  }, [organizacion])

  useFocusEffect(
    useCallback(() => {
      cargar()
    }, [cargar])
  )

  async function ejecutar(animal: AnimalSugerido, accion: AccionResolver) {
    if (!organizacion) return
    // Una acción nueva limpia el banner y el aviso anteriores (y solo entonces).
    setError(null)
    setAviso(null)
    setEnCurso((prev) => [...prev, animal.reproductor_id])
    try {
      const resultado = await resolverSugerencias(organizacion, animal.reproductor_id, accion)
      if (resultado.tipo === 'error') {
        setError(resultado.mensaje)
        return
      }
      setAviso(resultado.tipo === 'ya_resueltas' ? resultado.mensaje : mensajeExito(accion, animal.codigo_arete))
      await cargar()
    } finally {
      setEnCurso((prev) => prev.filter((id) => id !== animal.reproductor_id))
    }
  }

  function pedirConfirmacion(animal: AnimalSugerido, accion: AccionResolver) {
    const d = mensajeDialogo(accion, animal.codigo_arete)
    Alert.alert(d.titulo, d.mensaje, [
      { text: 'Cancelar', style: 'cancel' },
      { text: d.boton, style: accion === 'confirmada' ? 'destructive' : 'default', onPress: () => ejecutar(animal, accion) },
    ])
  }

  if (cargando) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  const grupos = agruparPorJaula(filas)
  const totalAnimales = contarAnimales(filas)

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.bg }]} contentContainerStyle={styles.content}>
      <BackToInicioButton />
      <Text style={[styles.title, { color: colors.ink }]}>Sugeridas para reemplazo</Text>
      <Text style={[styles.subtitle, { color: colors.inkSoft }]}>
        {totalAnimales > 0
          ? `${totalAnimales} reproductora${totalAnimales === 1 ? '' : 's'} agrupadas por jaula — ${
              puedeActuar ? 'revisá y confirmá o ignorá cada una' : 'solo lectura'
            }`
          : 'No hay reproductoras sugeridas para reemplazo por ahora.'}
      </Text>

      {error && (
        <View style={[styles.banner, { backgroundColor: colors.dangerSoft }]}>
          <Text style={[styles.bannerText, { color: colors.danger }]}>{error}</Text>
        </View>
      )}
      {aviso && (
        <View style={[styles.banner, { backgroundColor: colors.successSoft }]}>
          <Text style={[styles.bannerText, { color: colors.success }]}>{aviso}</Text>
        </View>
      )}
      {errorCarga && (
        <View style={[styles.banner, { backgroundColor: colors.dangerSoft }]}>
          <Text style={[styles.bannerText, { color: colors.danger }]}>No se pudo cargar la lista: {errorCarga}</Text>
        </View>
      )}

      {grupos.map((grupo) => (
        <View key={grupo.codigo_poza ?? 'sin-jaula'}>
          <Text style={[styles.groupHeader, { color: colors.inkFaint }]}>{tituloGrupo(grupo)}</Text>
          {grupo.animales.map((animal) => {
            const ocupado = enCurso.includes(animal.reproductor_id)
            return (
              <View key={animal.reproductor_id} style={[styles.card, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
                <View style={styles.cardHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.arete, { color: colors.ink }]}>{animal.codigo_arete}</Text>
                    {animal.raza ? <Text style={[styles.meta, { color: colors.inkSoft }]}>{animal.raza}</Text> : null}
                  </View>
                  <View style={styles.badges}>
                    {animal.sugerencias.map((s) => (
                      <View key={s.id} style={[styles.badge, { backgroundColor: colors.amberSoft }]}>
                        <Text style={[styles.badgeText, { color: colors.amber }]}>{ETIQUETA_MOTIVO[s.motivo]}</Text>
                      </View>
                    ))}
                  </View>
                </View>
                {animal.sugerencias.map((s) => (
                  <Text key={s.id} style={[styles.meta, { color: colors.inkSoft }]}>
                    {s.detalle}
                  </Text>
                ))}

                {puedeActuar && (
                  <View style={styles.actions}>
                    <TouchableOpacity
                      style={[styles.btn, { backgroundColor: colors.danger }, ocupado && styles.btnDisabled]}
                      onPress={() => pedirConfirmacion(animal, 'confirmada')}
                      disabled={ocupado}
                    >
                      {ocupado ? (
                        <ActivityIndicator color={colors.accentInk} />
                      ) : (
                        <Text style={[styles.btnText, { color: colors.accentInk }]}>Confirmar descarte</Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.btn, styles.btnGhost, { borderColor: colors.border }, ocupado && styles.btnDisabled]}
                      onPress={() => pedirConfirmacion(animal, 'ignorada')}
                      disabled={ocupado}
                    >
                      <Text style={[styles.btnText, { color: colors.inkSoft }]}>Ignorar por ahora</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )
          })}
        </View>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 18, paddingBottom: 40, gap: 12 },
  title: { fontFamily: 'Archivo_800ExtraBold', fontSize: 20 },
  subtitle: { fontFamily: 'PublicSans_400Regular', fontSize: 13 },
  banner: { borderRadius: 10, padding: 12 },
  bannerText: { fontFamily: 'PublicSans_600SemiBold', fontSize: 13 },
  groupHeader: {
    fontFamily: 'PublicSans_700Bold',
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
    marginTop: 4,
  },
  card: { borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 8, gap: 6 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  arete: { fontFamily: 'PublicSans_800ExtraBold', fontSize: 15 },
  meta: { fontFamily: 'PublicSans_400Regular', fontSize: 12 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end', maxWidth: '55%' },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontFamily: 'PublicSans_700Bold', fontSize: 11 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  btn: { flex: 1, borderRadius: 10, paddingVertical: 11, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { borderWidth: 1.5 },
  btnDisabled: { opacity: 0.5 },
  btnText: { fontFamily: 'PublicSans_700Bold', fontSize: 13 },
})
