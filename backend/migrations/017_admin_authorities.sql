-- No bootstrap owner or permission changes. Activation/backfill requires approval.
CREATE TABLE IF NOT EXISTS admin_authorities (
    profile_id UUID PRIMARY KEY REFERENCES profiles(id),
    authority TEXT NOT NULL CHECK (authority IN ('owner', 'staff')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
