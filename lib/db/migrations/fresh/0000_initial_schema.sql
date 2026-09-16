--
-- PostgreSQL database dump
--

DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plenario_runtime') THEN
    CREATE ROLE plenario_runtime NOLOGIN NOBYPASSRLS;
  END IF;
END
$role$;

-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: attendance_modality; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.attendance_modality AS ENUM (
    'online',
    'presencial'
);


--
-- Name: message_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.message_kind AS ENUM (
    'citacion',
    'informativo'
);


--
-- Name: message_reply; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.message_reply AS ENUM (
    'presencial',
    'online',
    'justificada'
);


--
-- Name: reply_review; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.reply_review AS ENUM (
    'pendiente',
    'aceptada',
    'rechazada'
);


--
-- Name: rol; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.rol AS ENUM (
    'admin',
    'miembro'
);


--
-- Name: session_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.session_status AS ENUM (
    'abierta',
    'cerrada'
);


--
-- Name: speaker_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.speaker_category AS ENUM (
    'pleno',
    'base'
);


--
-- Name: speaking_turn_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.speaking_turn_kind AS ENUM (
    'individual',
    'colectiva'
);


--
-- Name: speaking_turn_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.speaking_turn_status AS ENUM (
    'en_cola',
    'hablando',
    'finalizada'
);


