BEGIN;

GRANT USAGE ON SCHEMA public TO plenario_runtime;
GRANT SELECT ON public.institutions TO plenario_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.agenda_points,
  public.attendance,
  public.internal_messages,
  public.justified_absences,
  public.message_recipients,
  public.plenarias,
  public.session,
  public.session_weights,
  public.speaking_turn_participants,
  public.speaking_turns,
  public.unidades_academicas,
  public.users,
  public.vote_ballots,
  public.vote_topic_candidates,
  public.vote_topic_estamentos,
  public.vote_topics,
  public.votes
TO plenario_runtime;
GRANT USAGE, SELECT ON SEQUENCE
  public.agenda_points_id_seq,
  public.attendance_id_seq,
  public.internal_messages_id_seq,
  public.message_recipients_id_seq,
  public.plenarias_id_seq,
  public.speaking_turn_participants_id_seq,
  public.speaking_turns_id_seq,
  public.unidades_academicas_id_seq,
  public.users_id_seq,
  public.vote_ballots_id_seq,
  public.vote_topic_candidates_id_seq,
  public.vote_topic_estamentos_id_seq,
  public.vote_topics_id_seq,
  public.votes_id_seq
TO plenario_runtime;

REVOKE ALL ON
  public.agenda_points, public.attendance, public.institutions,
  public.internal_messages, public.justified_absences,
  public.message_recipients, public.plenarias, public.session,
  public.session_weights, public.speaking_turn_participants,
  public.speaking_turns, public.unidades_academicas, public.users,
  public.vote_ballots, public.vote_topic_candidates,
  public.vote_topic_estamentos, public.vote_topics, public.votes
FROM PUBLIC;
DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON
      public.agenda_points, public.attendance, public.institutions,
      public.internal_messages, public.justified_absences,
      public.message_recipients, public.plenarias, public.session,
      public.session_weights, public.speaking_turn_participants,
      public.speaking_turns, public.unidades_academicas, public.users,
      public.vote_ballots, public.vote_topic_candidates,
      public.vote_topic_estamentos, public.vote_topics, public.votes
    FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON
      public.agenda_points, public.attendance, public.institutions,
      public.internal_messages, public.justified_absences,
      public.message_recipients, public.plenarias, public.session,
      public.session_weights, public.speaking_turn_participants,
      public.speaking_turns, public.unidades_academicas, public.users,
      public.vote_ballots, public.vote_topic_candidates,
      public.vote_topic_estamentos, public.vote_topics, public.votes
    FROM authenticated;
  END IF;
END
$roles$;

COMMIT;
