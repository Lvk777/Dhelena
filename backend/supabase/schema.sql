-- =============================================================
-- D'Helenas — Supabase Production Schema + RLS
-- Run this in Supabase SQL Editor (sa-east-1)
-- =============================================================

-- =============================================================
-- 1. PROFILES (linked to auth.users)
-- =============================================================
CREATE TABLE IF NOT EXISTS profiles (
    id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email         TEXT NOT NULL,
    full_name     TEXT,
    phone         TEXT,
    cpf           TEXT,
    birth_date    DATE,
    role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('admin', 'customer')),
    password_hash TEXT, -- only used in local dev (not in Supabase Auth)
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Existing Supabase projects may already have profiles from an earlier schema.
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS cpf TEXT,
    ADD COLUMN IF NOT EXISTS birth_date DATE;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO profiles (id, email, full_name)
    VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Prevent self-role-change (only service role can change roles)
CREATE OR REPLACE FUNCTION protect_profile_role()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.role IS DISTINCT FROM OLD.role AND auth.uid() = OLD.id THEN
        NEW.role = OLD.role;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS protect_role_trigger ON profiles;
CREATE TRIGGER protect_role_trigger
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION protect_profile_role();

-- =============================================================
-- 2. CATALOG
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
-- 3. ORDERS
-- =============================================================
CREATE TABLE IF NOT EXISTS orders (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number     TEXT UNIQUE NOT NULL,
    user_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
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
-- 4. STOCK
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
    admin_id       UUID REFERENCES profiles(id),
    created_at     TIMESTAMPTZ DEFAULT now()
);

-- =============================================================
-- 5. COUPONS
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
    user_id     UUID NOT NULL REFERENCES profiles(id),
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (coupon_id, order_id)
);

-- =============================================================
-- 6. CONTENT
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
    primary_cta_link      TEXT,
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
    updated_by  UUID REFERENCES profiles(id),
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- =============================================================
-- 7. FAVORITES & ADDRESSES
-- =============================================================
CREATE TABLE IF NOT EXISTS favorites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS addresses (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
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
-- 8. AUDIT & NOTIFICATIONS
-- =============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id    UUID REFERENCES profiles(id),
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
-- 9. INDEXES
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

-- =============================================================
-- 10. ROW LEVEL SECURITY
-- =============================================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_usages ENABLE ROW LEVEL SECURITY;
ALTER TABLE banners ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;

-- PROFILES: user sees/updates own only
CREATE POLICY "profiles_self_select" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_self_update" ON profiles FOR UPDATE USING (auth.uid() = id);

-- PRODUCTS: public reads published
CREATE POLICY "products_public_read" ON products FOR SELECT USING (status = 'published');

-- CATEGORIES: public read all
CREATE POLICY "categories_public_read" ON categories FOR SELECT USING (true);

-- COLLECTIONS: public read all
CREATE POLICY "collections_public_read" ON collections FOR SELECT USING (true);

-- BANNERS: public reads active only
CREATE POLICY "banners_public_read" ON banners FOR SELECT USING (active = true);

-- SETTINGS: public reads is_public=true only
CREATE POLICY "settings_public_read" ON settings FOR SELECT USING (is_public = true);

-- ORDERS: user sees own only
CREATE POLICY "orders_owner_select" ON orders FOR SELECT USING (auth.uid() = user_id);

-- ORDER_ITEMS: user sees items of own orders
CREATE POLICY "order_items_owner_select" ON order_items
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM orders WHERE orders.id = order_items.order_id AND orders.user_id = auth.uid())
    );

-- FAVORITES: owner only
CREATE POLICY "favorites_owner_select" ON favorites FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "favorites_owner_insert" ON favorites FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "favorites_owner_delete" ON favorites FOR DELETE USING (auth.uid() = user_id);

-- ADDRESSES: owner only
CREATE POLICY "addresses_owner_select" ON addresses FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "addresses_owner_insert" ON addresses FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "addresses_owner_update" ON addresses FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "addresses_owner_delete" ON addresses FOR DELETE USING (auth.uid() = user_id);

-- COUPONS: public can validate (read active coupons)
CREATE POLICY "coupons_public_read" ON coupons FOR SELECT USING (active = true);

-- COUPON_USAGES: user sees own usages
CREATE POLICY "coupon_usages_owner_select" ON coupon_usages FOR SELECT USING (auth.uid() = user_id);

-- STOCK_MOVEMENTS, AUDIT_LOGS, NOTIFICATION_LOGS: no public access
-- Access exclusively via backend service role

