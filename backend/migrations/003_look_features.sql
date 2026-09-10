-- 003: Size guides, look promotions, product size guide link

-- ─── Size Guides ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS size_guides (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'Feminino padrão',
    sort_order  INT DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS size_guide_rows (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guide_id    UUID NOT NULL REFERENCES size_guides(id) ON DELETE CASCADE,
    size        TEXT NOT NULL,
    bust        TEXT,
    waist       TEXT,
    hip         TEXT,
    low_waist   TEXT,
    length      TEXT,
    sort_order  INT DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Default guide (only if no guides exist yet)
DO $$
DECLARE g_id UUID;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM size_guides LIMIT 1) THEN
        INSERT INTO size_guides (name, type, sort_order) VALUES ('Feminino Padrão', 'Feminino padrão', 0)
        RETURNING id INTO g_id;
        INSERT INTO size_guide_rows (guide_id, size, bust, waist, hip, sort_order) VALUES
            (g_id, 'PP', '78-82', '58-62', '86-90', 0),
            (g_id, 'P',  '82-86', '62-66', '90-94', 1),
            (g_id, 'M',  '86-90', '66-70', '94-98', 2),
            (g_id, 'G',  '90-94', '70-74', '98-102', 3),
            (g_id, 'GG', '94-98', '74-78', '102-106', 4);
    END IF;
END $$;

-- ─── Product → size guide link ─────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS size_guide_id UUID REFERENCES size_guides(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS custom_measurements JSONB;

-- ─── Look promotions ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS look_promotions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                  TEXT NOT NULL,
    type                  TEXT NOT NULL DEFAULT 'look_discount',
    min_items             INT DEFAULT 3,
    discount_percent      NUMERIC(5,2) DEFAULT 0,
    discount_fixed        NUMERIC(10,2) DEFAULT 0,
    required_categories   JSONB DEFAULT '[]',
    eligible_products     JSONB DEFAULT '[]',
    eligible_collections  JSONB DEFAULT '[]',
    valid_from            TIMESTAMPTZ,
    valid_until           TIMESTAMPTZ,
    active                BOOLEAN DEFAULT FALSE,
    stacks_with_coupon    BOOLEAN DEFAULT FALSE,
    created_at            TIMESTAMPTZ DEFAULT now(),
    updated_at            TIMESTAMPTZ DEFAULT now()
);

-- Default look promotion (inactive, only if none exist)
INSERT INTO look_promotions (name, min_items, discount_percent, active, stacks_with_coupon)
SELECT 'Look Completo', 3, 10, false, false
WHERE NOT EXISTS (SELECT 1 FROM look_promotions LIMIT 1);

-- ─── Settings: notifications ───────────────────────────────
INSERT INTO settings (key, value, is_public) VALUES
    ('look_promotion', '{"enabled":false,"min_items":3,"discount_percent":10,"discount_fixed":0}', false)
ON CONFLICT (key) DO NOTHING;
