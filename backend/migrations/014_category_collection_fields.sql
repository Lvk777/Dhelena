-- Additive admin content fields. Apply deliberately to existing production
-- schemas before publishing the corresponding category/collection forms.
ALTER TABLE categories
    ADD COLUMN IF NOT EXISTS description text,
    ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';

ALTER TABLE collections
    ADD COLUMN IF NOT EXISTS banner_image text,
    ADD COLUMN IF NOT EXISTS status text DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS featured boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS start_date timestamptz,
    ADD COLUMN IF NOT EXISTS end_date timestamptz;
