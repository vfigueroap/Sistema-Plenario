BEGIN;

CREATE TABLE IF NOT EXISTS public.regular_speakers (
    id serial PRIMARY KEY,
    institution_id uuid DEFAULT (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid NOT NULL,
    name text NOT NULL,
    description text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT regular_speakers_institution_name UNIQUE (institution_id, name),
    CONSTRAINT regular_speakers_institution_fk FOREIGN KEY (institution_id) REFERENCES public.institutions(id)
);

ALTER TABLE public.regular_speakers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regular_speakers FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS institution_access ON public.regular_speakers;
CREATE POLICY institution_access ON public.regular_speakers TO plenario_runtime
  USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid))
  WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.regular_speakers TO plenario_runtime;
GRANT USAGE, SELECT ON SEQUENCE public.regular_speakers_id_seq TO plenario_runtime;

REVOKE ALL ON public.regular_speakers FROM PUBLIC;
DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.regular_speakers FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.regular_speakers FROM authenticated;
  END IF;
END
$roles$;

COMMIT;
