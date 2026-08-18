// Acciones de datos del Módulo de Inspección Socioeconómica (Fase 6).
// Portado de backend-inspecciones/admin-fed/src/components/features/
// inspecciones/useInspeccionForm.ts, con dos diferencias deliberadas:
//
//   1. CERO console.log/console.group de datos de la inspección. El
//      original loggea `JSON.stringify(socio)` (incluye socio_dni,
//      socio_nombre_completo) en cada carga — exactamente el hallazgo
//      "NO portar" de docs/audits/auditoria_backend_inspecciones.md §5.
//      Los errores se propagan como Error para que la UI los muestre,
//      nunca se imprimen los datos mismos.
//   2. Verificación multi-tenant explícita antes de escribir — el
//      original no la tiene (no existe sesión de usuario real en ese
//      repo tampoco). Se reutiliza resolveOrganizationId de
//      lib/eudrDdsExporter.js, mismo patrón que lib/eudrQcActions.js.

import { resolveOrganizationId } from '@/lib/eudrDdsExporter'

export { resolveOrganizationId }

export class InspeccionError extends Error {
  constructor(message) {
    super(message)
    this.name = 'InspeccionError'
  }
}

const LIST_COLUMNS =
  'ID_Inspeccion,ID_Socio,ID_Organizacion,ID_Parcela,Fecha_Visita,Inspector,Estado,' +
  'Tipo_Inspeccion,Resultado_Global,Fecha_Cierre,created_at'

const INSPECCION_COLUMNS =
  'ID_Inspeccion,ID_Socio,ID_Organizacion,ID_Parcela,Fecha_Visita,Inspector,Estado,' +
  'Tipo_Inspeccion,GPS_Punto_Control,Resultado_Global,resumen_incumplimientos,' +
  'comprobacion_interna,Fecha_Cierre,Firma_Productor,Firma_Inspector'

const PAGE_SIZE = 15

/**
 * Lista paginada/buscable de INSPECCIONES. No filtra por organización en
 * el propio `.select()` (RLS es la autoridad; el mismo patrón que
 * MapDashboard/QcConsolePage) — el caller filtra/valida client-side una
 * vez resuelta la organización.
 */
