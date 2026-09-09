-- Local dev migration: rename users → profiles for consistency with Supabase
ALTER TABLE IF EXISTS users RENAME TO profiles;
