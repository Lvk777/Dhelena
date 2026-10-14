-- Optional stable links for legacy profile UUIDs. Manual review/backfill only.
-- Never infer links or owner privileges from email inside this migration.
CREATE TABLE IF NOT EXISTS profile_auth_links (
    auth_user_id UUID PRIMARY KEY,
    profile_id UUID NOT NULL UNIQUE REFERENCES profiles(id),
    verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
