BEGIN;

CREATE OR REPLACE FUNCTION public.enqueue_individual_speaking_turn(
  p_session integer,
  p_point integer,
  p_category public.speaker_category,
  p_user integer,
  p_name text,
  p_duration integer
)
RETURNS SETOF public.speaking_turns
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(7301, p_session);
  RETURN QUERY
    INSERT INTO public.speaking_turns AS inserted (
      session_id, agenda_point_id, category, kind, user_id,
      speaker_name, duration_seconds, position
    )
    SELECT p_session, p_point, p_category, 'individual', p_user,
      p_name, p_duration, coalesce(max(t.position), -1) + 1
    FROM public.speaking_turns t
    WHERE t.session_id = p_session AND t.agenda_point_id IS NOT DISTINCT FROM p_point
    HAVING NOT coalesce(bool_or(t.user_id = p_user AND t.status <> 'finalizada' AND t.kind = 'individual'), false)
    RETURNING inserted.*;
END
$function$;

REVOKE ALL ON FUNCTION public.enqueue_individual_speaking_turn(integer, integer, public.speaker_category, integer, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_individual_speaking_turn(integer, integer, public.speaker_category, integer, text, integer) TO plenario_runtime;

COMMIT;
