-- MIGRACIÓN IDEMPOTENTE: guardado atómico del Formulario de Inspecciones FED
-- (INSPECCIONES + 6 tablas CAP_*).
-- Ver spec: specs/inspecciones_fed_audit.md
--
-- CONTEXTO: lib/inspeccionesActions.js::saveInspeccion() hacía 7
-- INSERT/UPDATE independientes vía PostgREST (Promise.all + llamadas
-- secuenciales), sin transacción de base de datos. Una falla a mitad de
-- camino (ej. la 4ª tabla CAP_* rechazada por una constraint) dejaba
-- registros huérfanos/parciales: una fila en INSPECCIONES sin todas sus
-- tablas hijas, o algunas CAP_* actualizadas y otras no. Esta función
-- envuelve las 7 tablas en una sola invocación de función — atómica por
-- construcción (un RAISE EXCEPTION en cualquier punto revierte todo lo que
-- la función ya escribió, dentro de la misma transacción implícita de la
-- llamada RPC).
--
-- DISEÑO: los nombres de columna de cada tabla se transcribieron
-- directamente desde las funciones payloadInspeccion/payloadSocio/
-- payloadMic/payloadConservacion/payloadBienestar/payloadRiesgos/
-- payloadGestion y CHILD_TABLES de lib/inspeccionesActions.js (versión
-- previa a esta migración) — no se inventó ningún nombre de columna nuevo.
--
-- Las 6 tablas CAP_* se manejan como DELETE + INSERT (no
-- SELECT-existing-then-UPDATE-or-INSERT) porque simplifica la función sin
-- cambiar el resultado observable: cada guardado del formulario siempre
-- envía el valor completo de las ~20-45 columnas de cada pestaña de una
-- vez (no hay edición parcial de una sola columna), así que un reemplazo
-- completo de la fila hija es equivalente a un UPDATE completo, y evita
-- tener que listar las columnas dos veces (una para el chequeo de
-- existencia, otra para el UPDATE).
--
-- jsonb_populate_record(NULL::public."TABLA", payload) se usa solo como
-- fuente de valores ya tipados correctamente según cada columna real (evita
-- adivinar tipos con casts manuales tipo ->>'col'::date, que no se pueden
-- verificar sin conexión viva a Postgres) — nunca como INSERT ... SELECT *,
-- porque eso pisaría con NULL cualquier columna con DEFAULT (ej.
-- created_at) que no venga en el payload. Todo INSERT/UPDATE lista sus
-- columnas de destino explícitamente.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_guardar_inspeccion_completa(
  p_id uuid,
  p_organizacion text,
  p_existing_organizacion text,
  p_inspeccion jsonb,
  p_socio jsonb,
  p_mic jsonb,
  p_conservacion jsonb,
  p_bienestar jsonb,
  p_riesgos jsonb,
  p_gestion jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
  v_created boolean;
  r_insp RECORD;
BEGIN
  IF p_organizacion IS NULL OR p_organizacion = '' THEN
    RAISE EXCEPTION 'No se pudo determinar la organización activa.';
  END IF;

  IF p_id IS NOT NULL THEN
    -- ── Modo edición ──────────────────────────────────────────────────
    IF p_existing_organizacion IS NOT NULL AND p_existing_organizacion <> p_organizacion THEN
      RAISE EXCEPTION 'Violación multi-tenant: esta inspección no pertenece a la organización activa.';
    END IF;

    v_id := p_id;
    v_created := false;

    SELECT * INTO r_insp FROM jsonb_populate_record(NULL::public."INSPECCIONES", p_inspeccion);

    UPDATE public."INSPECCIONES" SET
      "ID_Socio" = r_insp."ID_Socio",
      "ID_Parcela" = r_insp."ID_Parcela",
      "Fecha_Visita" = r_insp."Fecha_Visita",
      "Inspector" = r_insp."Inspector",
      "Estado" = r_insp."Estado",
      "Tipo_Inspeccion" = r_insp."Tipo_Inspeccion",
      "GPS_Punto_Control" = r_insp."GPS_Punto_Control",
      "Resultado_Global" = r_insp."Resultado_Global",
      resumen_incumplimientos = r_insp.resumen_incumplimientos,
      comprobacion_interna = r_insp.comprobacion_interna,
      "Fecha_Cierre" = r_insp."Fecha_Cierre",
      "Firma_Productor" = r_insp."Firma_Productor",
      "Firma_Inspector" = r_insp."Firma_Inspector"
    WHERE "ID_Inspeccion" = v_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Inspección no encontrada.';
    END IF;
  ELSE
    -- ── Modo creación ─────────────────────────────────────────────────
    v_id := extensions.uuid_generate_v4();
    v_created := true;

    SELECT * INTO r_insp FROM jsonb_populate_record(NULL::public."INSPECCIONES", p_inspeccion);

    INSERT INTO public."INSPECCIONES" (
      "ID_Inspeccion", "ID_Organizacion", "ID_Socio", "ID_Parcela", "Fecha_Visita",
      "Inspector", "Estado", "Tipo_Inspeccion", "GPS_Punto_Control", "Resultado_Global",
      resumen_incumplimientos, comprobacion_interna, "Fecha_Cierre", "Firma_Productor", "Firma_Inspector"
    ) VALUES (
      v_id, p_organizacion, r_insp."ID_Socio", r_insp."ID_Parcela", r_insp."Fecha_Visita",
      r_insp."Inspector", r_insp."Estado", r_insp."Tipo_Inspeccion", r_insp."GPS_Punto_Control", r_insp."Resultado_Global",
      r_insp.resumen_incumplimientos, r_insp.comprobacion_interna, r_insp."Fecha_Cierre", r_insp."Firma_Productor", r_insp."Firma_Inspector"
    );
  END IF;

  -- ── CAP_DATOS_SOCIO ────────────────────────────────────────────────
  DELETE FROM public."CAP_DATOS_SOCIO" WHERE "ID_Inspeccion" = v_id;
  INSERT INTO public."CAP_DATOS_SOCIO" (
    "ID_Cap_Socio", "ID_Inspeccion",
    socio_nombre_completo, socio_dni, socio_genero, socio_fecha_nacimiento, socio_fecha_ingreso,
    socio_departamento, socio_provincia, socio_distrito, localidad, estado_civil, conyuge_nombre,
    conyuge_dni, educacion, celular_socio, celular_smartphone, acceso_internet, redes_sociales,
    credito, credito_donde_otros, credito_utilizo, generacion_ingresos, porcent_ingresos_cafe,
    percent_ingresos_crianza_animales, percent_ingresos_comercio, percent_ingresos_construccion,
    percent_ingresos_transporte, percent_profesion_oficio, generacion_profesion_oficio_cual,
    percent_ingresos_otros_cultivo, percent_ingresos_otros, generacion_profesion_oficio_cual_otro,
    percent_tot, familia, familia_menores_14, familia_menores_15_18, traba_cam_tot,
    nro_empleado_permanente, nro_empleado_temporales, cuenta_bancaria, cuenta_bancaria_entidad,
    centro_salud, centro_salud_cuales, centro_salud_distanc, medio_transporte_tiene, hijos_socio
  )
  SELECT
    extensions.uuid_generate_v4(), v_id,
    r.socio_nombre_completo, r.socio_dni, r.socio_genero, r.socio_fecha_nacimiento, r.socio_fecha_ingreso,
    r.socio_departamento, r.socio_provincia, r.socio_distrito, r.localidad, r.estado_civil, r.conyuge_nombre,
    r.conyuge_dni, r.educacion, r.celular_socio, r.celular_smartphone, r.acceso_internet, r.redes_sociales,
    r.credito, r.credito_donde_otros, r.credito_utilizo, r.generacion_ingresos, r.porcent_ingresos_cafe,
    r.percent_ingresos_crianza_animales, r.percent_ingresos_comercio, r.percent_ingresos_construccion,
    r.percent_ingresos_transporte, r.percent_profesion_oficio, r.generacion_profesion_oficio_cual,
    r.percent_ingresos_otros_cultivo, r.percent_ingresos_otros, r.generacion_profesion_oficio_cual_otro,
    r.percent_tot, r.familia, r.familia_menores_14, r.familia_menores_15_18, r.traba_cam_tot,
    r.nro_empleado_permanente, r.nro_empleado_temporales, r.cuenta_bancaria, r.cuenta_bancaria_entidad,
    r.centro_salud, r.centro_salud_cuales, r.centro_salud_distanc, r.medio_transporte_tiene, r.hijos_socio
  FROM jsonb_populate_record(NULL::public."CAP_DATOS_SOCIO", p_socio) AS r;

  -- ── CAP_MIC ────────────────────────────────────────────────────────
  DELETE FROM public."CAP_MIC" WHERE "ID_Inspeccion" = v_id;
  INSERT INTO public."CAP_MIC" (
    "ID_Cap_MIC", "ID_Inspeccion",
    semilla_propia, semilla_proviene, plant_norma_org, plant_norma_org_insum_perm,
    nc_plant_norma_org_insum_no_perm, manejo_sombra, benef_humedo, benef_humedo_ob,
    benef_humedo_estado, tanque_tina, tanque_tina_tipo, tanque_tina_estado, pulpero,
    pulpero_tipo, pulpero_estado, manejo_aguas_mieles_practica, manejo_aguas_mieles_estado,
    nva_areas_adecuadas, pract_plagenf, pract_plagenf_cuales, abonom, insumo_perm_org,
    diversif_cultivos, diversif_cultivos_det, fertilidad, men, may, total_puntaje
  )
  SELECT
    extensions.uuid_generate_v4(), v_id,
    r.semilla_propia, r.semilla_proviene, r.plant_norma_org, r.plant_norma_org_insum_perm,
    r.nc_plant_norma_org_insum_no_perm, r.manejo_sombra, r.benef_humedo, r.benef_humedo_ob,
    r.benef_humedo_estado, r.tanque_tina, r.tanque_tina_tipo, r.tanque_tina_estado, r.pulpero,
    r.pulpero_tipo, r.pulpero_estado, r.manejo_aguas_mieles_practica, r.manejo_aguas_mieles_estado,
    r.nva_areas_adecuadas, r.pract_plagenf, r.pract_plagenf_cuales, r.abonom, r.insumo_perm_org,
    r.diversif_cultivos, r.diversif_cultivos_det, r.fertilidad, r.men, r.may, r.total_puntaje
  FROM jsonb_populate_record(NULL::public."CAP_MIC", p_mic) AS r;

  -- ── CAP_CONSERVACION ───────────────────────────────────────────────
  DELETE FROM public."CAP_CONSERVACION" WHERE "ID_Inspeccion" = v_id;
  INSERT INTO public."CAP_CONSERVACION" (
    "ID_Cap_Conservacion", "ID_Inspeccion",
    extr_agua_sup, sepacion_areas, conoce_proh_bosq_nat, conoce_proh_bosq_nat_ue, vida_silv_ret,
    vida_silv_no_emp, especies, especies_medidas, fauna, fauna_especies, fauna_medidas,
    acciones_proteccion, acciones_proteccion_manera, areas_produccion, areas_produccion_ob,
    program_ecosist, proteccion_fuentes, proteccion_fuentes_ob, men, may, total_puntaje
  )
  SELECT
    extensions.uuid_generate_v4(), v_id,
    r.extr_agua_sup, r.sepacion_areas, r.conoce_proh_bosq_nat, r.conoce_proh_bosq_nat_ue, r.vida_silv_ret,
    r.vida_silv_no_emp, r.especies, r.especies_medidas, r.fauna, r.fauna_especies, r.fauna_medidas,
    r.acciones_proteccion, r.acciones_proteccion_manera, r.areas_produccion, r.areas_produccion_ob,
    r.program_ecosist, r.proteccion_fuentes, r.proteccion_fuentes_ob, r.men, r.may, r.total_puntaje
  FROM jsonb_populate_record(NULL::public."CAP_CONSERVACION", p_conservacion) AS r;

  -- ── CAP_BIENESTAR ──────────────────────────────────────────────────
  DELETE FROM public."CAP_BIENESTAR" WHERE "ID_Inspeccion" = v_id;
  INSERT INTO public."CAP_BIENESTAR" (
    "ID_Cap_Bienestar", "ID_Inspeccion",
    condiciones_bienestar, condiciones_bienestar_ob, condiciones_bienestar_mat, agua_consumo,
    agua_consumo_cuales, personal_monto, personal_monto_ob, personal_monto_ob_otro, horas_trabajo,
    descanso_trabajo, monitoreo_menores, medicamentos, medicamentos_lista, practica_discriminatoria,
    practica_discriminatoria_ob, discrimin_raza_rel_sex, discrimin_raza_rel_sex_ob, menores_trabajando,
    menores_trabajando_edades, registro_trabajadores, quejas_reclamaciones, discapac_temporal_trab,
    discapac_temporal_trab_ob, program_salud, capacit_trab_prot, posee_epp, accidentes,
    senalizacion_peligro, nomas_seguridad, emergencia, situaciones_peligro, act_no_riesgo,
    obl, may, men, total_puntaje
  )
  SELECT
    extensions.uuid_generate_v4(), v_id,
    r.condiciones_bienestar, r.condiciones_bienestar_ob, r.condiciones_bienestar_mat, r.agua_consumo,
    r.agua_consumo_cuales, r.personal_monto, r.personal_monto_ob, r.personal_monto_ob_otro, r.horas_trabajo,
    r.descanso_trabajo, r.monitoreo_menores, r.medicamentos, r.medicamentos_lista, r.practica_discriminatoria,
    r.practica_discriminatoria_ob, r.discrimin_raza_rel_sex, r.discrimin_raza_rel_sex_ob, r.menores_trabajando,
    r.menores_trabajando_edades, r.registro_trabajadores, r.quejas_reclamaciones, r.discapac_temporal_trab,
    r.discapac_temporal_trab_ob, r.program_salud, r.capacit_trab_prot, r.posee_epp, r.accidentes,
    r.senalizacion_peligro, r.nomas_seguridad, r.emergencia, r.situaciones_peligro, r.act_no_riesgo,
    r.obl, r.may, r.men, r.total_puntaje
  FROM jsonb_populate_record(NULL::public."CAP_BIENESTAR", p_bienestar) AS r;

  -- ── CAP_RIESGOS ────────────────────────────────────────────────────
  DELETE FROM public."CAP_RIESGOS" WHERE "ID_Inspeccion" = v_id;
  INSERT INTO public."CAP_RIESGOS" (
    "ID_Cap_Riesgos", "ID_Inspeccion",
    conoce_uso_estiercoles_fresco, insumos_no_permit, insumos_no_permit_que_encontro, tala, tala_ob,
    contaminacion, contaminacion_ob, prev_mez_prod, obs_no_mezcla_contam, producc_paralela, obs_paralela,
    implem_medidas, secado, secado_cuales, secado_condic, almacenam, almacenam_condic, condic_oper,
    levantamiento_nc, levantamiento_estado, men, may, obl, total_puntaje
  )
  SELECT
    extensions.uuid_generate_v4(), v_id,
    r.conoce_uso_estiercoles_fresco, r.insumos_no_permit, r.insumos_no_permit_que_encontro, r.tala, r.tala_ob,
    r.contaminacion, r.contaminacion_ob, r.prev_mez_prod, r.obs_no_mezcla_contam, r.producc_paralela, r.obs_paralela,
    r.implem_medidas, r.secado, r.secado_cuales, r.secado_condic, r.almacenam, r.almacenam_condic, r.condic_oper,
    r.levantamiento_nc, r.levantamiento_estado, r.men, r.may, r.obl, r.total_puntaje
  FROM jsonb_populate_record(NULL::public."CAP_RIESGOS", p_riesgos) AS r;

  -- ── CAP_GESTION ────────────────────────────────────────────────────
  DELETE FROM public."CAP_GESTION" WHERE "ID_Inspeccion" = v_id;
  INSERT INTO public."CAP_GESTION" (
    "ID_Cap_Gestion", "ID_Inspeccion",
    cronog_finca, cronog_finca_estado, registros, visita_asist_tecnica, temas_asist_tec, temas_asist_tec_nc,
    croquis, croquis_tipo, prima_cj, prima_cj_des, uso_fuente_energia, uso_fuente_energia_tipo,
    asistio_capacitacion, asistio_capacitacion_num, invierte_finca, invierte_finca_actividades,
    invierte_finca_actividades_otros, ingresos_venta_producto, ingresos_venta_producto_monto,
    directivos, procedimiento_reclamo, riesgos, men, may, total_puntaje
  )
  SELECT
    extensions.uuid_generate_v4(), v_id,
    r.cronog_finca, r.cronog_finca_estado, r.registros, r.visita_asist_tecnica, r.temas_asist_tec, r.temas_asist_tec_nc,
    r.croquis, r.croquis_tipo, r.prima_cj, r.prima_cj_des, r.uso_fuente_energia, r.uso_fuente_energia_tipo,
    r.asistio_capacitacion, r.asistio_capacitacion_num, r.invierte_finca, r.invierte_finca_actividades,
    r.invierte_finca_actividades_otros, r.ingresos_venta_producto, r.ingresos_venta_producto_monto,
    r.directivos, r.procedimiento_reclamo, r.riesgos, r.men, r.may, r.total_puntaje
  FROM jsonb_populate_record(NULL::public."CAP_GESTION", p_gestion) AS r;

  RETURN jsonb_build_object('id', v_id, 'created', v_created);
END;
$$;

-- No se usa SECURITY DEFINER: la función corre con el rol del llamador
-- (anon/authenticated), igual que las 7 llamadas REST que reemplaza — las
-- políticas RLS FOR ALL / USING(true) ya existentes en INSPECCIONES/CAP_*
-- (20260818_fix_inspecciones_rls.sql) siguen siendo la autoridad real;
-- esta función no escala privilegios, solo agrupa las mismas escrituras en
-- una transacción.
GRANT EXECUTE ON FUNCTION public.fn_guardar_inspeccion_completa(
  uuid, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) TO anon, authenticated;

COMMIT;