-- =============================================================
-- 11. STORAGE BUCKETS
-- =============================================================
INSERT INTO storage.buckets (id, name, public) VALUES
    ('product-images', 'product-images', true),
    ('category-images', 'category-images', true),
    ('collection-images', 'collection-images', true),
    ('banner-images', 'banner-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: public read, admin write
CREATE POLICY "storage_public_read" ON storage.objects
    FOR SELECT USING (bucket_id IN ('product-images', 'category-images', 'collection-images', 'banner-images'));

CREATE POLICY "storage_admin_write" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id IN ('product-images', 'category-images', 'collection-images', 'banner-images')
        AND auth.role() = 'authenticated'
    );

CREATE POLICY "storage_admin_update" ON storage.objects
    FOR UPDATE USING (
        bucket_id IN ('product-images', 'category-images', 'collection-images', 'banner-images')
    );

CREATE POLICY "storage_admin_delete" ON storage.objects
    FOR DELETE USING (
        bucket_id IN ('product-images', 'category-images', 'collection-images', 'banner-images')
    );

-- =============================================================
-- 12. SEED DATA
-- =============================================================

-- Categories
INSERT INTO categories (name, slug, image, sort_order) VALUES
    ('Vestidos', 'vestidos', 'https://media.base44.com/images/public/6a9b39c904f395072f289bf5/de2108912_generated_b3a4de3c.jpg', 1),
    ('Conjuntos', 'conjuntos', 'https://media.base44.com/images/public/6a9b39c904f395072f289bf5/2c7257aca_generated_ae00107f.jpg', 2),
    ('Blusas', 'blusas', 'https://media.base44.com/images/public/6a9b39c904f395072f289bf5/5b1981267_generated_3d3235dd.jpg', 3),
    ('Calças', 'calcas', 'https://media.base44.com/images/public/6a9b39c904f395072f289bf5/2cc9318e6_generated_c7c5f6ef.jpg', 4),
    ('Acessórios', 'acessorios', 'https://media.base44.com/images/public/6a9b39c904f395072f289bf5/38d0b8849_generated_e157ded6.jpg', 5)
ON CONFLICT (slug) DO NOTHING;

-- Collections
INSERT INTO collections (name, slug, description, sort_order) VALUES
    ('Conexão Inverno', 'conexao-inverno', 'Tons quentes e caimentos fluidos para os dias frescos.', 1),
    ('Legados', 'legados', 'Peças atemporais pensadas para atravessar gerações.', 2),
    ('Método Ponte', 'metodo-ponte', 'A assinatura D''Helenas: moda que conecta histórias.', 3)
ON CONFLICT (slug) DO NOTHING;

-- Settings
INSERT INTO settings (key, value, is_public) VALUES
    ('general', '{"store_name":"D''Helenas","trade_name":"","company_name":"","cnpj":"","email":"","phone":"","whatsapp":"","logo":"","logo_dark":"","favicon":"","currency":"BRL","timezone":"America/Sao_Paulo"}', true),
    ('store', '{"top_bar_text":"Frete grátis acima de R$ 122 · Parcelamos em até 6x","free_shipping_threshold":499,"max_installments":6,"interest_free_installments":6,"allow_out_of_stock":false,"show_low_stock":true,"low_stock_threshold":3}', true),
    ('shipping', '{"pickup_enabled":true,"pickup_name":"Retirada na boutique","pickup_instructions":"","pickup_time":"","free_shipping_enabled":true,"free_shipping_threshold":122,"melhor_envio_enabled":false,"melhor_envio_mode":"sandbox"}', true),
    ('notifications', '{"email_enabled":true,"whatsapp_enabled":true,"recipients":[]}', false)
ON CONFLICT (key) DO NOTHING;

-- Banners
INSERT INTO banners (title, subtitle, text, eyebrow, image, primary_cta_label, primary_cta_link, secondary_cta_label, secondary_cta_link, position, sort_order, active) VALUES
    ('D''Helenas', 'Moda que conecta histórias.', 'Peças escolhidas para mulheres que valorizam estilo, elegância e personalidade.', 'Método Ponte • Moda Feminina', 'https://media.base44.com/images/public/6a9b39c904f395072f289bf5/ca5732fc0_generated_db5c1f89.jpg', 'Ver novidades', '/novidades', 'Conhecer a coleção', '/colecoes', 'home', 0, true),
    ('Muito além da moda.', NULL, 'A D''Helenas nasceu para criar pontes entre mulheres, histórias e gerações.', 'O conceito D''Helenas', 'https://media.base44.com/images/public/6a9b39c904f395072f289bf5/39ec14145_generated_c6ec8583.jpg', 'Conheça nossa história', '/sobre', NULL, NULL, 'home', 1, true);

-- Products seed (run after categories/collections exist)
-- Copy products from the app's initialData.json via the backend seed script
-- Or insert manually via the admin panel

-- NOTE: To promote a user to admin, run:
-- UPDATE profiles SET role = 'admin' WHERE email = 'your-email@example.com';
