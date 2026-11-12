-- Private, application-level administrative step-up. No change to Auth users,
-- profiles, links, orders or legacy login-code prototype (020).
CREATE TABLE IF NOT EXISTS public.admin_email_credentials (
    auth_user_id uuid PRIMARY KEY,
    profile_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE RESTRICT,
    destination_email text NOT NULL CHECK (destination_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    passphrase_hash text,
    bootstrap_hash text,
    credential_version integer NOT NULL DEFAULT 1 CHECK (credential_version > 0),
    failed_attempts integer NOT NULL DEFAULT 0,
    locked_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((passphrase_hash IS NULL) <> (bootstrap_hash IS NULL))
);

CREATE TABLE IF NOT EXISTS public.admin_email_challenges (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    auth_user_id uuid NOT NULL REFERENCES public.admin_email_credentials(auth_user_id) ON DELETE CASCADE,
    session_id uuid NOT NULL,
    credential_version integer NOT NULL,
    code_mac bytea NOT NULL,
    sent_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS admin_email_challenges_lookup
    ON public.admin_email_challenges(auth_user_id, session_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS public.admin_session_grants (
    session_id uuid PRIMARY KEY,
    auth_user_id uuid NOT NULL REFERENCES public.admin_email_credentials(auth_user_id) ON DELETE CASCADE,
    credential_version integer NOT NULL,
    verified_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_session_grants_user ON public.admin_session_grants(auth_user_id);

CREATE TABLE IF NOT EXISTS public.admin_step_up_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    auth_user_id uuid NOT NULL,
    session_id uuid,
    event_type text NOT NULL CHECK (event_type IN
        ('enrolled','bootstrap_failed','passphrase_failed','code_sent','code_failed','verified','revoked')),
    occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_step_up_events_user ON public.admin_step_up_events(auth_user_id,occurred_at DESC);

ALTER TABLE public.admin_email_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_email_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_session_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_step_up_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_email_credentials, public.admin_email_challenges, public.admin_session_grants,
    public.admin_step_up_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.admin_email_challenges_id_seq, public.admin_step_up_events_id_seq
    FROM PUBLIC, anon, authenticated, service_role;

-- Provisioning is a separate reviewed operation: insert immutable Auth UUID,
-- legacy profile UUID, independently approved mailbox and an out-of-band
-- bootstrap hash. Never select or grant authority by email coincidence.
