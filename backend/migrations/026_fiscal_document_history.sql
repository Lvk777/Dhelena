-- Keep every fiscal document and XML in the private table. Only the active link is unique per order.
ALTER TABLE fiscal_documents
    ADD COLUMN IF NOT EXISTS unlinked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS unlinked_by UUID REFERENCES profiles(id),
    ADD COLUMN IF NOT EXISTS unlink_reason TEXT,
    ADD COLUMN IF NOT EXISTS unlink_official_source TEXT,
    ADD COLUMN IF NOT EXISTS prior_official_status TEXT;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_documents_unlink_review_check'
        AND conrelid = 'fiscal_documents'::regclass) THEN
        ALTER TABLE fiscal_documents ADD CONSTRAINT fiscal_documents_unlink_review_check CHECK (
            (unlinked_at IS NULL AND unlinked_by IS NULL AND unlink_reason IS NULL
                AND unlink_official_source IS NULL AND prior_official_status IS NULL)
            OR (unlinked_at IS NOT NULL AND unlinked_by IS NOT NULL AND unlink_reason IS NOT NULL
                AND unlink_official_source IS NOT NULL AND prior_official_status IS NOT NULL
                AND length(btrim(unlink_reason)) BETWEEN 10 AND 1000
                AND unlink_official_source IN ('national', 'svrs')
                AND prior_official_status IN ('authorized', 'cancelled')));
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS fiscal_documents_one_active_order_idx
    ON fiscal_documents(order_id) WHERE unlinked_at IS NULL;
ALTER TABLE fiscal_documents DROP CONSTRAINT IF EXISTS fiscal_documents_order_id_key;
CREATE INDEX IF NOT EXISTS fiscal_documents_history_order_idx
    ON fiscal_documents(order_id, unlinked_at DESC) WHERE unlinked_at IS NOT NULL;

ALTER TABLE fiscal_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fiscal_documents FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON fiscal_documents FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON fiscal_documents FROM authenticated;
    END IF;
END $$;
