-- Run once, with migration-owner credentials and the application's schema
-- first in search_path. No route may use the restricted role until wired.
-- Existing IDs, snapshots and deletion semantics are preserved.
BEGIN;

CREATE TABLE institutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Used ONLY by this one-time backfill. No runtime default points here.
INSERT INTO institutions (id, slug, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'legacy', 'Initial institution');

DO $migration$
DECLARE
  domain_tables text[] := ARRAY[
    'users', 'plenarias', 'agenda_points', 'attendance',
    'vote_topics', 'vote_topic_candidates', 'vote_topic_estamentos',
    'vote_ballots', 'votes', 'speaking_turns', 'speaking_turn_participants',
    'unidades_academicas', 'session_weights', 'justified_absences',
    'internal_messages', 'message_recipients'
  ];
  schema_name text := current_schema();
  target_table text;
  fk record;
  seq record;
  delete_action text;
  predicate text := 'institution_id = nullif(current_setting(''app.institution_id'', true), '''')::uuid';
BEGIN
  -- A group role, not a login. Provision a separate non-owner login later and
  -- GRANT plenario_runtime to it. This migration grants no role memberships.
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'plenario_runtime') THEN
    CREATE ROLE plenario_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'plenario_runtime'
    AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication OR rolcanlogin))
    OR EXISTS (SELECT FROM pg_auth_members WHERE member = 'plenario_runtime'::regrole) THEN
    RAISE EXCEPTION 'plenario_runtime must be an unprivileged NOLOGIN role without inherited roles';
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO plenario_runtime', schema_name);

  FOREACH target_table IN ARRAY domain_tables LOOP
    EXECUTE format('ALTER TABLE %I.%I ADD COLUMN institution_id uuid', schema_name, target_table);
    EXECUTE format('UPDATE %I.%I SET institution_id = %L::uuid', schema_name, target_table,
      '00000000-0000-4000-8000-000000000001');
    EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN institution_id SET NOT NULL,
      ALTER COLUMN institution_id SET DEFAULT nullif(current_setting(''app.institution_id'', true), '''')::uuid,
      ADD CONSTRAINT %I FOREIGN KEY (institution_id) REFERENCES %I.institutions(id)',
      schema_name, target_table, target_table || '_institution_fk', schema_name);
    IF EXISTS (SELECT FROM information_schema.columns c
      WHERE c.table_schema = schema_name AND c.table_name = target_table AND c.column_name = 'id') THEN
      EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I UNIQUE (institution_id, id)',
        schema_name, target_table, target_table || '_institution_id_id');
    ELSE
      EXECUTE format('CREATE INDEX %I ON %I.%I (institution_id)',
        target_table || '_institution_idx', schema_name, target_table);
    END IF;
  END LOOP;

  -- Replace every existing domain FK, including optional references. The
  -- column-specific SET NULL deliberately leaves institution_id intact.
  FOR fk IN
    SELECT c.conname, child.relname AS child, parent.relname AS parent,
      a.attname AS child_column, pa.attname AS parent_column, c.confdeltype, c.confupdtype,
      cardinality(c.conkey) AS key_count
    FROM pg_constraint c
    JOIN pg_class child ON child.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = child.relnamespace
    JOIN pg_class parent ON parent.oid = c.confrelid
    JOIN pg_attribute a ON a.attrelid = child.oid AND a.attnum = c.conkey[1]
    JOIN pg_attribute pa ON pa.attrelid = parent.oid AND pa.attnum = c.confkey[1]
    WHERE c.contype = 'f' AND ns.nspname = schema_name
      AND child.relname = ANY(domain_tables) AND parent.relname = ANY(domain_tables)
  LOOP
    IF fk.key_count <> 1 OR fk.parent_column <> 'id' OR fk.confupdtype <> 'a' THEN
      RAISE EXCEPTION 'Unsupported existing FK: %', fk.conname;
    END IF;
    delete_action := CASE fk.confdeltype
      WHEN 'c' THEN 'CASCADE'
      WHEN 'n' THEN format('SET NULL (%I)', fk.child_column)
      WHEN 'r' THEN 'RESTRICT'
      WHEN 'a' THEN 'NO ACTION'
      ELSE NULL END;
    IF delete_action IS NULL THEN RAISE EXCEPTION 'Unsupported delete action: %', fk.conname; END IF;
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I,
      ADD CONSTRAINT %I FOREIGN KEY (institution_id, %I)
      REFERENCES %I.%I (institution_id, id) ON DELETE %s',
      schema_name, fk.child, fk.conname, fk.conname,
      fk.child_column, schema_name, fk.parent, delete_action);
  END LOOP;

  -- This legacy reference had no FK at all. It must not cross institutions.
  EXECUTE format('ALTER TABLE %I.plenarias ADD CONSTRAINT plenarias_round_agenda_institution_fk
    FOREIGN KEY (institution_id, speaking_round_agenda_point_id)
    REFERENCES %I.agenda_points (institution_id, id)
    ON DELETE SET NULL (speaking_round_agenda_point_id)', schema_name, schema_name);

  -- Global serial IDs stay global. Human-facing identifiers become local.
  EXECUTE format('ALTER TABLE %I.users DROP CONSTRAINT users_username_unique,
    ADD CONSTRAINT users_institution_username UNIQUE (institution_id, username)', schema_name);
  EXECUTE format('ALTER TABLE %I.plenarias DROP CONSTRAINT plenarias_session_code_unique,
    ADD CONSTRAINT plenarias_institution_session_code UNIQUE (institution_id, session_code)', schema_name);
  EXECUTE format('ALTER TABLE %I.unidades_academicas DROP CONSTRAINT unidades_academicas_name_unique,
    ADD CONSTRAINT unidades_academicas_institution_name UNIQUE (institution_id, name)', schema_name);

  -- Plaintext credentials are not part of the new system. Hashes remain.
  EXECUTE format('ALTER TABLE %I.users DROP COLUMN IF EXISTS plain_password', schema_name);

  FOREACH target_table IN ARRAY domain_tables || ARRAY['institutions'] LOOP
    IF target_table = 'institutions' THEN
      predicate := 'id = nullif(current_setting(''app.institution_id'', true), '''')::uuid';
    END IF;
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', schema_name, target_table);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', schema_name, target_table);
    -- Restrictive boundary also intersects any preexisting permissive policy.
    EXECUTE format('CREATE POLICY institution_boundary ON %I.%I AS RESTRICTIVE
      FOR ALL TO PUBLIC USING (%s) WITH CHECK (%s)', schema_name, target_table, predicate, predicate);
    EXECUTE format('CREATE POLICY institution_access ON %I.%I FOR ALL TO plenario_runtime
      USING (%s) WITH CHECK (%s)', schema_name, target_table, predicate, predicate);
    EXECUTE format('REVOKE ALL ON %I.%I FROM PUBLIC, plenario_runtime', schema_name, target_table);
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON %I.%I FROM anon', schema_name, target_table);
    END IF;
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON %I.%I FROM authenticated', schema_name, target_table);
    END IF;
    EXECUTE format('GRANT %s ON %I.%I TO plenario_runtime',
      CASE WHEN target_table = 'institutions' THEN 'SELECT' ELSE 'SELECT, INSERT, UPDATE, DELETE' END,
      schema_name, target_table);
  END LOOP;
  IF to_regclass(format('%I.session', schema_name)) IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON %I.session FROM PUBLIC', schema_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.session TO plenario_runtime', schema_name);
  END IF;
  -- Grant only sequences owned by scoped domain tables, not every sequence.
  FOR seq IN
    SELECT pg_get_serial_sequence(format('%I.%I', schema_name, c.table_name), c.column_name) AS name
    FROM information_schema.columns c WHERE c.table_schema = schema_name
      AND c.table_name = ANY(domain_tables) AND c.column_name = 'id'
  LOOP
    IF seq.name IS NOT NULL THEN
      EXECUTE format('GRANT USAGE ON SEQUENCE %s TO plenario_runtime', seq.name);
    END IF;
  END LOOP;
END
$migration$;
COMMIT;
