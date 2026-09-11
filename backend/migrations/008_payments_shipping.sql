-- 008_payments_shipping.sql
-- Adds payment (Mercado Pago) and shipping (Melhor Envio) columns to orders,
-- plus order_events and webhook_events tables.

-- ═══ Extend orders with payment & shipping fields ═══
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS payment_provider text,
    ADD COLUMN IF NOT EXISTS mercado_pago_order_id text,
    ADD COLUMN IF NOT EXISTS mercado_pago_payment_id text,
    ADD COLUMN IF NOT EXISTS mercado_pago_status text,
    ADD COLUMN IF NOT EXISTS mercado_pago_status_detail text,
    ADD COLUMN IF NOT EXISTS mercado_pago_external_reference text,
    ADD COLUMN IF NOT EXISTS pix_qr_code text,
    ADD COLUMN IF NOT EXISTS pix_qr_code_base64 text,
    ADD COLUMN IF NOT EXISTS pix_expiration_at timestamptz,
    ADD COLUMN IF NOT EXISTS installments integer,
    ADD COLUMN IF NOT EXISTS payment_updated_at timestamptz,
    ADD COLUMN IF NOT EXISTS paid_at timestamptz,
    ADD COLUMN IF NOT EXISTS shipping_quote_id text,
    ADD COLUMN IF NOT EXISTS shipping_carrier text,
    ADD COLUMN IF NOT EXISTS shipping_service_name text,
    ADD COLUMN IF NOT EXISTS shipping_delivery_time integer,
    ADD COLUMN IF NOT EXISTS melhor_envio_shipment_id text,
    ADD COLUMN IF NOT EXISTS shipping_status text,
    ADD COLUMN IF NOT EXISTS posted_at timestamptz;

-- ═══ Order events (timeline) ═══
CREATE TABLE IF NOT EXISTS order_events (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    event       text NOT NULL,
    description text,
    metadata    jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id);
CREATE INDEX IF NOT EXISTS idx_order_events_created ON order_events(created_at);

-- ═══ Webhook events (idempotent processing) ═══
CREATE TABLE IF NOT EXISTS webhook_events (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider   text NOT NULL,
    event_id   text NOT NULL,
    event_type text,
    payload    jsonb,
    processed  boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_provider ON webhook_events(provider);
