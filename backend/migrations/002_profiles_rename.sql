-- Local dev migration: rename users → profiles for consistency with Supabase
-- Handles the case where profiles already exists (already migrated) by dropping
-- the empty users table that 001_init.sql may have recreated.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'profiles') THEN
        -- profiles already exists — drop the empty users table 001_init recreated
        EXECUTE 'DROP TABLE IF EXISTS users CASCADE';
    ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
        -- first migration: rename users → profiles
        EXECUTE 'ALTER TABLE users RENAME TO profiles';
    END IF;
END $$;
