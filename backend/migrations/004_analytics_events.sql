-- 004_analytics_events.sql
-- Analytics events table (LGPD-compliant: no personal data beyond optional user_id)

CREATE TABLE IF NOT EXISTS analytics_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    anonymous_session_id VARCHAR(128),
    user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    event_name VARCHAR(64) NOT NULL,
    page VARCHAR(512),
    product_id UUID,
    source VARCHAR(128),
    medium VARCHAR(128),
    campaign VARCHAR(256),
    referrer VARCHAR(512),
    device_type VARCHAR(32),
    browser VARCHAR(64),
    os VARCHAR(64),
    country VARCHAR(64),
    region VARCHAR(128),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for analytics queries
CREATE INDEX IF NOT EXISTS idx_analytics_created_at ON analytics_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_event_name ON analytics_events (event_name);
CREATE INDEX IF NOT EXISTS idx_analytics_session ON analytics_events (anonymous_session_id);
CREATE INDEX IF NOT EXISTS idx_analytics_user ON analytics_events (user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_page ON analytics_events (page);

-- Contact messages table (for protected contact form)
CREATE TABLE IF NOT EXISTS contact_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(256) NOT NULL,
    email VARCHAR(256) NOT NULL,
    subject VARCHAR(256),
    message TEXT NOT NULL,
    ip_address VARCHAR(64),
    user_agent VARCHAR(512),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_created ON contact_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_email ON contact_messages (email);
