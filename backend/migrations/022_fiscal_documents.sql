-- Private fiscal document inbox. XML bytes never enter public Storage or order snapshots.
CREATE TABLE IF NOT EXISTS fiscal_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id),
    access_key CHAR(44) NOT NULL UNIQUE,
    xml_bytes BYTEA NOT NULL,
    xml_sha256 CHAR(64) NOT NULL UNIQUE,
    parsed_data JSONB NOT NULL,
    differences JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL CHECK (status IN ('pending_official', 'needs_review', 'verified')),
    official_source TEXT,
    official_checked_at TIMESTAMPTZ,
    imported_by UUID NOT NULL REFERENCES profiles(id),
    verified_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (order_id)
);
CREATE INDEX IF NOT EXISTS fiscal_documents_order_idx ON fiscal_documents(order_id);
ALTER TABLE fiscal_documents ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON fiscal_documents FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON fiscal_documents FROM authenticated;
    END IF;
END $$;
REVOKE ALL ON fiscal_documents FROM PUBLIC;
