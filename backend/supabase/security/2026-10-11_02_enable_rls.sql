-- PREPARED ONLY. Requires completed phase 1 and explicit authorization.
-- PHASE 2: RLS defense in depth. Owner postgres and BYPASSRLS roles retain
-- their existing access; FORCE ROW LEVEL SECURITY is intentionally omitted.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $enable$
DECLARE
  table_name text;
BEGIN
  -- Repeat the exact inventory guard before altering any table.
  IF (SELECT array_agg(c.relname::text ORDER BY c.relname)
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r','p')) IS DISTINCT FROM
     ARRAY[
       'active_sessions','addresses','analytics_events','audit_logs','banners',
       'categories','collections','contact_messages','coupon_usages','coupons',
       'favorites','integration_configs','login_history','look_promotions',
       'notification_logs','order_events','order_items','order_refunds',
       'order_return_items','order_returns','orders','products','profiles',
       'settings','size_guide_rows','size_guides','stock_movements',
       'stock_restorations','webhook_events'
     ]::text[] THEN
    RAISE EXCEPTION 'public table inventory changed before RLS phase';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN ('r','p')
       AND (pg_get_userbyid(c.relowner)<>'postgres'
         OR c.relrowsecurity OR c.relforcerowsecurity)
  ) OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public') THEN
    RAISE EXCEPTION 'owner, RLS, or policies changed before RLS phase';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
     WHERE n.nspname='public' AND c.relkind IN ('r','p')
       AND a.grantee IN ('anon'::regrole,'authenticated'::regrole,0::oid)
  ) OR EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN ('r','p')
       AND (has_any_column_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
         OR has_any_column_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
  ) THEN
    RAISE EXCEPTION 'phase 1 access revocation is incomplete';
  END IF;
  FOR table_name IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
  END LOOP;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind IN ('r','p')
         AND c.relrowsecurity AND NOT c.relforcerowsecurity) <> 29 THEN
    RAISE EXCEPTION 'RLS postcondition failed';
  END IF;
END
$enable$;
COMMIT;
