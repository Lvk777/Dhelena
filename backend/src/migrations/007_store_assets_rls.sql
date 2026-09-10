-- ─────────────────────────────────────────────────────────────────
-- 007_store_assets_rls.sql
-- RLS policies for the store-assets Supabase Storage bucket.
-- (copy kept in /src/migrations for the src-level migration runner)
-- ─────────────────────────────────────────────────────────────────

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
        INSERT INTO storage.buckets (id, name, public)
        VALUES ('store-assets', 'store-assets', true)
        ON CONFLICT (id) DO UPDATE SET public = true;

        ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS "store_assets_public_read" ON storage.objects;
        DROP POLICY IF EXISTS "store_assets_admin_insert" ON storage.objects;
        DROP POLICY IF EXISTS "store_assets_admin_update" ON storage.objects;
        DROP POLICY IF EXISTS "store_assets_admin_delete" ON storage.objects;

        CREATE POLICY "store_assets_public_read"
        ON storage.objects FOR SELECT
        USING (bucket_id = 'store-assets');

        CREATE POLICY "store_assets_admin_insert"
        ON storage.objects FOR INSERT TO authenticated
        WITH CHECK (bucket_id = 'store-assets' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

        CREATE POLICY "store_assets_admin_update"
        ON storage.objects FOR UPDATE TO authenticated
        USING (bucket_id = 'store-assets' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

        CREATE POLICY "store_assets_admin_delete"
        ON storage.objects FOR DELETE TO authenticated
        USING (bucket_id = 'store-assets' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

        RAISE NOTICE 'store-assets RLS policies created.';
    ELSE
        RAISE NOTICE 'storage schema not found — skipping RLS';
    END IF;
END $$;