export async function fetchInspecciones(supabase, { page = 0, search = '' } = {}) {
  let query = supabase
    .from('INSPECCIONES')
    .select(LIST_COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

  if (search.trim()) {
    query = query.or(
      `Inspector.ilike.%${search}%,Estado.ilike.%${search}%,Tipo_Inspeccion.ilike.%${search}%,ID_Socio.ilike.%${search}%`
    )
  }

  const { data, error, count } = await query
  if (error) throw error
  return { rows: data ?? [], total: count ?? 0, pageSize: PAGE_SIZE }
}

function first(v) {
  if (!v) return {}
  return Array.isArray(v) ? v[0] ?? {} : v
}

const s = (v) => (v == null ? '' : String(v))
const n = (v) => (v == null ? null : Number(v))

/**
 * Fusiona las 7 tablas (INSPECCIONES + 6 CAP_*) en el shape plano que
 * espera el formulario. Nunca loggea `merged` ni ninguna sub-tabla.
 */
function mapToFormValues(merged) {
  const socio = first(merged.CAP_DATOS_SOCIO)
  const mic = first(merged.CAP_MIC)
  const cons = first(merged.CAP_CONSERVACION)
  const bien = first(merged.CAP_BIENESTAR)
  const riesg = first(merged.CAP_RIESGOS)
  const gest = first(merged.CAP_GESTION)

  return {
    Fecha_Visita: s(merged.Fecha_Visita),
    Inspector: s(merged.Inspector),
    Estado: s(merged.Estado) || 'En Proceso',
    Tipo_Inspeccion: s(merged.Tipo_Inspeccion),
    GPS_Punto_Control: s(merged.GPS_Punto_Control),
    Resultado_Global: s(merged.Resultado_Global),
    resumen_incumplimientos: s(merged.resumen_incumplimientos),
    comprobacion_interna: s(merged.comprobacion_interna),
    Fecha_Cierre: s(merged.Fecha_Cierre),
    Firma_Productor: s(merged.Firma_Productor),
    Firma_Inspector: s(merged.Firma_Inspector),

    socio_nombre_completo: s(socio.socio_nombre_completo),
    socio_dni: s(socio.socio_dni),
    socio_genero: s(socio.socio_genero),
    socio_fecha_nacimiento: s(socio.socio_fecha_nacimiento),
    socio_fecha_ingreso: s(socio.socio_fecha_ingreso),
    socio_departamento: s(socio.socio_departamento),
    socio_provincia: s(socio.socio_provincia),
    socio_distrito: s(socio.socio_distrito),
    localidad: s(socio.localidad),
    estado_civil: s(socio.estado_civil),
    conyuge_nombre: s(socio.conyuge_nombre),
    conyuge_dni: s(socio.conyuge_dni),
    educacion: s(socio.educacion),
    celular_socio: s(socio.celular_socio),
    celular_smartphone: s(socio.celular_smartphone),
    acceso_internet: s(socio.acceso_internet),
    redes_sociales: s(socio.redes_sociales),
    credito: s(socio.credito),
    credito_donde_otros: s(socio.credito_donde_otros),
    credito_utilizo: s(socio.credito_utilizo),
    generacion_ingresos: s(socio.generacion_ingresos),
    porcent_ingresos_cafe: n(socio.porcent_ingresos_cafe),
    percent_ingresos_crianza_animales: n(socio.percent_ingresos_crianza_animales),
    percent_ingresos_comercio: n(socio.percent_ingresos_comercio),
    percent_ingresos_construccion: n(socio.percent_ingresos_construccion),
    percent_ingresos_transporte: n(socio.percent_ingresos_transporte),
    percent_profesion_oficio: n(socio.percent_profesion_oficio),
    generacion_profesion_oficio_cual: s(socio.generacion_profesion_oficio_cual),
    percent_ingresos_otros_cultivo: n(socio.percent_ingresos_otros_cultivo),
    percent_ingresos_otros: n(socio.percent_ingresos_otros),
    generacion_profesion_oficio_cual_otro: s(socio.generacion_profesion_oficio_cual_otro),
    percent_tot: n(socio.percent_tot),
    familia: n(socio.familia),
    familia_menores_14: n(socio.familia_menores_14),
    familia_menores_15_18: n(socio.familia_menores_15_18),
    traba_cam_tot: n(socio.traba_cam_tot),
    nro_empleado_permanente: n(socio.nro_empleado_permanente),
    nro_empleado_temporales: n(socio.nro_empleado_temporales),
    cuenta_bancaria: s(socio.cuenta_bancaria),
    cuenta_bancaria_entidad: s(socio.cuenta_bancaria_entidad),
    centro_salud: s(socio.centro_salud),
    centro_salud_cuales: s(socio.centro_salud_cuales),
    centro_salud_distanc: s(socio.centro_salud_distanc),
    medio_transporte_tiene: s(socio.medio_transporte_tiene),
    hijos_socio: s(socio.hijos_socio),

    semilla_propia: s(mic.semilla_propia),
    semilla_proviene: s(mic.semilla_proviene),
    plant_norma_org: s(mic.plant_norma_org),
    plant_norma_org_insum_perm: s(mic.plant_norma_org_insum_perm),
    nc_plant_norma_org_insum_no_perm: s(mic.nc_plant_norma_org_insum_no_perm),
    manejo_sombra: s(mic.manejo_sombra),
    benef_humedo: s(mic.benef_humedo),
    benef_humedo_ob: s(mic.benef_humedo_ob),
    benef_humedo_estado: s(mic.benef_humedo_estado),
    tanque_tina: s(mic.tanque_tina),
    tanque_tina_tipo: s(mic.tanque_tina_tipo),
    tanque_tina_estado: s(mic.tanque_tina_estado),
    pulpero: s(mic.pulpero),
    pulpero_tipo: s(mic.pulpero_tipo),
    pulpero_estado: s(mic.pulpero_estado),
    manejo_aguas_mieles_practica: s(mic.manejo_aguas_mieles_practica),
    manejo_aguas_mieles_estado: s(mic.manejo_aguas_mieles_estado),
    nva_areas_adecuadas: s(mic.nva_areas_adecuadas),
    pract_plagenf: s(mic.pract_plagenf),
    pract_plagenf_cuales: s(mic.pract_plagenf_cuales),
    abonom: s(mic.abonom),
    insumo_perm_org: s(mic.insumo_perm_org),
    diversif_cultivos: s(mic.diversif_cultivos),
    diversif_cultivos_det: s(mic.diversif_cultivos_det),
    fertilidad: s(mic.fertilidad),
    men_mic: n(mic.men),
    may_mic: n(mic.may),
    total_puntaje_mic: n(mic.total_puntaje),

    extr_agua_sup: s(cons.extr_agua_sup),
    sepacion_areas: s(cons.sepacion_areas),
    conoce_proh_bosq_nat: s(cons.conoce_proh_bosq_nat),
    conoce_proh_bosq_nat_ue: s(cons.conoce_proh_bosq_nat_ue),
    vida_silv_ret: s(cons.vida_silv_ret),
    vida_silv_no_emp: s(cons.vida_silv_no_emp),
    especies: s(cons.especies),
    especies_medidas: s(cons.especies_medidas),
    fauna: s(cons.fauna),
    fauna_especies: s(cons.fauna_especies),
    fauna_medidas: s(cons.fauna_medidas),
    acciones_proteccion: s(cons.acciones_proteccion),
    acciones_proteccion_manera: s(cons.acciones_proteccion_manera),
    areas_produccion: s(cons.areas_produccion),
    areas_produccion_ob: s(cons.areas_produccion_ob),
    program_ecosist: s(cons.program_ecosist),
    proteccion_fuentes: s(cons.proteccion_fuentes),
    proteccion_fuentes_ob: s(cons.proteccion_fuentes_ob),
    men_conser: n(cons.men),
    may_conser: n(cons.may),
    total_puntaje_conser: n(cons.total_puntaje),

    condiciones_bienestar: s(bien.condiciones_bienestar),
    condiciones_bienestar_ob: s(bien.condiciones_bienestar_ob),
    condiciones_bienestar_mat: s(bien.condiciones_bienestar_mat),
    agua_consumo: s(bien.agua_consumo),
    agua_consumo_cuales: s(bien.agua_consumo_cuales),
    personal_monto: s(bien.personal_monto),
    personal_monto_ob: s(bien.personal_monto_ob),
    personal_monto_ob_otro: s(bien.personal_monto_ob_otro),
    horas_trabajo: s(bien.horas_trabajo),
    descanso_trabajo: s(bien.descanso_trabajo),
    monitoreo_menores: s(bien.monitoreo_menores),
    medicamentos: s(bien.medicamentos),
    medicamentos_lista: s(bien.medicamentos_lista),
    practica_discriminatoria: s(bien.practica_discriminatoria),
    practica_discriminatoria_ob: s(bien.practica_discriminatoria_ob),
    discrimin_raza_rel_sex: s(bien.discrimin_raza_rel_sex),
    discrimin_raza_rel_sex_ob: s(bien.discrimin_raza_rel_sex_ob),
    menores_trabajando: s(bien.menores_trabajando),
    menores_trabajando_edades: s(bien.menores_trabajando_edades),
    registro_trabajadores: s(bien.registro_trabajadores),
    quejas_reclamaciones: s(bien.quejas_reclamaciones),
    discapac_temporal_trab: s(bien.discapac_temporal_trab),
    discapac_temporal_trab_ob: s(bien.discapac_temporal_trab_ob),
    program_salud: s(bien.program_salud),
    capacit_trab_prot: s(bien.capacit_trab_prot),
    posee_epp: s(bien.posee_epp),
    accidentes: s(bien.accidentes),
    senalizacion_peligro: s(bien.senalizacion_peligro),
    nomas_seguridad: s(bien.nomas_seguridad),
    emergencia: s(bien.emergencia),
    situaciones_peligro: s(bien.situaciones_peligro),
    act_no_riesgo: s(bien.act_no_riesgo),
    obl_bien: n(bien.obl),
    may_bien: n(bien.may),
    men_bien: n(bien.men),
    total_puntaje_bien: n(bien.total_puntaje),

    conoce_uso_estiercoles_fresco: s(riesg.conoce_uso_estiercoles_fresco),
    insumos_no_permit: s(riesg.insumos_no_permit),
    insumos_no_permit_que_encontro: s(riesg.insumos_no_permit_que_encontro),
    tala: s(riesg.tala),
    tala_ob: s(riesg.tala_ob),
    contaminacion: s(riesg.contaminacion),
    contaminacion_ob: s(riesg.contaminacion_ob),
    prev_mez_prod: s(riesg.prev_mez_prod),
    obs_no_mezcla_contam: s(riesg.obs_no_mezcla_contam),
    producc_paralela: s(riesg.producc_paralela),
    obs_paralela: s(riesg.obs_paralela),
    implem_medidas: s(riesg.implem_medidas),
    secado: s(riesg.secado),
    secado_cuales: s(riesg.secado_cuales),
    secado_condic: s(riesg.secado_condic),
    almacenam: s(riesg.almacenam),
    almacenam_condic: s(riesg.almacenam_condic),
    condic_oper: s(riesg.condic_oper),
    levantamiento_nc: s(riesg.levantamiento_nc),
    levantamiento_estado: s(riesg.levantamiento_estado),
    men_riesgo: n(riesg.men),
    may_riesgo: n(riesg.may),
    obl_riesgo: n(riesg.obl),
    total_puntaje_riesgo: n(riesg.total_puntaje),

    cronog_finca: s(gest.cronog_finca),
    cronog_finca_estado: s(gest.cronog_finca_estado),
    registros: s(gest.registros),
    visita_asist_tecnica: s(gest.visita_asist_tecnica),
    temas_asist_tec: s(gest.temas_asist_tec),
    temas_asist_tec_nc: s(gest.temas_asist_tec_nc),
    croquis: s(gest.croquis),
    croquis_tipo: s(gest.croquis_tipo),
    prima_cj: s(gest.prima_cj),
    prima_cj_des: s(gest.prima_cj_des),
    uso_fuente_energia: s(gest.uso_fuente_energia),
    uso_fuente_energia_tipo: s(gest.uso_fuente_energia_tipo),
    asistio_capacitacion: s(gest.asistio_capacitacion),
    asistio_capacitacion_num: n(gest.asistio_capacitacion_num),
    invierte_finca: s(gest.invierte_finca),
    invierte_finca_actividades: s(gest.invierte_finca_actividades),
    invierte_finca_actividades_otros: s(gest.invierte_finca_actividades_otros),
    ingresos_venta_producto: s(gest.ingresos_venta_producto),
    ingresos_venta_producto_monto: s(gest.ingresos_venta_producto_monto),
    directivos: s(gest.directivos),
    procedimiento_reclamo: s(gest.procedimiento_reclamo),
    riesgos_gest: s(gest.riesgos),
    men_gest: n(gest.men),
    may_gest: n(gest.may),
    total_puntaje_gest: n(gest.total_puntaje),
  }
}

/**
 * Carga una inspección completa (7 queries en paralelo) y la devuelve ya
 * fusionada al shape del formulario, junto con su ID_Organizacion cruda
 * (para la verificación multi-tenant al guardar). Nunca loggea los
 * datos cargados.
 */
export async function fetchInspeccionDetalle(supabase, id) {
  const [insp, socio, mic, cons, bien, riesg, gest] = await Promise.all([
    supabase.from('INSPECCIONES').select(INSPECCION_COLUMNS).eq('ID_Inspeccion', id).single(),
    supabase.from('CAP_DATOS_SOCIO').select('*').eq('ID_Inspeccion', id).maybeSingle(),
    supabase.from('CAP_MIC').select('*').eq('ID_Inspeccion', id).maybeSingle(),
    supabase.from('CAP_CONSERVACION').select('*').eq('ID_Inspeccion', id).maybeSingle(),
    supabase.from('CAP_BIENESTAR').select('*').eq('ID_Inspeccion', id).maybeSingle(),
    supabase.from('CAP_RIESGOS').select('*').eq('ID_Inspeccion', id).maybeSingle(),
    supabase.from('CAP_GESTION').select('*').eq('ID_Inspeccion', id).maybeSingle(),
  ])

  if (insp.error) {
    throw insp.error.code === 'PGRST116'
      ? new InspeccionError('Inspección no encontrada.')
      : insp.error
  }

  const merged = {
    ...insp.data,
    CAP_DATOS_SOCIO: socio.data ? [socio.data] : [],
    CAP_MIC: mic.data ? [mic.data] : [],
    CAP_CONSERVACION: cons.data ? [cons.data] : [],
    CAP_BIENESTAR: bien.data ? [bien.data] : [],
    CAP_RIESGOS: riesg.data ? [riesg.data] : [],
    CAP_GESTION: gest.data ? [gest.data] : [],
  }

  return {
    values: mapToFormValues(merged),
    organizationId: insp.data.ID_Organizacion ?? null,
  }
}

const trim = (v) => (v && v.trim ? v.trim() || null : v || null)

function payloadInspeccion(v) {
  return {
    Fecha_Visita: trim(v.Fecha_Visita),
    Inspector: v.Inspector,
    Estado: v.Estado,
    Tipo_Inspeccion: trim(v.Tipo_Inspeccion),
    GPS_Punto_Control: trim(v.GPS_Punto_Control),
    Resultado_Global: trim(v.Resultado_Global),
    resumen_incumplimientos: trim(v.resumen_incumplimientos),
    comprobacion_interna: trim(v.comprobacion_interna),
    Fecha_Cierre: trim(v.Fecha_Cierre),
    Firma_Productor: trim(v.Firma_Productor),
    Firma_Inspector: trim(v.Firma_Inspector),
  }
}

function payloadSocio(v) {
  return {
    socio_nombre_completo: trim(v.socio_nombre_completo),
    socio_dni: trim(v.socio_dni),
    socio_genero: trim(v.socio_genero),
    socio_fecha_nacimiento: trim(v.socio_fecha_nacimiento),
    socio_fecha_ingreso: trim(v.socio_fecha_ingreso),
    socio_departamento: trim(v.socio_departamento),
    socio_provincia: trim(v.socio_provincia),
    socio_distrito: trim(v.socio_distrito),
    localidad: trim(v.localidad),
    estado_civil: trim(v.estado_civil),
    conyuge_nombre: trim(v.conyuge_nombre),
    conyuge_dni: trim(v.conyuge_dni),
    educacion: trim(v.educacion),
    celular_socio: trim(v.celular_socio),
    celular_smartphone: trim(v.celular_smartphone),
    acceso_internet: trim(v.acceso_internet),
    redes_sociales: trim(v.redes_sociales),
    credito: trim(v.credito),
    credito_donde_otros: trim(v.credito_donde_otros),
    credito_utilizo: trim(v.credito_utilizo),
    generacion_ingresos: trim(v.generacion_ingresos),
    porcent_ingresos_cafe: v.porcent_ingresos_cafe ?? null,
    percent_ingresos_crianza_animales: v.percent_ingresos_crianza_animales ?? null,
    percent_ingresos_comercio: v.percent_ingresos_comercio ?? null,
    percent_ingresos_construccion: v.percent_ingresos_construccion ?? null,
    percent_ingresos_transporte: v.percent_ingresos_transporte ?? null,
    percent_profesion_oficio: v.percent_profesion_oficio ?? null,
    generacion_profesion_oficio_cual: trim(v.generacion_profesion_oficio_cual),
    percent_ingresos_otros_cultivo: v.percent_ingresos_otros_cultivo ?? null,
    percent_ingresos_otros: v.percent_ingresos_otros ?? null,
    generacion_profesion_oficio_cual_otro: trim(v.generacion_profesion_oficio_cual_otro),
    percent_tot: v.percent_tot ?? null,
    familia: v.familia ?? null,
    familia_menores_14: v.familia_menores_14 ?? null,
    familia_menores_15_18: v.familia_menores_15_18 ?? null,
    traba_cam_tot: v.traba_cam_tot ?? null,
    nro_empleado_permanente: v.nro_empleado_permanente ?? null,
    nro_empleado_temporales: v.nro_empleado_temporales ?? null,
    cuenta_bancaria: trim(v.cuenta_bancaria),
    cuenta_bancaria_entidad: trim(v.cuenta_bancaria_entidad),
    centro_salud: trim(v.centro_salud),
    centro_salud_cuales: trim(v.centro_salud_cuales),
    centro_salud_distanc: trim(v.centro_salud_distanc),
    medio_transporte_tiene: trim(v.medio_transporte_tiene),
    hijos_socio: trim(v.hijos_socio),
  }
}

function payloadMic(v) {
  return {
    semilla_propia: trim(v.semilla_propia),
    semilla_proviene: trim(v.semilla_proviene),
    plant_norma_org: trim(v.plant_norma_org),
    plant_norma_org_insum_perm: trim(v.plant_norma_org_insum_perm),
    nc_plant_norma_org_insum_no_perm: trim(v.nc_plant_norma_org_insum_no_perm),
    manejo_sombra: trim(v.manejo_sombra),
    benef_humedo: trim(v.benef_humedo),
    benef_humedo_ob: trim(v.benef_humedo_ob),
    benef_humedo_estado: trim(v.benef_humedo_estado),
    tanque_tina: trim(v.tanque_tina),
    tanque_tina_tipo: trim(v.tanque_tina_tipo),
    tanque_tina_estado: trim(v.tanque_tina_estado),
    pulpero: trim(v.pulpero),
    pulpero_tipo: trim(v.pulpero_tipo),
    pulpero_estado: trim(v.pulpero_estado),
    manejo_aguas_mieles_practica: trim(v.manejo_aguas_mieles_practica),
    manejo_aguas_mieles_estado: trim(v.manejo_aguas_mieles_estado),
    nva_areas_adecuadas: trim(v.nva_areas_adecuadas),
    pract_plagenf: trim(v.pract_plagenf),
    pract_plagenf_cuales: trim(v.pract_plagenf_cuales),
    abonom: trim(v.abonom),
    insumo_perm_org: trim(v.insumo_perm_org),
    diversif_cultivos: trim(v.diversif_cultivos),
    diversif_cultivos_det: trim(v.diversif_cultivos_det),
    fertilidad: trim(v.fertilidad),
    men: v.men_mic ?? null,
    may: v.may_mic ?? null,
    total_puntaje: v.total_puntaje_mic ?? null,
  }
}

function payloadConservacion(v) {
  return {
    extr_agua_sup: trim(v.extr_agua_sup),
    sepacion_areas: trim(v.sepacion_areas),
    conoce_proh_bosq_nat: trim(v.conoce_proh_bosq_nat),
    conoce_proh_bosq_nat_ue: trim(v.conoce_proh_bosq_nat_ue),
    vida_silv_ret: trim(v.vida_silv_ret),
    vida_silv_no_emp: trim(v.vida_silv_no_emp),
    especies: trim(v.especies),
    especies_medidas: trim(v.especies_medidas),
    fauna: trim(v.fauna),
    fauna_especies: trim(v.fauna_especies),
    fauna_medidas: trim(v.fauna_medidas),
    acciones_proteccion: trim(v.acciones_proteccion),
    acciones_proteccion_manera: trim(v.acciones_proteccion_manera),
    areas_produccion: trim(v.areas_produccion),
    areas_produccion_ob: trim(v.areas_produccion_ob),
    program_ecosist: trim(v.program_ecosist),
    proteccion_fuentes: trim(v.proteccion_fuentes),
    proteccion_fuentes_ob: trim(v.proteccion_fuentes_ob),
    men: v.men_conser ?? null,
    may: v.may_conser ?? null,
    total_puntaje: v.total_puntaje_conser ?? null,
  }
}

function payloadBienestar(v) {
  return {
    condiciones_bienestar: trim(v.condiciones_bienestar),
    condiciones_bienestar_ob: trim(v.condiciones_bienestar_ob),
    condiciones_bienestar_mat: trim(v.condiciones_bienestar_mat),
    agua_consumo: trim(v.agua_consumo),
    agua_consumo_cuales: trim(v.agua_consumo_cuales),
    personal_monto: trim(v.personal_monto),
    personal_monto_ob: trim(v.personal_monto_ob),
    personal_monto_ob_otro: trim(v.personal_monto_ob_otro),
    horas_trabajo: trim(v.horas_trabajo),
    descanso_trabajo: trim(v.descanso_trabajo),
    monitoreo_menores: trim(v.monitoreo_menores),
    medicamentos: trim(v.medicamentos),
    medicamentos_lista: trim(v.medicamentos_lista),
    practica_discriminatoria: trim(v.practica_discriminatoria),
    practica_discriminatoria_ob: trim(v.practica_discriminatoria_ob),
    discrimin_raza_rel_sex: trim(v.discrimin_raza_rel_sex),
    discrimin_raza_rel_sex_ob: trim(v.discrimin_raza_rel_sex_ob),
    menores_trabajando: trim(v.menores_trabajando),
    menores_trabajando_edades: trim(v.menores_trabajando_edades),
    registro_trabajadores: trim(v.registro_trabajadores),
    quejas_reclamaciones: trim(v.quejas_reclamaciones),
    discapac_temporal_trab: trim(v.discapac_temporal_trab),
    discapac_temporal_trab_ob: trim(v.discapac_temporal_trab_ob),
    program_salud: trim(v.program_salud),
    capacit_trab_prot: trim(v.capacit_trab_prot),
    posee_epp: trim(v.posee_epp),
    accidentes: trim(v.accidentes),
    senalizacion_peligro: trim(v.senalizacion_peligro),
    nomas_seguridad: trim(v.nomas_seguridad),
    emergencia: trim(v.emergencia),
    situaciones_peligro: trim(v.situaciones_peligro),
    act_no_riesgo: trim(v.act_no_riesgo),
    obl: v.obl_bien ?? null,
    may: v.may_bien ?? null,
    men: v.men_bien ?? null,
    total_puntaje: v.total_puntaje_bien ?? null,
  }
}

function payloadRiesgos(v) {
  return {
    conoce_uso_estiercoles_fresco: trim(v.conoce_uso_estiercoles_fresco),
    insumos_no_permit: trim(v.insumos_no_permit),
    insumos_no_permit_que_encontro: trim(v.insumos_no_permit_que_encontro),
    tala: trim(v.tala),
    tala_ob: trim(v.tala_ob),
    contaminacion: trim(v.contaminacion),
    contaminacion_ob: trim(v.contaminacion_ob),
    prev_mez_prod: trim(v.prev_mez_prod),
    obs_no_mezcla_contam: trim(v.obs_no_mezcla_contam),
    producc_paralela: trim(v.producc_paralela),
    obs_paralela: trim(v.obs_paralela),
    implem_medidas: trim(v.implem_medidas),
    secado: trim(v.secado),
    secado_cuales: trim(v.secado_cuales),
    secado_condic: trim(v.secado_condic),
    almacenam: trim(v.almacenam),
    almacenam_condic: trim(v.almacenam_condic),
    condic_oper: trim(v.condic_oper),
    levantamiento_nc: trim(v.levantamiento_nc),
    levantamiento_estado: trim(v.levantamiento_estado),
    men: v.men_riesgo ?? null,
    may: v.may_riesgo ?? null,
    obl: v.obl_riesgo ?? null,
    total_puntaje: v.total_puntaje_riesgo ?? null,
  }
}

function payloadGestion(v) {
  return {
    cronog_finca: trim(v.cronog_finca),
    cronog_finca_estado: trim(v.cronog_finca_estado),
    registros: trim(v.registros),
    visita_asist_tecnica: trim(v.visita_asist_tecnica),
    temas_asist_tec: trim(v.temas_asist_tec),
    temas_asist_tec_nc: trim(v.temas_asist_tec_nc),
    croquis: trim(v.croquis),
    croquis_tipo: trim(v.croquis_tipo),
    prima_cj: trim(v.prima_cj),
    prima_cj_des: trim(v.prima_cj_des),
    uso_fuente_energia: trim(v.uso_fuente_energia),
    uso_fuente_energia_tipo: trim(v.uso_fuente_energia_tipo),
    asistio_capacitacion: trim(v.asistio_capacitacion),
    asistio_capacitacion_num: v.asistio_capacitacion_num ?? null,
    invierte_finca: trim(v.invierte_finca),
    invierte_finca_actividades: trim(v.invierte_finca_actividades),
    invierte_finca_actividades_otros: trim(v.invierte_finca_actividades_otros),
    ingresos_venta_producto: trim(v.ingresos_venta_producto),
    ingresos_venta_producto_monto: trim(v.ingresos_venta_producto_monto),
    directivos: trim(v.directivos),
    procedimiento_reclamo: trim(v.procedimiento_reclamo),
    riesgos: trim(v.riesgos_gest),
    men: v.men_gest ?? null,
    may: v.may_gest ?? null,
    total_puntaje: v.total_puntaje_gest ?? null,
  }
}

const CHILD_TABLES = [
  { table: 'CAP_DATOS_SOCIO', pk: 'ID_Cap_Socio', payload: payloadSocio },
  { table: 'CAP_MIC', pk: 'ID_Cap_MIC', payload: payloadMic },
  { table: 'CAP_CONSERVACION', pk: 'ID_Cap_Conservacion', payload: payloadConservacion },
  { table: 'CAP_BIENESTAR', pk: 'ID_Cap_Bienestar', payload: payloadBienestar },
  { table: 'CAP_RIESGOS', pk: 'ID_Cap_Riesgos', payload: payloadRiesgos },
  { table: 'CAP_GESTION', pk: 'ID_Cap_Gestion', payload: payloadGestion },
]

/**
 * Crea o actualiza una inspección completa (INSPECCIONES + 6 CAP_*).
 * `organizationId` se valida contra `existingOrganizationId` (la
 * organización real del registro que se está editando, resuelta al
 * cargar) antes de escribir — nunca contra un valor que el propio
 * formulario pueda enviar. Para creación nueva, `existingOrganizationId`
 * es la organización activa resuelta de la lista ya cargada.
 */
export async function saveInspeccion(supabase, values, { id, organizationId, existingOrganizationId }) {
  if (!organizationId) {
    throw new InspeccionError('No se pudo determinar la organización activa.')
  }
  if (id && existingOrganizationId && existingOrganizationId !== organizationId) {
    throw new InspeccionError(
      'Violación multi-tenant: esta inspección no pertenece a la organización activa.'
    )
  }

  if (id) {
    const { error: errInsp } = await supabase
      .from('INSPECCIONES')
      .update(payloadInspeccion(values))
      .eq('ID_Inspeccion', id)
    if (errInsp) throw errInsp

    const existing = await Promise.all(
      CHILD_TABLES.map(({ table, pk }) =>
        supabase.from(table).select(pk).eq('ID_Inspeccion', id).maybeSingle()
      )
    )

    const results = await Promise.all(
      CHILD_TABLES.map(({ table, pk, payload }, i) =>
        existing[i].data
          ? supabase.from(table).update(payload(values)).eq('ID_Inspeccion', id)
          : supabase.from(table).insert({ [pk]: crypto.randomUUID(), ID_Inspeccion: id, ...payload(values) })
      )
    )
    const childError = results.find((r) => r.error)?.error
    if (childError) throw childError

    return { id, created: false }
  }

  const newId = crypto.randomUUID()
  const { error: errInsp } = await supabase
    .from('INSPECCIONES')
    .insert({ ID_Inspeccion: newId, ID_Organizacion: organizationId, ...payloadInspeccion(values) })
  if (errInsp) throw errInsp

  const results = await Promise.all(
    CHILD_TABLES.map(({ table, pk, payload }) =>
      supabase.from(table).insert({ [pk]: crypto.randomUUID(), ID_Inspeccion: newId, ...payload(values) })
    )
  )
  const childError = results.find((r) => r.error)?.error
  if (childError) throw childError

  return { id: newId, created: true }
}
