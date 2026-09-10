-- D'Helenas — Initial schema migration
-- Works with PostgreSQL 17 (local Docker) and Supabase

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================
-- USERS (local dev; maps to profiles + auth.users in Supabase)
-- =============================================================
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name     TEXT,
    phone         TEXT,
    role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('admin', 'customer')),
    created_at   TIMESTAMPTZ DEFAULT now(),
    updated_at   TIMESTAMPTZ DEFAULT now()
);

-- =============================================================
-- CATALOG
-- =============================================================
CREATE TABLE IF NOT EXISTS categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    slug        TEXT UNIQUE NOT NULL,
    image       TEXT,
    sort_order  INT DEFAULT 0,
    parent_id   UUID REFERENCES categories(id),
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collections (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    slug        TEXT UNIQUE NOT NULL,
    description TEXT,
    image       TEXT,
    sort_order  INT DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name              TEXT NOT NULL,
    sku               TEXT UNIQUE,
    category          TEXT,
    subcategory       TEXT,
    collection        TEXT,
    description       TEXT,
    short_description TEXT,
    details           TEXT,
    price             NUMERIC(10,2) NOT NULL,
    sale_price        NUMERIC(10,2),
    cost_price        NUMERIC(10,2) DEFAULT 0,
    installments      INT DEFAULT 6,
    images            JSONB DEFAULT '[]',
    colors            JSONB DEFAULT '[]',
    sizes             JSONB DEFAULT '["PP","P","M","G","GG"]',
    badges            JSONB DEFAULT '{}',
    composition       TEXT,
    modeling          TEXT,
    length            TEXT,
    lining            TEXT,
    transparency      TEXT,
    elasticity        TEXT,
    care              TEXT,
    measurements      TEXT,
    weight            NUMERIC(8,2) DEFAULT 0,
    package_height    NUMERIC(8,2) DEFAULT 0,
    package_width     NUMERIC(8,2) DEFAULT 0,
    package_length    NUMERIC(8,2) DEFAULT 0,
    status            TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    rating            NUMERIC(2,1) DEFAULT 5,
    sold_count        INT DEFAULT 0,
    created_date      TIMESTAMPTZ DEFAULT now(),
    updated_date      TIMESTAMPTZ DEFAULT now(),
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

-- =============================================================
-- ORDERS
-- =============================================================
CREATE TABLE IF NOT EXISTS orders (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number     TEXT UNIQUE NOT NULL,
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status           TEXT NOT NULL DEFAULT 'recebido'
                     CHECK (status IN ('recebido','pagamento_aprovado','em_separacao',
                                       'enviado','em_transporte','saiu_entrega',
                                       'entregue','cancelado')),
    payment_status   TEXT NOT NULL DEFAULT 'pending'
                     CHECK (payment_status IN ('pending','approved','rejected','refunded')),
    payment_method   TEXT,
    shipping_method  TEXT,
    shipping_cost    NUMERIC(10,2) DEFAULT 0,
    discount         NUMERIC(10,2) DEFAULT 0,
    coupon_code      TEXT,
    subtotal         NUMERIC(10,2) NOT NULL,
    total            NUMERIC(10,2) NOT NULL,
    snapshot         JSONB NOT NULL,
    shipping_address JSONB,
    tracking_code    TEXT,
    notes            TEXT,
    idempotency_key  TEXT,
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id    UUID REFERENCES products(id),
    product_name  TEXT NOT NULL,
    product_sku   TEXT,
    product_image TEXT,
    color_id      TEXT,
    color_name    TEXT,
    size          TEXT,
    quantity      INT NOT NULL CHECK (quantity > 0),
    unit_price    NUMERIC(10,2) NOT NULL,
    subtotal      NUMERIC(10,2) NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- =============================================================
-- STOCK MOVEMENTS
-- =============================================================
CREATE TABLE IF NOT EXISTS stock_movements (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    order_id       UUID REFERENCES orders(id),
    type           TEXT NOT NULL CHECK (type IN ('sale','cancel','adjust','return')),
    quantity       INT NOT NULL,
    color_id       TEXT,
    size           TEXT,
    previous_stock INT NOT NULL,
    new_stock      INT NOT NULL,
    reason         TEXT,
    admin_id       UUID REFERENCES users(id),
    created_at     TIMESTAMPTZ DEFAULT now()
);

-- =============================================================
-- COUPONS
-- =============================================================
CREATE TABLE IF NOT EXISTS coupons (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                  TEXT UNIQUE NOT NULL,
    description           TEXT,
    discount_type         TEXT NOT NULL CHECK (discount_type IN ('percentage','fixed')),
    discount_value        NUMERIC(10,2) NOT NULL,
    min_order_value       NUMERIC(10,2) DEFAULT 0,
    max_uses              INT,
    max_uses_per_customer INT DEFAULT 1,
    first_purchase_only   BOOLEAN DEFAULT FALSE,
    active                BOOLEAN DEFAULT TRUE,
    valid_from            TIMESTAMPTZ,
    valid_until           TIMESTAMPTZ,
    created_at            TIMESTAMPTZ DEFAULT now(),
    updated_at            TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coupon_usages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coupon_id   UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    order_id    UUID NOT NULL REFERENCES orders(id),
    user_id     UUID NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (coupon_id, order_id)
);

-- =============================================================
-- CONTENT
-- =============================================================
CREATE TABLE IF NOT EXISTS banners (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title                 TEXT,
    subtitle              TEXT,
    text                  TEXT,
    eyebrow               TEXT,
    image                 TEXT,
    link                  TEXT,
    primary_cta_label     TEXT,
    primary_cta_link     TEXT,
    secondary_cta_label   TEXT,
    secondary_cta_link    TEXT,
    position              TEXT,
    sort_order            INT DEFAULT 0,
    active                BOOLEAN DEFAULT TRUE,
    created_at            TIMESTAMPTZ DEFAULT now(),
    updated_at            TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key         TEXT UNIQUE NOT NULL,
    value       JSONB NOT NULL,
    is_public   BOOLEAN DEFAULT FALSE,
    updated_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- =============================================================
-- FAVORITES & ADDRESSES
-- =============================================================
CREATE TABLE IF NOT EXISTS favorites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS addresses (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label       TEXT,
    recipient   TEXT,
    zip_code    TEXT,
    street      TEXT,
    number      TEXT,
    complement  TEXT,
    district    TEXT,
    city        TEXT,
    state       TEXT,
    is_default  BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- =============================================================
-- AUDIT & NOTIFICATIONS
-- =============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id    UUID REFERENCES users(id),
    action      TEXT NOT NULL,
    entity_type TEXT,
    entity_id   TEXT,
    changes     JSONB,
    ip_address  TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_logs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id            UUID REFERENCES orders(id),
    event               TEXT NOT NULL,
    channel             TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp')),
    recipient           TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','sent','failed','retrying')),
    attempts            INT DEFAULT 0,
    provider_message_id TEXT,
    error               TEXT,
    sent_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT now(),
    UNIQUE (order_id, event, channel, recipient)
);

-- =============================================================
-- INDEXES
-- =============================================================
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_collection ON products(collection);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses(user_id);
CREATE INDEX IF NOT EXISTS idx_stock_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_audit_admin ON audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_notif_order ON notification_logs(order_id);
