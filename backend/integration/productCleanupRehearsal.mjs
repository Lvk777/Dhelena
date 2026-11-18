// Synthetic, disposable PostgreSQL 17 rehearsal. Refuses non-local connections.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { deleteProductPermanently } from '../src/services/productDeletion.js';
import { assertHistoricalProductCanPublish } from '../src/lib/historicalProductPublication.js';

const adminUrl = new URL(process.env.POSTGRES_ADMIN_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(adminUrl.hostname));
assert.equal(adminUrl.pathname, '/postgres');
const name = `dhelenas_cleanup_${randomBytes(8).toString('hex')}`;
const fixtureUrl = new URL(adminUrl.href);
fixtureUrl.pathname = `/${name}`;
const admin = new pg.Client({ connectionString: adminUrl.href });
const db = new pg.Client({ connectionString: fixtureUrl.href });
await admin.connect();
await admin.query(`CREATE DATABASE ${name}`);
try {
    await db.connect();
    await db.query(`
        CREATE TABLE products (id uuid PRIMARY KEY, name text, sku text, status text, colors jsonb, sold_count integer);
        CREATE TABLE orders (id uuid PRIMARY KEY, order_number text, payment_status text);
        CREATE TABLE order_items (id uuid PRIMARY KEY, order_id uuid REFERENCES orders(id), product_id uuid REFERENCES products(id), product_sku text);
        CREATE TABLE stock_reservations (id uuid PRIMARY KEY, order_id uuid REFERENCES orders(id), product_id uuid REFERENCES products(id));
        CREATE TABLE stock_movements (id uuid PRIMARY KEY, order_id uuid REFERENCES orders(id), product_id uuid REFERENCES products(id));
        CREATE TABLE favorites (id uuid PRIMARY KEY, product_id uuid REFERENCES products(id));
        CREATE TABLE analytics_events (id uuid PRIMARY KEY, product_id uuid);
        CREATE TABLE look_promotions (id uuid PRIMARY KEY, eligible_products jsonb);
        CREATE TABLE audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid, action text, entity_type text, entity_id text, changes jsonb, ip_address text);
    `);
    const protectedProduct = randomUUID();
    const protectedOrder = randomUUID();
    const discardable = randomUUID();
    await db.query('INSERT INTO products VALUES ($1,$2,$3,$4,$5,$6),($7,$8,$9,$10,$11,$12)', [
        protectedProduct, 'Peça histórica', 'HIST-1', 'archived', JSON.stringify([{ stock: { P: 0 } }]), 1,
        discardable, 'Rascunho descartável', 'DRAFT-1', 'draft', JSON.stringify([{ stock: { P: 0 } }]), 0,
    ]);
    await db.query('INSERT INTO orders VALUES ($1,$2,$3)', [protectedOrder, 'DH-2026-000019', 'approved']);
    await db.query('INSERT INTO order_items VALUES ($1,$2,$3,$4)', [randomUUID(), protectedOrder, protectedProduct, 'HIST-1']);
    const protectedBefore = (await db.query('SELECT row_to_json(o) AS value FROM orders o WHERE id=$1', [protectedOrder])).rows[0].value;
    const transaction = async callback => {
        await db.query('BEGIN');
        try { const result = await callback(db); await db.query('COMMIT'); return result; }
        catch (error) { await db.query('ROLLBACK'); throw error; }
    };
    const deleteProduct = id => deleteProductPermanently(id, randomUUID(), '127.0.0.1', transaction);
    await assert.rejects(deleteProduct(protectedProduct), { status: 409 });
    await assert.rejects(assertHistoricalProductCanPublish(db,
        { id: protectedProduct, status: 'archived', sold_count: 1 }, 'published'), { status: 409 });
    assert.equal((await deleteProduct(discardable)).id, discardable);
    assert.equal(Number((await db.query('SELECT count(*) AS n FROM products WHERE id=$1', [discardable])).rows[0].n), 0);
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM audit_logs WHERE entity_id=$1 AND action='product.delete'", [discardable])).rows[0].n), 1);
    assert.deepEqual((await db.query('SELECT row_to_json(o) AS value FROM orders o WHERE id=$1', [protectedOrder])).rows[0].value, protectedBefore);
    assert.equal(Number((await db.query('SELECT count(*) AS n FROM order_items WHERE order_id=$1', [protectedOrder])).rows[0].n), 1);
    console.log('PostgreSQL 17 cleanup rehearsal passed: linked product blocked, empty draft deleted, audit written, paid order intact');
} finally {
    await db.end().catch(() => {});
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end();
}
