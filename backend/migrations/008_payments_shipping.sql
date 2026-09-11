-- =============================================================
-- 008 — Payment & Shipping columns for orders
-- Non-destructive: uses ADD COLUMN IF NOT EXISTS
-- =============================================================

-- ─── Payment fields ───────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_provider        TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS mercado_pago_order_id   TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS mercado_pago_payment_id  BIGINT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS mercado_pago_status      TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS mercado_pago_status_detail TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS mercado_pago_external_reference TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pix_qr_code             TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pix_qr_code_base64      TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pix_expiration_at       TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS installments           INT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at                TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_updated_at      TIMESTAMPTZ DEFAULT NULL;

-- ─── Shipping / Melhor Envio fields ───────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_provider       TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_service       TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_company       TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_deadline       INT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_quote_id      TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS melhor_envio_shipment_id TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_url            TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_status        TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS posted_at              TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at           TIMESTAMPTZ DEFAULT NULL;

-- ─── Order timeline events ────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    event       TEXT NOT NULL,
    description TEXT,
    metadata    JSONB,
    created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_events_order_id ON order_events(order_id);

-- ─── Webhook event log (idempotency for webhooks) ─────────────
CREATE TABLE IF NOT EXISTS webhook_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider    TEXT NOT NULL,
    event_id    TEXT,
    event_type  TEXT,
    payload     JSONB,
    processed   BOOLEAN DEFAULT false,
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE(provider, event_id)
);
