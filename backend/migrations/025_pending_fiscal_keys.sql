-- A key alone is never an authorized or reconciled fiscal document.
CREATE TABLE IF NOT EXISTS pending_fiscal_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL UNIQUE REFERENCES orders(id),
    access_key CHAR(44) NOT NULL UNIQUE,
    entered_by UUID NOT NULL REFERENCES profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE pending_fiscal_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pending_fiscal_keys FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON pending_fiscal_keys FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON pending_fiscal_keys FROM authenticated;
    END IF;
END $$;
