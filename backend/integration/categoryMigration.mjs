// Rehearse ONLY migration 014 inside a rollback-only local transaction.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
const url = new URL(process.env.TEST_DATABASE_URL || '');
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
assert.match(url.pathname, /^\/dhelenas_audit_security_[a-z0-9_]+$/);
const client = new pg.Client({ connectionString: url.href });
const migration = fs.readFileSync(new URL('../migrations/014_category_collection_fields.sql', import.meta.url), 'utf8');
const columns = [['categories', 'description'], ['categories', 'status'], ['collections', 'banner_image'],
    ['collections', 'status'], ['collections', 'featured'], ['collections', 'start_date'], ['collections', 'end_date']];
async function snapshot() {
    const result = [];
    for (const table of ['categories', 'collections']) result.push((await client.query(`SELECT to_jsonb(t) AS row FROM public.${table} t ORDER BY id`)).rows);
    return result;
}
await client.connect();
try {
    const original = await snapshot();
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '30s'");
    await client.query(migration);
    await client.query(migration);
    for (const [table, column] of columns) {
        assert.equal((await client.query('SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3', ['public', table, column])).rows[0].n, 1);
    }
    const after = await snapshot();
    for (let i = 0; i < original.length; i++) {
        assert.equal(after[i].length, original[i].length);
        for (let j = 0; j < original[i].length; j++) {
            for (const [key, value] of Object.entries(original[i][j].row)) assert.deepEqual(after[i][j].row[key], value);
            assert.equal(after[i][j].row.status, 'active');
            if (i === 1) assert.equal(after[i][j].row.featured, false);
        }
    }
    await client.query("UPDATE public.categories SET description='Synthetic 014 rehearsal',status='inactive' WHERE slug='synthetic-category'");
    const adminFields = await client.query("SELECT description,status FROM categories WHERE slug='synthetic-category'");
    assert.deepEqual(adminFields.rows[0], { description: 'Synthetic 014 rehearsal', status: 'inactive' });
    await client.query('ROLLBACK');
    assert.deepEqual(await snapshot(), original);
    console.log('PASS: migration 014 applied twice, 7 columns and admin fields verified; original rows and schema restored by ROLLBACK');
    console.log('Migration SHA256:', crypto.createHash('sha256').update(migration).digest('hex'));
} finally { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
