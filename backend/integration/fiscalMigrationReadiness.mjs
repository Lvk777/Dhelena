import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';

if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required');
const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await client.connect();
try {
    for (const name of ['001_init.sql', '002_profiles_rename.sql', '022_fiscal_documents.sql', '022_fiscal_documents.sql']) {
        await client.query(await fs.readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
    }
    const { rows } = await client.query(`SELECT c.relrowsecurity AS rls,
        EXISTS (SELECT 1 FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner)))
            WHERE grantee=0 AND privilege_type='SELECT') AS public_read,
        (SELECT count(*)::int FROM pg_constraint WHERE conrelid='fiscal_documents'::regclass AND contype='u') AS uniques
        FROM pg_class c WHERE c.oid='fiscal_documents'::regclass`);
    assert.equal(rows[0].rls, true);
    assert.equal(rows[0].public_read, false);
    assert.ok(rows[0].uniques >= 3);
    const { rows: references } = await client.query(`SELECT confrelid::regclass::text AS target FROM pg_constraint
        WHERE conrelid='fiscal_documents'::regclass AND contype='f'`);
    assert.ok(references.some(row => row.target === 'profiles'));
    assert.ok(references.some(row => row.target === 'orders'));
    console.log('PASS: fiscal document migration is idempotent, private and references orders/profiles');
} finally { await client.end(); }
