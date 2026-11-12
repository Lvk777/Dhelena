import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const defaults = fs.readFileSync(new URL('../../.env.base44-defaults', import.meta.url), 'utf8');
const line = defaults.split(/\r?\n/).find(value => value.startsWith('DATABASE_URL='));
if (!line) throw new Error('Local DATABASE_URL unavailable');
const adminUrl = new URL(line.slice('DATABASE_URL='.length));
adminUrl.hostname = 'localhost';
adminUrl.pathname = '/postgres';
if (adminUrl.hostname !== 'localhost' || adminUrl.pathname !== '/postgres') {
    throw new Error('Isolated test requires local PostgreSQL');
}
const dbName = `dhelenas_pix_resolution_test_${Date.now()}`;
const admin = new pg.Client({ connectionString: adminUrl.toString() });
let created = false;
await admin.connect();
try {
    await admin.query(`CREATE DATABASE ${dbName}`);
    created = true;
    const testUrl = new URL(adminUrl);
    testUrl.pathname = `/${dbName}`;
    process.env.DATABASE_URL = testUrl.toString();
    const { withTransaction, pool } = await import('../src/config/db.js');
    const { resolveFailedPixAttemptInTransaction } = await import('../src/failedPixResolution.js');
    const { applyVerifiedOrderInTransaction } = await import('../src/lib/paymentReconciliation.js');
    try {
        const files = fs.readdirSync(new URL('../migrations/', import.meta.url))
            .filter(name => name.endsWith('.sql')).sort();
        for (const name of files) {
            const sql = fs.readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
            await pool.query(sql);
        }
        const user = (await pool.query(
            `INSERT INTO profiles (email, password_hash, role) VALUES ('pix-test@example.invalid', 'local', 'admin') RETURNING id`,
        )).rows[0];
        const product = (await pool.query(
            `INSERT INTO products (name, sku, price, sizes, colors, sold_count)
             VALUES ('Isolated Test', 'PIX-RESOLUTION-ISOLATED', 50, '["M"]',
             '[{"id":"color-1","stock":{"M":4}}]', 1) RETURNING id`,
        )).rows[0];
        const order = (await pool.query(
            `INSERT INTO orders (order_number, user_id, subtotal, total, snapshot, payment_method,
                payment_attempt_method, payment_attempt_started_at)
             VALUES ('DH-ISOLATED-PIX', $1, 50, 50, '{}', 'pix', 'pix', now() - interval '1 day') RETURNING id`,
            [user.id],
        )).rows[0];
        await pool.query(
            `INSERT INTO order_items (order_id, product_id, product_name, color_id, size, quantity, unit_price, subtotal)
             VALUES ($1, $2, 'Isolated Test', 'color-1', 'M', 1, 50, 50)`, [order.id, product.id]);
        const provider = { getMercadoPagoMode: () => 'test', findTestOrdersByReference: async () => [] };
        const execute = () => withTransaction(client =>
            resolveFailedPixAttemptInTransaction(client, order.id, user.id, provider));
        const outcomes = await Promise.all([execute(), execute()]);
        assert.deepEqual(outcomes.map(value => value.outcome).sort(), ['already_resolved', 'resolved_and_cancelled']);
        const actual = (await pool.query(
            `SELECT status, payment_status, payment_attempt_started_at
             FROM orders WHERE id = $1`, [order.id])).rows[0];
        const stock = (await pool.query('SELECT colors FROM products WHERE id = $1', [product.id])).rows[0].colors[0].stock.M;
        const restorations = (await pool.query(
            "SELECT count(*)::int AS count FROM stock_restorations WHERE order_id = $1 AND source = 'cancellation'",
            [order.id])).rows[0].count;
        assert.equal(actual.status, 'cancelado');
        assert.equal(actual.payment_status, 'pending');
        assert.ok(actual.payment_attempt_started_at);
        assert.equal(stock, 5);
        assert.equal(restorations, 1);

        const raceOrder = (await pool.query(
            `INSERT INTO orders (order_number, user_id, subtotal, total, snapshot, payment_method,
                payment_attempt_method, payment_attempt_started_at)
             VALUES ('DH-ISOLATED-WEBHOOK', $1, 50, 50, '{}', 'pix', 'pix', now() - interval '1 day') RETURNING id`,
            [user.id])).rows[0];
        await pool.query(
            `INSERT INTO order_items (order_id, product_id, product_name, color_id, size, quantity, unit_price, subtotal)
             VALUES ($1, $2, 'Isolated Test', 'color-1', 'M', 1, 50, 50)`, [raceOrder.id, product.id]);
        let signalLookup;
        let releaseLookup;
        const lookupStarted = new Promise(resolve => { signalLookup = resolve; });
        const lookupGate = new Promise(resolve => { releaseLookup = resolve; });
        const raceResolver = withTransaction(client => resolveFailedPixAttemptInTransaction(
            client, raceOrder.id, user.id, {
                getMercadoPagoMode: () => 'test',
                findTestOrdersByReference: async () => { signalLookup(); await lookupGate; return []; },
            }));
        await lookupStarted;
        const verified = {
            mp_order_id: 'ORD-ISOLATED-WEBHOOK', mp_payment_id: 'PAY-ISOLATED',
            external_reference: 'DH-ISOLATED-WEBHOOK', total_amount: '50.00',
            transaction_amount: '50.00', currency_id: 'BRL', payment_count: 1,
            order_status: 'processed', order_status_detail: 'accredited',
            transaction_status: 'processed', transaction_status_detail: 'accredited',
            mp_status: 'processed', mp_status_detail: 'accredited',
        };
        let webhookSettled = false;
        const webhook = withTransaction(client => applyVerifiedOrderInTransaction(
            client, raceOrder.id, verified, 'webhook')).finally(() => { webhookSettled = true; });
        await new Promise(resolve => setTimeout(resolve, 40));
        assert.equal(webhookSettled, false);
        releaseLookup();
        await raceResolver;
        assert.equal((await webhook).outcome, 'ignored');
        const raceState = (await pool.query('SELECT status, payment_status FROM orders WHERE id = $1',
            [raceOrder.id])).rows[0];
        assert.equal(raceState.status, 'cancelado');
        assert.equal(raceState.payment_status, 'pending');
        console.log('Isolated PostgreSQL: stock 4 -> 5; one restoration; duplicate remains 5');
        console.log('Isolated PostgreSQL: concurrent webhook waited and did not approve cancelled order');
    } finally {
        await pool.end();
    }
} finally {
    if (created) await admin.query(`DROP DATABASE ${dbName}`);
    await admin.end();
}
