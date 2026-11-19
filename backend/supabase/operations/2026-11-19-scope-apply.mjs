// Exact, audited production operation. No order, payment, inventory quantity or fiscal row is changed.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';

assert.equal(process.env.NODE_ENV, 'production');
assert.ok(process.env.DATABASE_URL);
const approvedSha = process.argv.find(arg => arg.startsWith('--sha='))?.slice(6);
const apply = process.argv.includes('--apply');
if (apply) assert.match(approvedSha || '', /^[0-9a-f]{40}$/);

const historicalIds = [
    '7b899e4e-7e4d-46cb-9e2d-be89bc9683f6', '71498a89-8ea9-456b-a414-f832da2c196e',
    'e6dfe65b-f491-41e2-b54d-5c4499a69be7', 'df3f56b5-8b86-40b4-b502-0c64e29b1fa8',
    '3f39904f-4662-4b1e-a60f-97e847ce561b', '9efbc69c-6575-407f-9755-771f13d99214',
    'e545add8-1e42-4cce-b211-f7240e4ab993', 'a438cb1c-0ce6-471f-adfc-0ba3595b67d7',
    '211ffc61-8da5-4a40-922c-73c403c0a2dd', '5521b0a1-eeb7-4e06-b904-0de205c3ce55',
    'c58eb5d6-86cf-4e89-ac8f-d63c49cdceaf', '896b0cf3-b1c4-43db-8761-a2e1a07d3b36',
    'e047c673-a19e-4246-9596-ad9338054fab', '9967b18f-20d4-4112-bd49-c2c1cc95d2fe',
    '066af33a-e7dd-4575-94e6-afb52ab931fe', 'b4208c4c-9f6f-425c-aeac-27290d43f455',
];
const shortsId = 'd97cec57-2578-4d8d-827f-9f3938c9eab9';
assert.equal(new Set(historicalIds).size, 16);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
try {
    await db.query('BEGIN');
    const maintenance = await db.query("SELECT value->>'maintenance_mode' AS enabled FROM settings WHERE key='maintenance'");
    assert.equal(maintenance.rows[0]?.enabled, 'true', 'Maintenance must stay ON');
    const products = await db.query('SELECT id,name,status,sold_count,colors FROM products ORDER BY id FOR UPDATE');
    assert.equal(products.rowCount, 17, 'Catalog changed since the read-only inventory');
    const shorts = products.rows.find(row => row.id === shortsId);
    assert.ok(shorts && shorts.name.toLowerCase() === 'shorts angel' && shorts.status === 'archived');
    assert.equal(products.rows.filter(row => historicalIds.includes(row.id)).length, 16);
    assert.ok(products.rows.filter(row => row.id !== shortsId).every(row =>
        historicalIds.includes(row.id) && row.status !== 'published' && Number(row.sold_count) > 0));
    const fiscalBefore = (await db.query('SELECT count(*)::int AS n FROM fiscal_documents')).rows[0].n;
    const orderBefore = (await db.query("SELECT order_number,payment_status,shipping_status FROM orders WHERE order_number IN ('DH-2026-000018','DH-2026-000019') ORDER BY order_number")).rows;
    assert.equal(orderBefore.length, 2);
    if (apply) {
        for (const name of ['024_product_operational_scope.sql', '025_pending_fiscal_keys.sql']) {
            await db.query(await fs.readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
        }
        const already = await db.query('SELECT id FROM products WHERE historical_only=true');
        assert.equal(already.rowCount, 0, 'Scope has already been applied or changed');
        const updated = await db.query('UPDATE products SET historical_only=true WHERE id=ANY($1::uuid[]) RETURNING id', [historicalIds]);
        assert.equal(updated.rowCount, 16);
        for (const id of historicalIds) {
            await db.query(`INSERT INTO audit_logs(action,entity_type,entity_id,changes)
                VALUES('product.historical_scope','product',$1,$2)`, [id,
                JSON.stringify({ historical_only: true, approved_sha: approvedSha, operation: '2026-11-19-scope-apply' })]);
        }
    }
    assert.deepEqual((await db.query("SELECT order_number,payment_status,shipping_status FROM orders WHERE order_number IN ('DH-2026-000018','DH-2026-000019') ORDER BY order_number")).rows, orderBefore);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM fiscal_documents')).rows[0].n, fiscalBefore);
    if (apply) await db.query('COMMIT'); else await db.query('ROLLBACK');
    console.log(JSON.stringify({ applied: apply, historical: 16, operational: 1,
        order18: orderBefore[0], order19: orderBefore[1], fiscal_documents: fiscalBefore }));
} catch (error) { await db.query('ROLLBACK').catch(() => {}); throw error; }
finally { await db.end(); }
