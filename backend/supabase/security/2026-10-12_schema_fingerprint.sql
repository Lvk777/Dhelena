-- Read-only metadata fingerprint. No customer rows, credentials or object names
-- from Storage. Compare with a snapshot-generated fixture on PostgreSQL 17.
WITH cols AS (
  -- Snapshot does not preserve physical attnum gaps from dropped columns.
  SELECT c.relname AS t, a.attname AS n,
    format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS required,
    pg_get_expr(d.adbin,d.adrelid) AS def
  FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
  WHERE ns.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
), cons AS (
  SELECT c.relname AS t, con.conname AS n, con.contype AS type,
    pg_get_constraintdef(con.oid) AS def
  FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
    JOIN pg_namespace ns ON ns.oid=c.relnamespace
  WHERE ns.nspname='public' AND c.relkind IN ('r','p')
)
SELECT current_setting('server_version') AS server_version,
  (SELECT count(*) FROM pg_tables WHERE schemaname='public') AS tables,
  (SELECT count(*) FROM cols) AS columns,
  (SELECT md5(jsonb_agg(to_jsonb(cols) ORDER BY t,n)::text) FROM cols) AS columns_md5,
  (SELECT count(*) FROM cons) AS constraints,
  (SELECT md5(jsonb_agg(to_jsonb(cons) ORDER BY t,n)::text) FROM cons) AS constraints_md5,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relrowsecurity) AS rls_tables,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public') AS policies,
  (SELECT count(*) FROM pg_indexes WHERE schemaname='public'
    AND indexname IN ('idx_stock_restoration_cancellation','idx_stock_restoration_return')
    AND indexdef LIKE 'CREATE UNIQUE INDEX%WHERE%') AS restoration_unique_indexes,
  (SELECT jsonb_agg(jsonb_build_object('name',indexname,'definition',indexdef) ORDER BY indexname)
    FROM pg_indexes WHERE schemaname='public' AND tablename='stock_restorations') AS restoration_indexes,
  pg_has_role(current_user,'supabase_admin','MEMBER') AS can_manage_platform_defaults,
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE NOT t.tgisinternal AND (n.nspname='public' OR (n.nspname='auth' AND c.relname='users'))) AS relevant_triggers,
  (SELECT value->>'maintenance_mode' FROM public.settings WHERE key='maintenance') AS maintenance_on;
