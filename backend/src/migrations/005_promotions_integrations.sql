-- 005_promotions_integrations.sql
-- Extended promotions + integration configs

-- ═══ Extend look_promotions with campaign fields ═══
ALTER TABLE look_promotions
    ADD COLUMN IF NOT EXISTS title text,
    ADD COLUMN IF NOT EXISTS subtitle text,
    ADD COLUMN IF NOT EXISTS promo_type text DEFAULT 'look_discount',
    ADD COLUMN IF NOT EXISTS free_shipping boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS buy_quantity integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS min_value numeric DEFAULT 0,
    ADD COLUMN IF NOT EXISTS applicable_category text,
    ADD COLUMN IF NOT EXISTS applicable_collection text,
    ADD COLUMN IF NOT EXISTS priority integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS campaign_color text DEFAULT '#A5925A',
    ADD COLUMN IF NOT EXISTS banner_image text,
    ADD COLUMN IF NOT EXISTS short_text text;

-- ═══ Integration configs table ═══
CREATE TABLE IF NOT EXISTS integration_configs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service_key text UNIQUE NOT NULL,
    service_name text NOT NULL,
    description text,
    config_data jsonb NOT NULL DEFAULT '{}',
    is_active boolean DEFAULT false,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
