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
-- llamada solo desde lib/actions/sociosActions.js con la Service Role Key
-- (getSupabaseServerClient()).
--
-- CORRECCIÓN (2026-09-01, hallazgo de seguridad pre-aplicación): el
-- comentario original de este bloque decía "sin GRANT explícito... mismo
-- criterio que fn_guardar_inspeccion_completa" -- eso es incorrecto.
-- fn_guardar_inspeccion_completa SÍ tiene un GRANT EXECUTE explícito a
-- anon/authenticated (20260818_inspecciones_atomic_save.sql) -- deliberado,
-- porque INSPECCIONES/CAP_* ya son escribibles por anon (RLS
-- FOR ALL USING(true), ver 20260818_fix_inspecciones_rls.sql), así que
-- el GRANT no abre nada que las políticas no permitieran ya. PADRON_SOCIOS/
-- SOCIO_CERTIFICACIONES son el caso opuesto: `anon` NO tiene política de
-- escritura (por diseño deliberado, ver CLAUDE.md/docs/schema_live.md) --
-- el único camino de escritura es la Service Role Key. Postgres otorga
-- EXECUTE a PUBLIC por defecto en toda función nueva (CREATE FUNCTION no
-- lo revoca solo) -- sin un REVOKE explícito, esta función queda
-- alcanzable directo vía el endpoint RPC de PostgREST con solo la llave
-- `anon` pública, dejando que cualquiera cree socios reales (y sus
-- certificaciones) en el padrón de CUALQUIER organización, pasando por
-- alto assertMatchesExistingOrg/assertSocioExists de
-- lib/actions/sociosActions.js -- esas validaciones viven en la Server
-- Action, no en la base, así que la RPC por sí sola no las hereda.
--
-- Nota honesta sobre severidad real (no fue posible confirmar en vivo
-- contra pg_proc/information_schema desde este entorno, sin conexión
-- Postgres directa -- ver CLAUDE.md): como esta función NO es
-- SECURITY DEFINER, el INSERT interno corre con los privilegios del rol
-- que llama. Si RLS en PADRON_SOCIOS/SOCIO_CERTIFICACIONES efectivamente
-- deniega INSERT a `anon` hoy (no hay política de escritura para ese rol,
-- solo para `authenticated`), es posible que RLS por sí sola ya bloqueara
-- un intento de explotación incluso sin este REVOKE. Aun así, depender
-- solo de RLS como única capa es frágil: si en el futuro se agrega
-- cualquier política de escritura `anon` a estas tablas por otro motivo
-- (como ya pasó con INSPECCIONES/CAP_*), esta función quedaría explotable
-- en el acto sin que nadie lo note, porque el nivel de función ya estaba
-- abierto de antes. El REVOKE/GRANT de abajo cierra la capa de función de
-- forma explícita, independientemente de lo que haga RLS -- defensa en
-- profundidad, no un parche puntual sobre un solo síntoma.
REVOKE EXECUTE ON FUNCTION public.fn_crear_socio_con_certificaciones(text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_crear_socio_con_certificaciones(text, text, jsonb, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_crear_socio_con_certificaciones(text, text, jsonb, jsonb) TO service_role;

COMMIT;
