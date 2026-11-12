-- Authorized production application of ONLY the unchanged migration 014.
-- No real backup exists for this operation. A committed DDL change does not
-- provide an independently proven full restore. On any error: ROLLBACK; stop.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.categories, public.collections IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF (SELECT value->>'maintenance_mode' FROM public.settings WHERE key='maintenance') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Maintenance must remain ON';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND ((table_name='categories' AND column_name IN ('description','status'))
      OR (table_name='collections' AND column_name IN ('banner_image','status','featured','start_date','end_date')))) THEN
    RAISE EXCEPTION '014 already or partially applied; stop and inspect';
  END IF;
END $$;
CREATE TEMP TABLE launch_014_before ON COMMIT DROP AS
SELECT 'categories'::text AS name, count(*) AS n,
  md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) AS digest FROM public.categories t
UNION ALL
SELECT 'collections', count(*), md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.collections t;

-- BEGIN ORIGINAL backend/migrations/014_category_collection_fields.sql
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
-- END ORIGINAL

DO $$
DECLARE expected_n bigint; expected_digest text; actual_n bigint; actual_digest text;
BEGIN
  SELECT n,digest INTO expected_n,expected_digest FROM launch_014_before WHERE name='categories';
  SELECT count(*),md5(coalesce(jsonb_agg(to_jsonb(t)-'description'-'status' ORDER BY id)::text,'[]'))
    INTO actual_n,actual_digest FROM public.categories t;
  IF actual_n<>expected_n OR actual_digest<>expected_digest THEN RAISE EXCEPTION 'Category records changed'; END IF;
  SELECT n,digest INTO expected_n,expected_digest FROM launch_014_before WHERE name='collections';
  SELECT count(*),md5(coalesce(jsonb_agg(to_jsonb(t)-'banner_image'-'status'-'featured'-'start_date'-'end_date' ORDER BY id)::text,'[]'))
    INTO actual_n,actual_digest FROM public.collections t;
  IF actual_n<>expected_n OR actual_digest<>expected_digest THEN RAISE EXCEPTION 'Collection records changed'; END IF;
  IF EXISTS(SELECT 1 FROM public.categories WHERE status IS DISTINCT FROM 'active' OR description IS NOT NULL)
    OR EXISTS(SELECT 1 FROM public.collections WHERE status IS DISTINCT FROM 'active' OR featured IS DISTINCT FROM false
      OR banner_image IS NOT NULL OR start_date IS NOT NULL OR end_date IS NOT NULL) THEN
    RAISE EXCEPTION 'Unexpected 014 defaults';
  END IF;
END $$;
COMMIT;
SELECT table_name,column_name,data_type,column_default FROM information_schema.columns
WHERE table_schema='public' AND ((table_name='categories' AND column_name IN ('description','status'))
 OR (table_name='collections' AND column_name IN ('banner_image','status','featured','start_date','end_date')))
ORDER BY table_name,column_name;
