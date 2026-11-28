// Effective-permission test against the synthetic, isolated local database.
// Refuses every non-local host or unexpected database name.
import assert from 'node:assert/strict';
import pg from 'pg';

const dbUrl = new URL(process.env.DATABASE_URL || '');
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(dbUrl.hostname));
assert.ok(dbUrl.pathname === '/dhelenas_rls_stage_20261011' || /^\/dhelenas_audit_security_[a-z0-9_]+$/.test(dbUrl.pathname));

const client = new pg.Client({ connectionString: dbUrl.toString() });
await client.connect();
try {
  const identity = await client.query('SELECT current_database() AS db, current_user AS role');
  assert.deepEqual(identity.rows[0], { db: dbUrl.pathname.slice(1), role: 'postgres' });

  const tables = await client.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')");
  assert.equal(tables.rows[0].n, 29);

  const ownerRead = await client.query('SELECT count(*)::int AS n FROM public.profiles');
  assert.ok(ownerRead.rows[0].n >= 2);
  const catalogRead = await client.query('SELECT count(*)::int AS n FROM public.products');
  assert.equal(catalogRead.rows[0].n, 1);

  for (const role of ['anon', 'authenticated']) {
    await client.query(`SET ROLE ${role}`);
    for (const sql of [
      'SELECT count(*) FROM public.profiles',
      'SELECT count(*) FROM public.products',
      "INSERT INTO public.categories (name,slug) VALUES ('Blocked','blocked')",
      "UPDATE public.settings SET value='{}'::jsonb WHERE key='rls_synthetic_setting'",
    ]) {
      await assert.rejects(client.query(sql), (error) => error.code === '42501');
    }
    await client.query('RESET ROLE');
  }

  await client.query('SET ROLE service_role');
  const serviceRead = await client.query('SELECT count(*)::int AS n FROM public.profiles');
  assert.equal(serviceRead.rows[0].n, ownerRead.rows[0].n);
  await client.query('RESET ROLE');

  await client.query('BEGIN');
  const ownerWrite = await client.query("UPDATE public.products SET price=price+1 WHERE sku='SYN-RLS-01' RETURNING id");
  assert.equal(ownerWrite.rowCount, 1);
  await client.query('ROLLBACK');

  await client.query('BEGIN');
  await client.query('CREATE TABLE public.stage_default_probe (id integer)');
  const defaults = await client.query("SELECT has_table_privilege('anon','public.stage_default_probe','SELECT') AS anon, has_table_privilege('authenticated','public.stage_default_probe','SELECT') AS authenticated, has_table_privilege('service_role','public.stage_default_probe','SELECT') AS service_role");
  assert.deepEqual(defaults.rows[0], { anon: false, authenticated: false, service_role: false });
  await client.query('ROLLBACK');

  // Reproduce the separate platform role's remaining default ACL. This table
  // exists only inside a rolled-back local transaction.
  await client.query('BEGIN');
  await client.query('GRANT CREATE ON SCHEMA public TO supabase_admin');
  await client.query('SET ROLE supabase_admin');
  await client.query('CREATE TABLE public.stage_supabase_admin_probe (id integer)');
  await client.query('RESET ROLE');
  const platformDefaults = await client.query("SELECT has_table_privilege('anon','public.stage_supabase_admin_probe','SELECT') AS anon");
  assert.equal(platformDefaults.rows[0].anon, true);
  await client.query('ROLLBACK');

  console.log('PASS: 29 tables; anon/authenticated denied; postgres owner and service_role preserved; future postgres table private; supabase_admin default remains exposed');
} finally {
  await client.end();
}
