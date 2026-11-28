-- Keep legacy sales references while separating historical inventory from the new catalog.
ALTER TABLE products ADD COLUMN IF NOT EXISTS historical_only BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_historical_only_unpublished_check') THEN
        ALTER TABLE products ADD CONSTRAINT products_historical_only_unpublished_check
            CHECK (NOT historical_only OR status <> 'published');
    END IF;
END $$;