--
-- Name: topic_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.topic_status AS ENUM (
    'abierto',
    'cerrado'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: agenda_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agenda_points (
    id integer NOT NULL,
    session_id integer NOT NULL,
    title text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    estimated_minutes integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    institution_id uuid DEFAULT (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid NOT NULL
);

ALTER TABLE ONLY public.agenda_points FORCE ROW LEVEL SECURITY;


--
-- Name: agenda_points_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agenda_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agenda_points_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agenda_points_id_seq OWNED BY public.agenda_points.id;


--
-- Name: attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance (
    id integer NOT NULL,
    session_id integer NOT NULL,
    user_id integer NOT NULL,
    modality public.attendance_modality DEFAULT 'presencial'::public.attendance_modality NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
    checked_out_at timestamp with time zone,
    institution_id uuid DEFAULT (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid NOT NULL
);

ALTER TABLE ONLY public.attendance FORCE ROW LEVEL SECURITY;


--
-- Name: attendance_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.attendance_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: attendance_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.attendance_id_seq OWNED BY public.attendance.id;


--
-- Name: institutions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.institutions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.institutions FORCE ROW LEVEL SECURITY;


--
-- Name: internal_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.internal_messages (
    id integer NOT NULL,
    session_id integer,
    subject text NOT NULL,
    body text NOT NULL,
    kind public.message_kind DEFAULT 'informativo'::public.message_kind NOT NULL,
    reply_deadline timestamp with time zone,
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    institution_id uuid DEFAULT (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid NOT NULL
);

ALTER TABLE ONLY public.internal_messages FORCE ROW LEVEL SECURITY;


--
-- Name: internal_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.internal_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: internal_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.internal_messages_id_seq OWNED BY public.internal_messages.id;


--
-- Name: justified_absences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.justified_absences (
    session_id integer NOT NULL,
    user_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    institution_id uuid DEFAULT (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid NOT NULL
);

ALTER TABLE ONLY public.justified_absences FORCE ROW LEVEL SECURITY;


--
-- Name: message_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_recipients (
    id integer NOT NULL,
    message_id integer NOT NULL,
    user_id integer NOT NULL,
    read_at timestamp with time zone,
    reply public.message_reply,
    reply_reason text,
    replied_at timestamp with time zone,
    review public.reply_review,
    review_note text,
    reviewed_by integer,
    reviewed_at timestamp with time zone,
    institution_id uuid DEFAULT (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid NOT NULL
);

ALTER TABLE ONLY public.message_recipients FORCE ROW LEVEL SECURITY;


--
-- Name: message_recipients_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.message_recipients_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: message_recipients_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.message_recipients_id_seq OWNED BY public.message_recipients.id;


--
-- Name: plenarias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plenarias (
    id integer NOT NULL,
    title text NOT NULL,
    location text,
    scheduled_at timestamp with time zone,
    status public.session_status DEFAULT 'cerrada'::public.session_status NOT NULL,
    session_code text NOT NULL,
    meeting_link text,
    acta_object_path text,
    acta_file_name text,
    speaking_round_open boolean DEFAULT false NOT NULL,
    speaking_round_agenda_point_id integer,
    official_start_at timestamp with time zone,
    official_end_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    institution_id uuid DEFAULT (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid NOT NULL
);

ALTER TABLE ONLY public.plenarias FORCE ROW LEVEL SECURITY;


--
-- Name: plenarias_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.plenarias_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: plenarias_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.plenarias_id_seq OWNED BY public.plenarias.id;


--
-- Name: session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session (
    sid character varying NOT NULL,
    sess json NOT NULL,
    expire timestamp(6) without time zone NOT NULL
);


--
-- Name: session_weights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_weights (
    session_id integer NOT NULL,
    user_id integer NOT NULL,
    weight numeric(10,4) DEFAULT '0'::numeric NOT NULL,
    weight_alt numeric(10,4) DEFAULT '0'::numeric NOT NULL,
    institution_id uuid DEFAULT (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid NOT NULL
);

ALTER TABLE ONLY public.session_weights FORCE ROW LEVEL SECURITY;


--
-- Name: speaking_turn_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.speaking_turn_participants (
    id integer NOT NULL,
    turn_id integer NOT NULL,
    user_id integer NOT NULL,
    institution_id uuid DEFAULT (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid NOT NULL
);

ALTER TABLE ONLY public.speaking_turn_participants FORCE ROW LEVEL SECURITY;


--
-- Name: speaking_turn_participants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.speaking_turn_participants_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: speaking_turn_participants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.speaking_turn_participants_id_seq OWNED BY public.speaking_turn_participants.id;


--
-- Name: speaking_turns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.speaking_turns (
    id integer NOT NULL,
    session_id integer NOT NULL,
    agenda_point_id integer,
    category public.speaker_category DEFAULT 'pleno'::public.speaker_category NOT NULL,
    kind public.speaking_turn_kind DEFAULT 'individual'::public.speaking_turn_kind NOT NULL,
    faculty text,
    user_id integer,
    speaker_name text,
    duration_seconds integer DEFAULT 60 NOT NULL,
    elapsed_seconds integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone,
    status public.speaking_turn_status DEFAULT 'en_cola'::public.speaking_turn_status NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    institution_id uuid DEFAULT (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid NOT NULL
);

ALTER TABLE ONLY public.speaking_turns FORCE ROW LEVEL SECURITY;


--
-- Name: speaking_turns_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.speaking_turns_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: speaking_turns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.speaking_turns_id_seq OWNED BY public.speaking_turns.id;


--
-- Name: unidades_academicas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unidades_academicas (
    id integer NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    institution_id uuid DEFAULT (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid NOT NULL
);

ALTER TABLE ONLY public.unidades_academicas FORCE ROW LEVEL SECURITY;


--
-- Name: unidades_academicas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.unidades_academicas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: unidades_academicas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.unidades_academicas_id_seq OWNED BY public.unidades_academicas.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username text NOT NULL,
    display_name text NOT NULL,
    "group" text,
    faculty text,
    email text,
    password text NOT NULL,
    voting_weight numeric(10,4) DEFAULT '0'::numeric NOT NULL,
    voting_weight_alt numeric(10,4) DEFAULT '0'::numeric NOT NULL,
    active boolean DEFAULT true NOT NULL,
    rol public.rol DEFAULT 'miembro'::public.rol NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    institution_id uuid DEFAULT (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid NOT NULL
);

ALTER TABLE ONLY public.users FORCE ROW LEVEL SECURITY;


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: vote_ballots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vote_ballots (
    id integer NOT NULL,
    vote_topic_id integer NOT NULL,
    user_id integer NOT NULL,
    weight_at_vote numeric(10,4) NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
    institution_id uuid DEFAULT (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid NOT NULL
);

ALTER TABLE ONLY public.vote_ballots FORCE ROW LEVEL SECURITY;


--
-- Name: vote_ballots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vote_ballots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vote_ballots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vote_ballots_id_seq OWNED BY public.vote_ballots.id;


--
-- Name: vote_topic_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vote_topic_candidates (
    id integer NOT NULL,
    vote_topic_id integer NOT NULL,
    name text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    institution_id uuid DEFAULT (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid NOT NULL
);

ALTER TABLE ONLY public.vote_topic_candidates FORCE ROW LEVEL SECURITY;


--
-- Name: vote_topic_candidates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vote_topic_candidates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vote_topic_candidates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vote_topic_candidates_id_seq OWNED BY public.vote_topic_candidates.id;


--
-- Name: vote_topic_estamentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vote_topic_estamentos (
    id integer NOT NULL,
    vote_topic_id integer NOT NULL,
    estamento_name text NOT NULL,
    institution_id uuid DEFAULT (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid NOT NULL
);

ALTER TABLE ONLY public.vote_topic_estamentos FORCE ROW LEVEL SECURITY;


--
-- Name: vote_topic_estamentos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vote_topic_estamentos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vote_topic_estamentos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vote_topic_estamentos_id_seq OWNED BY public.vote_topic_estamentos.id;


--
-- Name: vote_topics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vote_topics (
    id integer NOT NULL,
    session_id integer NOT NULL,
    agenda_point_id integer,
    title text NOT NULL,
    detail text,
    status public.topic_status DEFAULT 'cerrado'::public.topic_status NOT NULL,
    type text DEFAULT 'mocion'::text NOT NULL,
    candidate_mode text,
    weighted boolean DEFAULT true NOT NULL,
    weight_source text DEFAULT 'normal'::text NOT NULL,
    votes_per_voter integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    electorate_snapshot jsonb,
    institution_id uuid DEFAULT (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid NOT NULL
);

ALTER TABLE ONLY public.vote_topics FORCE ROW LEVEL SECURITY;


--
-- Name: vote_topics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vote_topics_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vote_topics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vote_topics_id_seq OWNED BY public.vote_topics.id;


--
-- Name: votes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.votes (
    id integer NOT NULL,
    vote_topic_id integer NOT NULL,
    user_id integer NOT NULL,
    ballot_id integer,
    candidate_id integer,
    option text,
    weight_at_vote numeric(10,4) NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
    institution_id uuid DEFAULT (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid NOT NULL
);

ALTER TABLE ONLY public.votes FORCE ROW LEVEL SECURITY;


--
-- Name: votes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.votes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: votes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.votes_id_seq OWNED BY public.votes.id;


--
-- Name: agenda_points id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agenda_points ALTER COLUMN id SET DEFAULT nextval('public.agenda_points_id_seq'::regclass);


--
-- Name: attendance id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance ALTER COLUMN id SET DEFAULT nextval('public.attendance_id_seq'::regclass);


--
-- Name: internal_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.internal_messages ALTER COLUMN id SET DEFAULT nextval('public.internal_messages_id_seq'::regclass);


--
-- Name: message_recipients id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_recipients ALTER COLUMN id SET DEFAULT nextval('public.message_recipients_id_seq'::regclass);


--
-- Name: plenarias id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plenarias ALTER COLUMN id SET DEFAULT nextval('public.plenarias_id_seq'::regclass);


--
-- Name: speaking_turn_participants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speaking_turn_participants ALTER COLUMN id SET DEFAULT nextval('public.speaking_turn_participants_id_seq'::regclass);


--
-- Name: speaking_turns id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speaking_turns ALTER COLUMN id SET DEFAULT nextval('public.speaking_turns_id_seq'::regclass);


--
-- Name: unidades_academicas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unidades_academicas ALTER COLUMN id SET DEFAULT nextval('public.unidades_academicas_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: vote_ballots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_ballots ALTER COLUMN id SET DEFAULT nextval('public.vote_ballots_id_seq'::regclass);


--
-- Name: vote_topic_candidates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_topic_candidates ALTER COLUMN id SET DEFAULT nextval('public.vote_topic_candidates_id_seq'::regclass);


--
-- Name: vote_topic_estamentos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_topic_estamentos ALTER COLUMN id SET DEFAULT nextval('public.vote_topic_estamentos_id_seq'::regclass);


--
-- Name: vote_topics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_topics ALTER COLUMN id SET DEFAULT nextval('public.vote_topics_id_seq'::regclass);


--
-- Name: votes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.votes ALTER COLUMN id SET DEFAULT nextval('public.votes_id_seq'::regclass);


--
-- Name: agenda_points agenda_points_institution_id_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agenda_points
    ADD CONSTRAINT agenda_points_institution_id_id UNIQUE (institution_id, id);


--
-- Name: agenda_points agenda_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agenda_points
    ADD CONSTRAINT agenda_points_pkey PRIMARY KEY (id);


--
-- Name: attendance attendance_institution_id_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_institution_id_id UNIQUE (institution_id, id);


--
-- Name: attendance attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_pkey PRIMARY KEY (id);


--
-- Name: attendance attendance_session_user; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_session_user UNIQUE (session_id, user_id);


--
-- Name: institutions institutions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.institutions
    ADD CONSTRAINT institutions_pkey PRIMARY KEY (id);


--
-- Name: institutions institutions_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.institutions
    ADD CONSTRAINT institutions_slug_key UNIQUE (slug);


--
-- Name: internal_messages internal_messages_institution_id_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.internal_messages
    ADD CONSTRAINT internal_messages_institution_id_id UNIQUE (institution_id, id);


--
-- Name: internal_messages internal_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.internal_messages
    ADD CONSTRAINT internal_messages_pkey PRIMARY KEY (id);


--
-- Name: justified_absences justified_absences_session_id_user_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.justified_absences
    ADD CONSTRAINT justified_absences_session_id_user_id_pk PRIMARY KEY (session_id, user_id);


--
-- Name: message_recipients message_recipient_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_recipients
    ADD CONSTRAINT message_recipient_unique UNIQUE (message_id, user_id);


--
-- Name: message_recipients message_recipients_institution_id_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_recipients
    ADD CONSTRAINT message_recipients_institution_id_id UNIQUE (institution_id, id);


--
-- Name: message_recipients message_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_recipients
    ADD CONSTRAINT message_recipients_pkey PRIMARY KEY (id);


--
-- Name: plenarias plenarias_institution_id_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plenarias
    ADD CONSTRAINT plenarias_institution_id_id UNIQUE (institution_id, id);


--
-- Name: plenarias plenarias_institution_session_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plenarias
    ADD CONSTRAINT plenarias_institution_session_code UNIQUE (institution_id, session_code);


--
-- Name: plenarias plenarias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plenarias
    ADD CONSTRAINT plenarias_pkey PRIMARY KEY (id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (sid);


--
-- Name: session_weights session_weights_session_id_user_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_weights
    ADD CONSTRAINT session_weights_session_id_user_id_pk PRIMARY KEY (session_id, user_id);


--
-- Name: speaking_turn_participants speaking_turn_participant; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speaking_turn_participants
    ADD CONSTRAINT speaking_turn_participant UNIQUE (turn_id, user_id);


--
-- Name: speaking_turn_participants speaking_turn_participants_institution_id_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speaking_turn_participants
    ADD CONSTRAINT speaking_turn_participants_institution_id_id UNIQUE (institution_id, id);


--
-- Name: speaking_turn_participants speaking_turn_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speaking_turn_participants
    ADD CONSTRAINT speaking_turn_participants_pkey PRIMARY KEY (id);


--
-- Name: speaking_turns speaking_turns_institution_id_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speaking_turns
    ADD CONSTRAINT speaking_turns_institution_id_id UNIQUE (institution_id, id);


--
-- Name: speaking_turns speaking_turns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speaking_turns
    ADD CONSTRAINT speaking_turns_pkey PRIMARY KEY (id);


--
-- Name: unidades_academicas unidades_academicas_institution_id_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unidades_academicas
    ADD CONSTRAINT unidades_academicas_institution_id_id UNIQUE (institution_id, id);


--
-- Name: unidades_academicas unidades_academicas_institution_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unidades_academicas
    ADD CONSTRAINT unidades_academicas_institution_name UNIQUE (institution_id, name);


--
-- Name: unidades_academicas unidades_academicas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unidades_academicas
    ADD CONSTRAINT unidades_academicas_pkey PRIMARY KEY (id);


--
-- Name: users users_institution_id_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_institution_id_id UNIQUE (institution_id, id);


--
-- Name: users users_institution_username; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_institution_username UNIQUE (institution_id, username);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: vote_ballots vote_ballots_institution_id_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_ballots
    ADD CONSTRAINT vote_ballots_institution_id_id UNIQUE (institution_id, id);


--
-- Name: vote_ballots vote_ballots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_ballots
    ADD CONSTRAINT vote_ballots_pkey PRIMARY KEY (id);


--
-- Name: vote_ballots vote_ballots_topic_user; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_ballots
    ADD CONSTRAINT vote_ballots_topic_user UNIQUE (vote_topic_id, user_id);


--
-- Name: vote_topic_candidates vote_topic_candidates_institution_id_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_topic_candidates
    ADD CONSTRAINT vote_topic_candidates_institution_id_id UNIQUE (institution_id, id);


--
-- Name: vote_topic_candidates vote_topic_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_topic_candidates
    ADD CONSTRAINT vote_topic_candidates_pkey PRIMARY KEY (id);


--
-- Name: vote_topic_estamentos vote_topic_estamentos_institution_id_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_topic_estamentos
    ADD CONSTRAINT vote_topic_estamentos_institution_id_id UNIQUE (institution_id, id);


--
-- Name: vote_topic_estamentos vote_topic_estamentos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_topic_estamentos
    ADD CONSTRAINT vote_topic_estamentos_pkey PRIMARY KEY (id);


--
-- Name: vote_topic_estamentos vote_topic_estamentos_topic_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_topic_estamentos
    ADD CONSTRAINT vote_topic_estamentos_topic_name UNIQUE (vote_topic_id, estamento_name);


--
-- Name: vote_topics vote_topics_institution_id_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_topics
    ADD CONSTRAINT vote_topics_institution_id_id UNIQUE (institution_id, id);


--
-- Name: vote_topics vote_topics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_topics
    ADD CONSTRAINT vote_topics_pkey PRIMARY KEY (id);


--
-- Name: votes votes_institution_id_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.votes
    ADD CONSTRAINT votes_institution_id_id UNIQUE (institution_id, id);


--
-- Name: votes votes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.votes
    ADD CONSTRAINT votes_pkey PRIMARY KEY (id);


--
-- Name: IDX_session_expire; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_session_expire" ON public.session USING btree (expire);


--
-- Name: idx_agenda_points_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agenda_points_session ON public.agenda_points USING btree (session_id);


--
-- Name: idx_internal_messages_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_internal_messages_session ON public.internal_messages USING btree (session_id);


--
-- Name: idx_message_recipients_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_recipients_user ON public.message_recipients USING btree (user_id);


--
-- Name: idx_speaking_turns_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_speaking_turns_session ON public.speaking_turns USING btree (session_id);


--
-- Name: idx_vote_topic_candidates_topic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vote_topic_candidates_topic ON public.vote_topic_candidates USING btree (vote_topic_id);


--
-- Name: idx_vote_topics_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vote_topics_session ON public.vote_topics USING btree (session_id);


--
-- Name: justified_absences_institution_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX justified_absences_institution_idx ON public.justified_absences USING btree (institution_id);


--
-- Name: session_weights_institution_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_weights_institution_idx ON public.session_weights USING btree (institution_id);


--
-- Name: agenda_points agenda_points_institution_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agenda_points
    ADD CONSTRAINT agenda_points_institution_fk FOREIGN KEY (institution_id) REFERENCES public.institutions(id);


--
-- Name: agenda_points agenda_points_session_id_plenarias_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agenda_points
    ADD CONSTRAINT agenda_points_session_id_plenarias_id_fk FOREIGN KEY (institution_id, session_id) REFERENCES public.plenarias(institution_id, id) ON DELETE CASCADE;


--
-- Name: attendance attendance_institution_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_institution_fk FOREIGN KEY (institution_id) REFERENCES public.institutions(id);


--
-- Name: attendance attendance_session_id_plenarias_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_session_id_plenarias_id_fk FOREIGN KEY (institution_id, session_id) REFERENCES public.plenarias(institution_id, id) ON DELETE CASCADE;


--
-- Name: attendance attendance_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_user_id_users_id_fk FOREIGN KEY (institution_id, user_id) REFERENCES public.users(institution_id, id) ON DELETE CASCADE;


--
-- Name: internal_messages internal_messages_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.internal_messages
    ADD CONSTRAINT internal_messages_created_by_users_id_fk FOREIGN KEY (institution_id, created_by) REFERENCES public.users(institution_id, id) ON DELETE SET NULL (created_by);


--
-- Name: internal_messages internal_messages_institution_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.internal_messages
    ADD CONSTRAINT internal_messages_institution_fk FOREIGN KEY (institution_id) REFERENCES public.institutions(id);


--
-- Name: internal_messages internal_messages_session_id_plenarias_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.internal_messages
    ADD CONSTRAINT internal_messages_session_id_plenarias_id_fk FOREIGN KEY (institution_id, session_id) REFERENCES public.plenarias(institution_id, id) ON DELETE CASCADE;


--
-- Name: justified_absences justified_absences_institution_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.justified_absences
    ADD CONSTRAINT justified_absences_institution_fk FOREIGN KEY (institution_id) REFERENCES public.institutions(id);


--
-- Name: justified_absences justified_absences_session_id_plenarias_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.justified_absences
    ADD CONSTRAINT justified_absences_session_id_plenarias_id_fk FOREIGN KEY (institution_id, session_id) REFERENCES public.plenarias(institution_id, id) ON DELETE CASCADE;


--
-- Name: justified_absences justified_absences_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.justified_absences
    ADD CONSTRAINT justified_absences_user_id_users_id_fk FOREIGN KEY (institution_id, user_id) REFERENCES public.users(institution_id, id) ON DELETE CASCADE;


--
-- Name: message_recipients message_recipients_institution_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_recipients
    ADD CONSTRAINT message_recipients_institution_fk FOREIGN KEY (institution_id) REFERENCES public.institutions(id);


--
-- Name: message_recipients message_recipients_message_id_internal_messages_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_recipients
    ADD CONSTRAINT message_recipients_message_id_internal_messages_id_fk FOREIGN KEY (institution_id, message_id) REFERENCES public.internal_messages(institution_id, id) ON DELETE CASCADE;


--
-- Name: message_recipients message_recipients_reviewed_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_recipients
    ADD CONSTRAINT message_recipients_reviewed_by_users_id_fk FOREIGN KEY (institution_id, reviewed_by) REFERENCES public.users(institution_id, id) ON DELETE SET NULL (reviewed_by);


--
-- Name: message_recipients message_recipients_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_recipients
    ADD CONSTRAINT message_recipients_user_id_users_id_fk FOREIGN KEY (institution_id, user_id) REFERENCES public.users(institution_id, id) ON DELETE CASCADE;


--
-- Name: plenarias plenarias_institution_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plenarias
    ADD CONSTRAINT plenarias_institution_fk FOREIGN KEY (institution_id) REFERENCES public.institutions(id);


--
-- Name: plenarias plenarias_round_agenda_institution_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plenarias
    ADD CONSTRAINT plenarias_round_agenda_institution_fk FOREIGN KEY (institution_id, speaking_round_agenda_point_id) REFERENCES public.agenda_points(institution_id, id) ON DELETE SET NULL (speaking_round_agenda_point_id);


--
-- Name: session_weights session_weights_institution_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_weights
    ADD CONSTRAINT session_weights_institution_fk FOREIGN KEY (institution_id) REFERENCES public.institutions(id);


--
-- Name: session_weights session_weights_session_id_plenarias_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_weights
    ADD CONSTRAINT session_weights_session_id_plenarias_id_fk FOREIGN KEY (institution_id, session_id) REFERENCES public.plenarias(institution_id, id) ON DELETE CASCADE;


--
-- Name: session_weights session_weights_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_weights
    ADD CONSTRAINT session_weights_user_id_users_id_fk FOREIGN KEY (institution_id, user_id) REFERENCES public.users(institution_id, id) ON DELETE CASCADE;


--
-- Name: speaking_turn_participants speaking_turn_participants_institution_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speaking_turn_participants
    ADD CONSTRAINT speaking_turn_participants_institution_fk FOREIGN KEY (institution_id) REFERENCES public.institutions(id);


--
-- Name: speaking_turn_participants speaking_turn_participants_turn_id_speaking_turns_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speaking_turn_participants
    ADD CONSTRAINT speaking_turn_participants_turn_id_speaking_turns_id_fk FOREIGN KEY (institution_id, turn_id) REFERENCES public.speaking_turns(institution_id, id) ON DELETE CASCADE;


--
-- Name: speaking_turn_participants speaking_turn_participants_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speaking_turn_participants
    ADD CONSTRAINT speaking_turn_participants_user_id_users_id_fk FOREIGN KEY (institution_id, user_id) REFERENCES public.users(institution_id, id) ON DELETE CASCADE;


--
-- Name: speaking_turns speaking_turns_agenda_point_id_agenda_points_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speaking_turns
    ADD CONSTRAINT speaking_turns_agenda_point_id_agenda_points_id_fk FOREIGN KEY (institution_id, agenda_point_id) REFERENCES public.agenda_points(institution_id, id) ON DELETE SET NULL (agenda_point_id);


--
-- Name: speaking_turns speaking_turns_institution_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speaking_turns
    ADD CONSTRAINT speaking_turns_institution_fk FOREIGN KEY (institution_id) REFERENCES public.institutions(id);


--
-- Name: speaking_turns speaking_turns_session_id_plenarias_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speaking_turns
    ADD CONSTRAINT speaking_turns_session_id_plenarias_id_fk FOREIGN KEY (institution_id, session_id) REFERENCES public.plenarias(institution_id, id) ON DELETE CASCADE;


--
-- Name: speaking_turns speaking_turns_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speaking_turns
    ADD CONSTRAINT speaking_turns_user_id_users_id_fk FOREIGN KEY (institution_id, user_id) REFERENCES public.users(institution_id, id) ON DELETE SET NULL (user_id);


--
-- Name: unidades_academicas unidades_academicas_institution_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unidades_academicas
    ADD CONSTRAINT unidades_academicas_institution_fk FOREIGN KEY (institution_id) REFERENCES public.institutions(id);


--
-- Name: users users_institution_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_institution_fk FOREIGN KEY (institution_id) REFERENCES public.institutions(id);


--
-- Name: vote_ballots vote_ballots_institution_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_ballots
    ADD CONSTRAINT vote_ballots_institution_fk FOREIGN KEY (institution_id) REFERENCES public.institutions(id);


--
-- Name: vote_ballots vote_ballots_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_ballots
    ADD CONSTRAINT vote_ballots_user_id_users_id_fk FOREIGN KEY (institution_id, user_id) REFERENCES public.users(institution_id, id) ON DELETE CASCADE;


--
-- Name: vote_ballots vote_ballots_vote_topic_id_vote_topics_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_ballots
    ADD CONSTRAINT vote_ballots_vote_topic_id_vote_topics_id_fk FOREIGN KEY (institution_id, vote_topic_id) REFERENCES public.vote_topics(institution_id, id) ON DELETE CASCADE;


--
-- Name: vote_topic_candidates vote_topic_candidates_institution_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_topic_candidates
    ADD CONSTRAINT vote_topic_candidates_institution_fk FOREIGN KEY (institution_id) REFERENCES public.institutions(id);


--
-- Name: vote_topic_candidates vote_topic_candidates_vote_topic_id_vote_topics_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_topic_candidates
    ADD CONSTRAINT vote_topic_candidates_vote_topic_id_vote_topics_id_fk FOREIGN KEY (institution_id, vote_topic_id) REFERENCES public.vote_topics(institution_id, id) ON DELETE CASCADE;


--
-- Name: vote_topic_estamentos vote_topic_estamentos_institution_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_topic_estamentos
    ADD CONSTRAINT vote_topic_estamentos_institution_fk FOREIGN KEY (institution_id) REFERENCES public.institutions(id);


--
-- Name: vote_topic_estamentos vote_topic_estamentos_vote_topic_id_vote_topics_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_topic_estamentos
    ADD CONSTRAINT vote_topic_estamentos_vote_topic_id_vote_topics_id_fk FOREIGN KEY (institution_id, vote_topic_id) REFERENCES public.vote_topics(institution_id, id) ON DELETE CASCADE;


--
-- Name: vote_topics vote_topics_agenda_point_id_agenda_points_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_topics
    ADD CONSTRAINT vote_topics_agenda_point_id_agenda_points_id_fk FOREIGN KEY (institution_id, agenda_point_id) REFERENCES public.agenda_points(institution_id, id) ON DELETE SET NULL (agenda_point_id);


--
-- Name: vote_topics vote_topics_institution_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_topics
    ADD CONSTRAINT vote_topics_institution_fk FOREIGN KEY (institution_id) REFERENCES public.institutions(id);


--
-- Name: vote_topics vote_topics_session_id_plenarias_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_topics
    ADD CONSTRAINT vote_topics_session_id_plenarias_id_fk FOREIGN KEY (institution_id, session_id) REFERENCES public.plenarias(institution_id, id) ON DELETE CASCADE;


--
-- Name: votes votes_ballot_id_vote_ballots_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.votes
    ADD CONSTRAINT votes_ballot_id_vote_ballots_id_fk FOREIGN KEY (institution_id, ballot_id) REFERENCES public.vote_ballots(institution_id, id) ON DELETE CASCADE;


--
-- Name: votes votes_candidate_id_vote_topic_candidates_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.votes
    ADD CONSTRAINT votes_candidate_id_vote_topic_candidates_id_fk FOREIGN KEY (institution_id, candidate_id) REFERENCES public.vote_topic_candidates(institution_id, id) ON DELETE CASCADE;


--
-- Name: votes votes_institution_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.votes
    ADD CONSTRAINT votes_institution_fk FOREIGN KEY (institution_id) REFERENCES public.institutions(id);


--
-- Name: votes votes_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.votes
    ADD CONSTRAINT votes_user_id_users_id_fk FOREIGN KEY (institution_id, user_id) REFERENCES public.users(institution_id, id) ON DELETE CASCADE;


--
-- Name: votes votes_vote_topic_id_vote_topics_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.votes
    ADD CONSTRAINT votes_vote_topic_id_vote_topics_id_fk FOREIGN KEY (institution_id, vote_topic_id) REFERENCES public.vote_topics(institution_id, id) ON DELETE CASCADE;


--
-- Name: agenda_points; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agenda_points ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

--
-- Name: agenda_points institution_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_access ON public.agenda_points TO plenario_runtime USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: attendance institution_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_access ON public.attendance TO plenario_runtime USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: institutions institution_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_access ON public.institutions TO plenario_runtime USING ((id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: internal_messages institution_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_access ON public.internal_messages TO plenario_runtime USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: justified_absences institution_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_access ON public.justified_absences TO plenario_runtime USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: message_recipients institution_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_access ON public.message_recipients TO plenario_runtime USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: plenarias institution_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_access ON public.plenarias TO plenario_runtime USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: session_weights institution_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_access ON public.session_weights TO plenario_runtime USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: speaking_turn_participants institution_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_access ON public.speaking_turn_participants TO plenario_runtime USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: speaking_turns institution_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_access ON public.speaking_turns TO plenario_runtime USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: unidades_academicas institution_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_access ON public.unidades_academicas TO plenario_runtime USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: users institution_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_access ON public.users TO plenario_runtime USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: vote_ballots institution_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_access ON public.vote_ballots TO plenario_runtime USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: vote_topic_candidates institution_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_access ON public.vote_topic_candidates TO plenario_runtime USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: vote_topic_estamentos institution_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_access ON public.vote_topic_estamentos TO plenario_runtime USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: vote_topics institution_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_access ON public.vote_topics TO plenario_runtime USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: votes institution_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_access ON public.votes TO plenario_runtime USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: agenda_points institution_boundary; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_boundary ON public.agenda_points AS RESTRICTIVE USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: attendance institution_boundary; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_boundary ON public.attendance AS RESTRICTIVE USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: institutions institution_boundary; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_boundary ON public.institutions AS RESTRICTIVE USING ((id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: internal_messages institution_boundary; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_boundary ON public.internal_messages AS RESTRICTIVE USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: justified_absences institution_boundary; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_boundary ON public.justified_absences AS RESTRICTIVE USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: message_recipients institution_boundary; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_boundary ON public.message_recipients AS RESTRICTIVE USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: plenarias institution_boundary; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_boundary ON public.plenarias AS RESTRICTIVE USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: session_weights institution_boundary; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_boundary ON public.session_weights AS RESTRICTIVE USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: speaking_turn_participants institution_boundary; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_boundary ON public.speaking_turn_participants AS RESTRICTIVE USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: speaking_turns institution_boundary; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_boundary ON public.speaking_turns AS RESTRICTIVE USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: unidades_academicas institution_boundary; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_boundary ON public.unidades_academicas AS RESTRICTIVE USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: users institution_boundary; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_boundary ON public.users AS RESTRICTIVE USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: vote_ballots institution_boundary; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_boundary ON public.vote_ballots AS RESTRICTIVE USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: vote_topic_candidates institution_boundary; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_boundary ON public.vote_topic_candidates AS RESTRICTIVE USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: vote_topic_estamentos institution_boundary; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_boundary ON public.vote_topic_estamentos AS RESTRICTIVE USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: vote_topics institution_boundary; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_boundary ON public.vote_topics AS RESTRICTIVE USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: votes institution_boundary; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY institution_boundary ON public.votes AS RESTRICTIVE USING ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid)) WITH CHECK ((institution_id = (NULLIF(current_setting('app.institution_id'::text, true), ''::text))::uuid));


--
-- Name: institutions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.institutions ENABLE ROW LEVEL SECURITY;

--
-- Name: internal_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.internal_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: justified_absences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.justified_absences ENABLE ROW LEVEL SECURITY;

--
-- Name: message_recipients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.message_recipients ENABLE ROW LEVEL SECURITY;

--
-- Name: plenarias; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.plenarias ENABLE ROW LEVEL SECURITY;

--
-- Name: session_weights; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.session_weights ENABLE ROW LEVEL SECURITY;

--
-- Name: speaking_turn_participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.speaking_turn_participants ENABLE ROW LEVEL SECURITY;

--
-- Name: speaking_turns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.speaking_turns ENABLE ROW LEVEL SECURITY;

--
-- Name: unidades_academicas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.unidades_academicas ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: vote_ballots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vote_ballots ENABLE ROW LEVEL SECURITY;

--
-- Name: vote_topic_candidates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vote_topic_candidates ENABLE ROW LEVEL SECURITY;

--
-- Name: vote_topic_estamentos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vote_topic_estamentos ENABLE ROW LEVEL SECURITY;

--
-- Name: vote_topics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vote_topics ENABLE ROW LEVEL SECURITY;

--
-- Name: votes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--
