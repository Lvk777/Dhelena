-- 006_admin_restructure.sql
-- Full admin panel restructure: banners, login history, sessions, 2FA, analytics

-- ═══ Extend banners with full campaign/position support ═══
ALTER TABLE banners
    ADD COLUMN IF NOT EXISTS internal_name text,
    ADD COLUMN IF NOT EXISTS image_mobile text,
    ADD COLUMN IF NOT EXISTS start_date timestamptz,
    ADD COLUMN IF NOT EXISTS end_date timestamptz,
    ADD COLUMN IF NOT EXISTS priority integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS promotion_id uuid,
    ADD COLUMN IF NOT EXISTS display_mode text DEFAULT 'priority' CHECK (display_mode IN ('carousel', 'priority')),
    ADD COLUMN IF NOT EXISTS button_text text,
    ADD COLUMN IF NOT EXISTS button_link text,
    ADD COLUMN IF NOT EXISTS max_image_size_mb integer DEFAULT 5;

-- Migrate existing CTA fields to new button_text/button_link if empty
UPDATE banners SET button_text = primary_cta_label WHERE button_text IS NULL AND primary_cta_label IS NOT NULL;
UPDATE banners SET button_link = primary_cta_link WHERE button_link IS NULL AND primary_cta_link IS NOT NULL;

-- ═══ Login History table ═══
CREATE TABLE IF NOT EXISTS login_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES profiles(id),
    email           TEXT NOT NULL,
    user_type       TEXT DEFAULT 'customer' CHECK (user_type IN ('admin', 'customer')),
    status          TEXT NOT NULL CHECK (status IN ('success', 'failed', 'blocked')),
    ip_address      TEXT,
    city            TEXT,
    state           TEXT,
    country         TEXT,
    device_type     TEXT,
    browser         TEXT,
    os              TEXT,
    user_agent      TEXT,
    session_id      TEXT,
    is_archived     BOOLEAN DEFAULT FALSE,
    is_suspicious   BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_history_user ON login_history(user_id);
CREATE INDEX IF NOT EXISTS idx_login_history_created ON login_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_history_status ON login_history(status);

-- ═══ Active Sessions table ═══
CREATE TABLE IF NOT EXISTS active_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES profiles(id),
    token_jti       TEXT UNIQUE,
    ip_address      TEXT,
    city            TEXT,
    state           TEXT,
    country         TEXT,
    device_type     TEXT,
    browser         TEXT,
    os              TEXT,
    user_agent      TEXT,
    last_activity   TIMESTAMPTZ DEFAULT now(),
    created_at      TIMESTAMPTZ DEFAULT now(),
    expires_at      TIMESTAMPTZ,
    is_revoked      BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_active_sessions_user ON active_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_active_sessions_revoked ON active_sessions(is_revoked);

-- ═══ 2FA fields on profiles ═══
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS totp_secret_encrypted text,
    ADD COLUMN IF NOT EXISTS totp_enabled boolean DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS require_2fa boolean DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS recovery_codes_encrypted text,
    ADD COLUMN IF NOT EXISTS preferred_theme text DEFAULT 'light';

-- ═══ Extend audit_logs with action types ═══
-- No schema change needed — action column already exists as TEXT
-- New action types documented here for reference:
-- banner_created, banner_updated, banner_deleted
-- promotion_created, promotion_updated, settings_updated
-- login_history_archived, session_revoked
-- 2fa_enabled, 2fa_disabled

-- ═══ Add analytics_events indexes for performance ═══
CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_event_name ON analytics_events(event_name);
CREATE INDEX IF NOT EXISTS idx_analytics_source ON analytics_events(source);
CREATE INDEX IF NOT EXISTS idx_analytics_session ON analytics_events(anonymous_session_id);
