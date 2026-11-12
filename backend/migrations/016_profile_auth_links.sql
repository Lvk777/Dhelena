-- Optional stable links for legacy profile UUIDs. Manual review/backfill only.
-- Never infer links or owner privileges from email inside this migration.
CREATE TABLE IF NOT EXISTS profile_auth_links (
    auth_user_id UUID PRIMARY KEY,
    profile_id UUID NOT NULL UNIQUE REFERENCES profiles(id),
    verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Private link table: protect it even when a migration runs after the
-- 29-table security phase. Only the backend database owner needs access.
ALTER TABLE profile_auth_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE profile_auth_links FROM PUBLIC;
DO $revoke$
DECLARE role_name text;
BEGIN
    FOR role_name IN SELECT rolname FROM pg_roles
        WHERE rolname IN ('anon', 'authenticated', 'service_role')
    LOOP
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.profile_auth_links FROM %I', role_name);
    END LOOP;
END
$revoke$;
