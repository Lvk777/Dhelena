-- PENDING APPROVAL: ownership attested independently; Auth login and one session
-- observed on 2026-10-22 at 20:29:38 UTC. Recheck at execution time.
-- Execute only after the backend resolver that prioritizes explicit links is deployed,
-- security phases 1/2, migration 016 and separate production authorization.
-- Concrete operation for Juliane. Never run against production before separate written approval.
-- Run only after security phases 1/2, migration 016, a recent authenticated
-- session, and independent proof that the Auth account belongs to Juliane and
-- that she is authorized to use the existing administrative profile.
-- These two UUIDs were read independently from Auth and the legacy profile.
-- Recheck both in production immediately before execution; never infer from email.
-- Do not paste credentials, access tokens, emails, or customer data here.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

DO $verified_link$
DECLARE
    verified_auth_id uuid := '37c39827-a18c-4dd7-9309-85cb06cb59a8';
    legacy_profile_id uuid := '3432984f-e65e-40ab-a286-2f04ceccaded';
    auth_email text;
    profile_email text;
    shadow_role text;
    shadow_email text;
BEGIN
    IF current_user <> 'postgres' THEN
        RAISE EXCEPTION 'Unexpected executor';
    END IF;
    IF verified_auth_id = '00000000-0000-0000-0000-000000000000'::uuid
       OR legacy_profile_id = '00000000-0000-0000-0000-000000000000'::uuid
       OR verified_auth_id = legacy_profile_id THEN
        RAISE EXCEPTION 'Verified distinct UUIDs required';
    END IF;
    IF to_regclass('public.profile_auth_links') IS NULL THEN
        RAISE EXCEPTION 'Migration 016 is required';
    END IF;
    IF NOT (SELECT c.relrowsecurity FROM pg_class c
              WHERE c.oid = 'public.profile_auth_links'::regclass)
       OR has_table_privilege('anon', 'public.profile_auth_links', 'SELECT')
       OR has_table_privilege('authenticated', 'public.profile_auth_links', 'SELECT')
       OR has_table_privilege('service_role', 'public.profile_auth_links', 'SELECT') THEN
        RAISE EXCEPTION 'Identity link table is not private';
    END IF;
    SELECT lower(u.email) INTO STRICT auth_email
      FROM auth.users u
     WHERE u.id = verified_auth_id AND u.email_confirmed_at IS NOT NULL
       AND u.last_sign_in_at > now() - interval '7 days'
       AND EXISTS (SELECT 1 FROM auth.sessions s WHERE s.user_id = u.id);
    SELECT lower(p.email) INTO STRICT profile_email
      FROM public.profiles p
     WHERE p.id = legacy_profile_id AND p.role = 'admin';
    -- Personal and legacy administrative addresses may differ. Neither
    -- address authorizes this link; both identities must be verified outside SQL.
    IF auth_email IS NULL OR profile_email IS NULL THEN
        RAISE EXCEPTION 'Expected identity records are incomplete';
    END IF;
    -- Login created a customer profile with the Auth UUID. Preserve it and its
    -- email. The deployed backend must resolve this explicit link first.
    SELECT p.role, lower(p.email) INTO STRICT shadow_role, shadow_email
      FROM public.profiles p WHERE p.id = verified_auth_id FOR UPDATE;
    IF shadow_role <> 'customer' OR shadow_email <> auth_email
       OR EXISTS (SELECT 1 FROM public.profiles
                   WHERE lower(email) = auth_email
                     AND id NOT IN (verified_auth_id, legacy_profile_id))
       OR EXISTS (SELECT 1 FROM public.profile_auth_links
                   WHERE auth_user_id = verified_auth_id OR profile_id = legacy_profile_id) THEN
        RAISE EXCEPTION 'Unexpected customer profile, email conflict or identity link';
    END IF;
    -- No records can be stranded by preferring the legacy admin profile.
    IF EXISTS (SELECT 1 FROM public.active_sessions WHERE user_id = verified_auth_id)
       OR EXISTS (SELECT 1 FROM public.addresses WHERE user_id = verified_auth_id)
       OR EXISTS (SELECT 1 FROM public.analytics_events WHERE user_id = verified_auth_id)
       OR EXISTS (SELECT 1 FROM public.audit_logs WHERE admin_id = verified_auth_id)
       OR EXISTS (SELECT 1 FROM public.coupon_usages WHERE user_id = verified_auth_id)
       OR EXISTS (SELECT 1 FROM public.favorites WHERE user_id = verified_auth_id)
       OR EXISTS (SELECT 1 FROM public.login_history WHERE user_id = verified_auth_id)
       OR EXISTS (SELECT 1 FROM public.orders WHERE user_id = verified_auth_id)
       OR EXISTS (SELECT 1 FROM public.settings WHERE updated_by = verified_auth_id)
       OR EXISTS (SELECT 1 FROM public.stock_movements WHERE admin_id = verified_auth_id) THEN
        RAISE EXCEPTION 'Customer profile now has history; review before linking';
    END IF;

    INSERT INTO public.profile_auth_links (auth_user_id, profile_id)
    VALUES (verified_auth_id, legacy_profile_id);
    IF (SELECT count(*) FROM public.profile_auth_links
         WHERE auth_user_id = verified_auth_id AND profile_id = legacy_profile_id) <> 1 THEN
        RAISE EXCEPTION 'Link postcondition failed';
    END IF;
END
$verified_link$;

COMMIT;

-- Reversal after a committed link is a separately authorized, guarded DELETE
-- of this exact pair only, after re-reading current state. The customer and
-- legacy profiles keep their UUIDs, emails, roles and all historical rows.
