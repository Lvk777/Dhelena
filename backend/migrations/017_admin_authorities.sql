-- No bootstrap owner or permission changes. Activation/backfill requires approval.
CREATE TABLE IF NOT EXISTS admin_authorities (
    profile_id UUID PRIMARY KEY REFERENCES profiles(id),
    authority TEXT NOT NULL CHECK (authority IN ('owner', 'staff')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Authority records must never be readable or writable through Data API roles.
ALTER TABLE admin_authorities ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE admin_authorities FROM PUBLIC;
DO $revoke$
DECLARE role_name text;
BEGIN
    FOR role_name IN SELECT rolname FROM pg_roles
        WHERE rolname IN ('anon', 'authenticated', 'service_role')
    LOOP
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.admin_authorities FROM %I', role_name);
    END LOOP;
END
$revoke$;
