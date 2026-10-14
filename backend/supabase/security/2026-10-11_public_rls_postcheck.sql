-- READ ONLY. Run after each approved phase and keep the output as evidence.
WITH tables AS (
  SELECT c.oid, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('r','p')
), defaults AS (
  SELECT pg_get_userbyid(d.defaclrole) AS owner, d.defaclobjtype,
         a.grantee, a.privilege_type
    FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
   WHERE n.nspname='public' AND d.defaclobjtype IN ('r','S','f')
)
SELECT
  (SELECT count(*) FROM tables) AS public_tables,
  (SELECT count(*) FROM tables WHERE relrowsecurity AND NOT relforcerowsecurity) AS rls_enabled_no_force,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public') AS public_policies,
  (SELECT count(*) FROM tables t CROSS JOIN LATERAL
     aclexplode(coalesce((SELECT relacl FROM pg_class WHERE oid=t.oid),
                         acldefault('r',(SELECT relowner FROM pg_class WHERE oid=t.oid)))) a
    WHERE a.grantee IN ('anon'::regrole,'authenticated'::regrole,0::oid))
    AS direct_or_public_table_grants,
  (SELECT count(*) FROM tables t
    WHERE has_any_column_privilege('anon',t.oid,'SELECT,INSERT,UPDATE,REFERENCES')
       OR has_any_column_privilege('authenticated',t.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
    AS effective_column_access_tables,
  (SELECT count(*) FROM defaults
    WHERE owner='postgres'
      AND grantee IN ('anon'::regrole,'authenticated'::regrole,'service_role'::regrole))
    AS postgres_public_default_grants,
  (SELECT count(*) FROM defaults
    WHERE owner='supabase_admin'
      AND grantee IN ('anon'::regrole,'authenticated'::regrole,'service_role'::regrole))
    AS supabase_admin_public_default_grants,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='S') AS public_sequences;

-- Separately confirm in Supabase Dashboard: Data API disabled, automatic
-- exposure of new public tables/functions disabled, Auth and Storage working.
