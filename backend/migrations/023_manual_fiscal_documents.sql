-- Extends the private fiscal inbox without changing existing XML documents.
ALTER TABLE fiscal_documents
    ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'xml';

ALTER TABLE fiscal_documents ALTER COLUMN xml_bytes DROP NOT NULL;
ALTER TABLE fiscal_documents ALTER COLUMN xml_sha256 DROP NOT NULL;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_documents_origin_check'
        AND conrelid = 'fiscal_documents'::regclass) THEN
        ALTER TABLE fiscal_documents ADD CONSTRAINT fiscal_documents_origin_check
            CHECK (origin IN ('xml', 'manual'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_documents_payload_check'
        AND conrelid = 'fiscal_documents'::regclass) THEN
        ALTER TABLE fiscal_documents ADD CONSTRAINT fiscal_documents_payload_check
            CHECK ((origin = 'xml' AND xml_bytes IS NOT NULL AND xml_sha256 IS NOT NULL)
                OR (origin = 'manual' AND xml_bytes IS NULL AND xml_sha256 IS NULL));
    END IF;
END $$;

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
