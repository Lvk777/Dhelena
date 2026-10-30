-- PREPARED ONLY. Use only after explicit authorization and diagnosis.
-- Reverses phase 2 while keeping phase 1's anon/authenticated revocations.
-- This is not a general rollback and must never restore public grants.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $recover$
DECLARE
  expected text[] := ARRAY[
    'active_sessions','addresses','analytics_events','audit_logs','banners',
    'categories','collections','contact_messages','coupon_usages','coupons',
    'favorites','integration_configs','login_history','look_promotions',
    'notification_logs','order_events','order_items','order_refunds',
    'order_return_items','order_returns','orders','products','profiles',
    'settings','size_guide_rows','size_guides','stock_movements',
    'stock_restorations','webhook_events'
  ];
  actual text[];
  table_name text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Expected postgres, got %', current_user;
  END IF;
  SELECT array_agg(c.relname::text ORDER BY c.relname) INTO actual
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('r','p');
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'public table inventory changed; stop recovery';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
     WHERE n.nspname='public' AND c.relkind IN ('r','p')
       AND a.grantee IN ('anon'::regrole,'authenticated'::regrole,0::oid)
  ) THEN
    RAISE EXCEPTION 'Public table grant detected; disabling RLS would expose data';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN ('r','p')
       AND (has_any_column_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
         OR has_any_column_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
  ) THEN
    RAISE EXCEPTION 'Column privilege detected; disabling RLS would expose data';
  END IF;
  FOR table_name IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY',table_name);
  END LOOP;
END
$recover$;
COMMIT;
