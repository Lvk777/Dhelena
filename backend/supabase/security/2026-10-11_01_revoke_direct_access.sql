-- PREPARED ONLY. Do not execute in production without explicit authorization.
-- Apply only after an independently restored backup and isolated rehearsal.
-- This is separate from migration 014 and from backend/supabase/schema.sql.
-- The two transactions are deliberate: phase 1 contains direct access even if
-- phase 2 is interrupted. Never restore anon/authenticated grants as rollback.

-- PHASE 1: revoke direct Data API table access and postgres defaults.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
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
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Expected postgres, got %', current_user;
  END IF;
  SELECT array_agg(c.relname::text ORDER BY c.relname)
    INTO actual
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r','p');
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'public table inventory changed; review snapshot and migration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
       AND (pg_get_userbyid(c.relowner) <> 'postgres'
            OR c.relrowsecurity OR c.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'owner or RLS state changed; re-review required';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public') THEN
    RAISE EXCEPTION 'public policies changed; re-review required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN ('r','p')
       AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'column-level ACL appeared; re-review required';
  END IF;
END
$guard$;

-- Current tables: all eight table privileges (including MAINTAIN where present).
REVOKE ALL PRIVILEGES ON TABLE
  public.active_sessions, public.addresses, public.analytics_events,
  public.audit_logs, public.banners, public.categories, public.collections,
  public.contact_messages, public.coupon_usages, public.coupons,
  public.favorites, public.integration_configs, public.login_history,
  public.look_promotions, public.notification_logs, public.order_events,
  public.order_items, public.order_refunds, public.order_return_items,
  public.order_returns, public.orders, public.products, public.profiles,
  public.settings, public.size_guide_rows, public.size_guides,
  public.stock_movements, public.stock_restorations, public.webhook_events
FROM anon, authenticated;

-- Future objects created by postgres. Existing service_role table grants stay.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, service_role;

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r',c.relowner))) a
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
       AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole, 0::oid)
  ) THEN
    RAISE EXCEPTION 'anon/authenticated/PUBLIC table grant remains';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN ('r','p')
       AND (has_any_column_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
         OR has_any_column_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
  ) THEN
    RAISE EXCEPTION 'effective column privilege remains';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_default_acl d
      JOIN pg_namespace n ON n.oid = d.defaclnamespace
      CROSS JOIN LATERAL aclexplode(d.defaclacl) a
     WHERE n.nspname = 'public' AND d.defaclrole = 'postgres'::regrole
       AND d.defaclobjtype IN ('r','S','f')
       AND a.grantee IN ('anon'::regrole,'authenticated'::regrole,'service_role'::regrole)
  ) THEN
    RAISE EXCEPTION 'postgres public default grant remains';
  END IF;
END
$verify$;
COMMIT;
