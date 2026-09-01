-- MIGRACIÓN IDEMPOTENTE: alta atómica de un socio nuevo + sus
-- certificaciones (PADRON_SOCIOS + SOCIO_CERTIFICACIONES).
-- Ver spec: specs/mejoras_importador_padron_masivo.md sección 12.
--
-- CONTEXTO: lib/actions/sociosActions.js::createSocio() hacía 3 llamadas
-- independientes a PostgREST -- INSERT a PADRON_SOCIOS, luego
-- syncSocioCertificaciones (SELECT catálogo + DELETE + INSERT a
-- SOCIO_CERTIFICACIONES) -- sin ninguna transacción de base de datos que
-- las envolviera. Un corte a mitad de camino (red, proceso del servidor)
-- dejaba un socio creado SIN ninguna de sus certificaciones, permanente:
-- un reintento de la misma fila del CSV detecta el ID_Socio ya existente
-- y la omite como duplicado, así que nunca vuelve a llamar a
-- syncSocioCertificaciones para repararlo. Esta función envuelve el alta
-- del socio y sus certificaciones en una sola invocación RPC -- atómica
-- por construcción, mismo patrón ya probado en
-- fn_guardar_inspeccion_completa (supabase/migrations/20260818_inspecciones_atomic_save.sql,
-- lib/inspeccionesActions.js::saveInspeccion).
--
-- DISEÑO: los nombres de columna de PADRON_SOCIOS se transcribieron
-- directamente de socioPayload() (lib/actions/sociosActions.js, versión
-- previa a esta migración) -- no se inventó ninguna columna nueva.
--
-- A diferencia de fn_guardar_inspeccion_completa (que usa DELETE+INSERT
-- para sus tablas hijas porque también cubre EDICIÓN), acá NO hay
-- DELETE previo -- esta función es solo para ALTA NUEVA (createSocio),
-- nunca hay filas preexistentes en SOCIO_CERTIFICACIONES para un
-- ID_Socio que se está insertando por primera vez. updateSocio (edición)
-- sigue usando syncSocioCertificaciones tal cual -- fuera de alcance de
-- este fix, que es específicamente sobre la carga masiva (alta nueva).
--
-- p_certificaciones: array jsonb de {"codigo": text, "estado": text|null}
-- -- SOLO las certificaciones marcadas 'Sí' en el payload ya parseado
-- (mismo filtro que hoy hace CERT_FLAG_FIELDS.filter(...) en JS, sin
-- cambios) -- el codigo->id del catálogo se resuelve ACÁ, dentro de la
-- misma transacción, en vez de en una consulta aparte del lado de JS
-- (que sería una lectura más, y una posible carrera si el catálogo
-- cambia entre la lectura y la escritura).
--
-- jsonb_populate_record(NULL::public."PADRON_SOCIOS", p_socio) se usa
-- solo como fuente de valores ya tipados según cada columna real (evita
-- adivinar tipos con casts manuales que no se pueden verificar sin
-- conexión viva a Postgres) -- el INSERT lista sus columnas de destino
-- explícitamente, nunca INSERT ... SELECT *, para no pisar con NULL
-- ninguna columna con DEFAULT (ej. activo, creado_en) que no venga en
-- el payload.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_crear_socio_con_certificaciones(
  p_id_socio text,
  p_organizacion text,
  p_socio jsonb,
  p_certificaciones jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_socio_id uuid;
  r_socio RECORD;
  r_cert RECORD;
BEGIN
  IF p_organizacion IS NULL OR p_organizacion = '' THEN
    RAISE EXCEPTION 'No se pudo determinar la organización activa.';
  END IF;

  IF p_id_socio IS NULL OR p_id_socio = '' THEN
    RAISE EXCEPTION 'Falta el Código de Socio (ID_Socio).';
  END IF;

  SELECT * INTO r_socio FROM jsonb_populate_record(NULL::public."PADRON_SOCIOS", p_socio);

  INSERT INTO public."PADRON_SOCIOS" (
    "ID_Socio", "ID_Organizacion", codigo_finca, socio_nombre_completo, socio_dni, socio_genero,
    socio_fecha_nacimiento, celular_socio, conyuge_nombre, conyuge_dni, socio_departamento,
    socio_provincia, socio_distrito, localidad, socio_fecha_ingreso
  ) VALUES (
    p_id_socio, p_organizacion, r_socio.codigo_finca, r_socio.socio_nombre_completo, r_socio.socio_dni,
    r_socio.socio_genero, r_socio.socio_fecha_nacimiento, r_socio.celular_socio, r_socio.conyuge_nombre,
    r_socio.conyuge_dni, r_socio.socio_departamento, r_socio.socio_provincia, r_socio.socio_distrito,
    r_socio.localidad, r_socio.socio_fecha_ingreso
  )
  RETURNING id INTO v_socio_id;

  -- Una certificación cuyo `codigo` no exista en el catálogo, o exista
  -- pero esté `activo = false`, no matchea ninguna fila del JOIN
  -- implícito del WHERE -- se omite en silencio, mismo criterio ya
  -- documentado en syncSocioCertificaciones (JS) para un catálogo
  -- desactualizado: no debe romper el alta del socio.
  FOR r_cert IN SELECT * FROM jsonb_to_recordset(p_certificaciones) AS x(codigo text, estado text)
  LOOP
    INSERT INTO public."SOCIO_CERTIFICACIONES" (id_socio, id_organizacion, id_certificacion, estado)
    SELECT v_socio_id, p_organizacion, cat.id, r_cert.estado
    FROM public."CERTIFICACIONES_CATALOGO" cat
    WHERE cat.codigo = r_cert.codigo AND cat.activo = true;
  END LOOP;

  RETURN jsonb_build_object('id', v_socio_id, 'id_socio', p_id_socio);
END;
$$;

-- No se usa SECURITY DEFINER: la función corre con el rol del llamador,
-- mismo criterio que fn_guardar_inspeccion_completa. Sin GRANT explícito
-- -- llamada solo desde lib/actions/sociosActions.js con la Service Role
-- Key (getSupabaseServerClient()), que ya bypasea privilegios de función
-- igual que bypasea RLS -- mismo patrón confirmado en
-- lib/actions/sociosActions.js::createParcela, que ya llama a
-- fn_sanitize_geometry (supabase/migrations/20260818_gis_core_sanitization.sql)
-- sin que esa migración tenga ningún GRANT tampoco.

COMMIT;
