// Targeted rehearsal for the current production schema: 014 is already present.
// Refuse any non-local or non-empty database. All rows are synthetic.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const url = new URL(process.env.TEST_DATABASE_URL || '');
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
assert.match(url.pathname, /^\/dhelenas_audit_security_post014(?:_[a-z0-9]+)?$/);
const directory = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(directory, '../..');
const client = new pg.Client({ connectionString: url.href });
const read = file => fs.readFileSync(path.join(directory, file), 'utf8');

await client.connect();
try {
    const empty = await client.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'");
    assert.equal(empty.rows[0].n, 0, 'Refusing a nonempty database');
    const fixture = spawnSync(process.env.PYTHON || 'python', [path.join(directory, 'build_local_fixture.py')], { encoding: 'utf8' });
    assert.equal(fixture.status, 0, 'Fixture generator failed');
    await client.query(fixture.stdout);
    await client.query(fs.readFileSync(path.join(backend, 'migrations/014_category_collection_fields.sql'), 'utf8'));
    const baseline = (await client.query(read('2026-10-12_schema_fingerprint.sql'))).rows[0];
    assert.equal(Number(baseline.tables), 29);
    assert.equal(Number(baseline.columns), 407);
    assert.equal(baseline.columns_md5, '86af09cba39dffc8202d9a711d9806ec');
    assert.equal(baseline.constraints_md5, 'ebf2a217ce0c61f04bc60b3e39df8350');
    await client.query(read('synthetic_staging_data.sql'));
    await client.query(read('2026-10-11_01_revoke_direct_access.sql'));
    await client.query(read('2026-10-11_02_enable_rls.sql'));
    const protectedState = (await client.query(read('2026-10-11_public_rls_postcheck.sql'))).rows[0];
    assert.equal(Number(protectedState.public_tables), 29);
    assert.equal(Number(protectedState.rls_enabled_no_force), 29);
    assert.equal(Number(protectedState.direct_or_public_table_grants), 0);
    assert.equal(Number(protectedState.effective_column_access_tables), 0);
    await client.query('BEGIN');
    try {
        for (const name of ['015_notification_outbox.sql', '016_profile_auth_links.sql', '017_admin_authorities.sql']) {
            await client.query(fs.readFileSync(path.join(backend, 'migrations', name), 'utf8'));
        }
        const after = (await client.query(`SELECT count(*)::int AS tables,
            count(*) FILTER (WHERE c.relrowsecurity AND NOT c.relforcerowsecurity)::int AS protected,
            count(*) FILTER (WHERE has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
                OR has_any_column_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))::int AS exposed
            FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relkind IN ('r','p')`)).rows[0];
        assert.deepEqual(after, { tables: 31, protected: 31, exposed: 0 });
    } finally {
        await client.query('ROLLBACK');
    }
    console.log('PASS: production post-014 schema fingerprint; security phases; 015-017 rollback rehearsal; 31/31 RLS, zero client access');
} finally {
    await client.end();
}
