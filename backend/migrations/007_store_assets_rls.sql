-- ─────────────────────────────────────────────────────────────────
-- 007_store_assets_rls.sql
-- RLS policies for the store-assets Supabase Storage bucket.
--
-- READ:   Public (anyone can read public store assets)
-- WRITE:  Only authenticated admins (service role bypasses RLS on backend)
-- Common users: CANNOT INSERT/UPDATE/DELETE directly
--
-- This migration is safe to run on non-Supabase PostgreSQL — it checks
-- for the storage schema first and no-ops if not present.
-- ─────────────────────────────────────────────────────────────────

DO $$
BEGIN
    -- Only run if Supabase storage schema exists
    IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN

        -- 1. Ensure the bucket exists and is public
        INSERT INTO storage.buckets (id, name, public)
        VALUES ('store-assets', 'store-assets', true)
        ON CONFLICT (id) DO UPDATE SET public = true;

        -- 2. Enable RLS
        ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

        -- 3. Drop existing policies (idempotent)
        DROP POLICY IF EXISTS "store_assets_public_read" ON storage.objects;
        DROP POLICY IF EXISTS "store_assets_admin_insert" ON storage.objects;
        DROP POLICY IF EXISTS "store_assets_admin_update" ON storage.objects;
        DROP POLICY IF EXISTS "store_assets_admin_delete" ON storage.objects;

        -- 4. READ — public read for store-assets
        CREATE POLICY "store_assets_public_read"
        ON storage.objects
        FOR SELECT
        USING (bucket_id = 'store-assets');

        -- 5. WRITE — admin-only insert/update/delete
        CREATE POLICY "store_assets_admin_insert"
        ON storage.objects
        FOR INSERT
        TO authenticated
        WITH CHECK (
            bucket_id = 'store-assets'
            AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
        );

        CREATE POLICY "store_assets_admin_update"
        ON storage.objects
        FOR UPDATE
        TO authenticated
        USING (
            bucket_id = 'store-assets'
            AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
        );

        CREATE POLICY "store_assets_admin_delete"
        ON storage.objects
        FOR DELETE
        TO authenticated
        USING (
            bucket_id = 'store-assets'
            AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
        );

        RAISE NOTICE 'store-assets RLS policies created.';
    ELSE
        RAISE NOTICE 'storage schema not found — skipping RLS (non-Supabase environment)';
    END IF;
END $$;
