import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

const url = new URL(process.env.TEST_DATABASE_URL || '');
if (!['localhost', '127.0.0.1'].includes(url.hostname)
    || !url.pathname.slice(1).startsWith('dhelenas_audit_')) {
    throw new Error('TEST_DATABASE_URL must target an isolated local dhelenas_audit_* database');
}
process.env.DATABASE_URL = url.href;
process.env.NODE_ENV = 'test';
const { placeOrder } = await import('../src/orderService.js');
const pool = new pg.Pool({ connectionString: url.href });
const runId = crypto.randomUUID().slice(0, 8).toUpperCase();
const colorId = 'audit-color';

async function fixture(label, maxUses = 1, firstPurchaseOnly = false) {
    const code = `AUDIT-${label}-${runId}`;
    const { rows: products } = await pool.query(
        'INSERT INTO products (name, price, sizes, colors) VALUES ($1, 189.90, $2, $3) RETURNING id',
        [code, JSON.stringify(['M']), JSON.stringify([{ id: colorId, name: 'Off-white', stock: { M: 2 } }])]
    );
    const { rows: coupons } = await pool.query(
        `INSERT INTO coupons (code, discount_type, discount_value, max_uses, max_uses_per_customer, first_purchase_only)
         VALUES ($1, 'fixed', 139.90, $2, $3, $4) RETURNING id`, [code, maxUses, firstPurchaseOnly ? null : 1, firstPurchaseOnly]
    );
    return { code, productId: products[0].id, couponId: coupons[0].id };
}

async function user(label) {
    const { rows } = await pool.query(
        'INSERT INTO profiles (email, password_hash) VALUES ($1, $2) RETURNING id',
        [`${label}-${runId}@example.invalid`, 'not-a-login']
    );
    return rows[0].id;
}

function request(f, couponCode = f.code) {
    return {
        items: [{ productId: f.productId, colorId, size: 'M', qty: 1 }],
        coupon_code: couponCode,
        payment_method: 'credito',
        shipping_method: 'retirada',
        shipping_address: {},
        customer: {},
    };
}

async function state(f) {
    const { rows } = await pool.query(
        `SELECT
          (SELECT COUNT(*)::int FROM coupon_usages WHERE coupon_id = $1) AS uses,
          (SELECT COUNT(*)::int FROM orders WHERE coupon_code = $2) AS orders,
          (SELECT COUNT(*)::int FROM stock_movements WHERE product_id = $3 AND type = 'sale') AS sales,
          (SELECT colors->0->'stock'->>'M' FROM products WHERE id = $3)::int AS stock`,
        [f.couponId, f.code, f.productId]
    );
    return rows[0];
}

try {
    // A failed prior run must not leave its fault-injection trigger active.
    await pool.query('DROP TRIGGER IF EXISTS audit_coupon_rollback ON audit_logs');
    await pool.query('DROP FUNCTION IF EXISTS audit_reject_after_coupon_usage()');
    await pool.query("INSERT INTO settings (key, value) VALUES ('shipping', '{\"pickup_enabled\":true}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value");

    const last = await fixture('LAST');
    const [firstUser, secondUser] = await Promise.all([user('last-a'), user('last-b')]);
    const competing = await Promise.allSettled([
        placeOrder(firstUser, request(last), `last-a-${runId}-0001`),
        placeOrder(secondUser, request(last), `last-b-${runId}-0001`),
    ]);
    assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = competing.find(result => result.status === 'rejected');
    assert.equal(rejected.reason.status, 400);
    assert.match(rejected.reason.message, /Cupom esgotado/);
    assert.deepEqual(await state(last), { uses: 1, orders: 1, sales: 1, stock: 1 });
    console.log('LAST USE: 1 winner, 1 controlled rejection, 1 use, 1 order, stock 1/2');

    const same = await fixture('SAMEKEY');
    const sameUser = await user('same-key');
    const key = `same-key-${runId}-0001`;
    const [sameA, sameB] = await Promise.all([
        placeOrder(sameUser, request(same), key),
        placeOrder(sameUser, request(same), key),
    ]);
    assert.equal(sameA.id, sameB.id);
    assert.deepEqual(await state(same), { uses: 1, orders: 1, sales: 1, stock: 1 });
    console.log('SAME KEY: same order, one use and one stock movement');

    const rollback = await fixture('ROLLBACK');
    const rollbackUser = await user('rollback');
    await pool.query(`CREATE OR REPLACE FUNCTION audit_reject_after_coupon_usage() RETURNS trigger AS $$
        BEGIN
          IF NEW.action = 'order.create' AND EXISTS (
            SELECT 1 FROM coupon_usages cu JOIN coupons c ON c.id = cu.coupon_id
            WHERE cu.order_id = NEW.entity_id::uuid AND c.code LIKE 'AUDIT-ROLLBACK-%'
          ) THEN
            RAISE EXCEPTION 'forced rollback after coupon usage';
          END IF;
          RETURN NEW;
        END;
      $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER audit_coupon_rollback BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION audit_reject_after_coupon_usage()`);
    await assert.rejects(
        placeOrder(rollbackUser, request(rollback), `rollback-${runId}-0001`),
        /forced rollback after coupon usage/
    );
    assert.deepEqual(await state(rollback), { uses: 0, orders: 0, sales: 0, stock: 2 });
    await pool.query('DROP TRIGGER audit_coupon_rollback ON audit_logs');
    await pool.query('DROP FUNCTION audit_reject_after_coupon_usage()');
    console.log('ROLLBACK: use, order and stock movement absent; stock restored 2/2');

    const exhausted = await fixture('EXHAUSTED');
    const exhaustedA = await user('exhausted-a');
    const exhaustedB = await user('exhausted-b');
    await placeOrder(exhaustedA, request(exhausted), `exhausted-a-${runId}-0001`);
    await assert.rejects(
        placeOrder(exhaustedB, request(exhausted), `exhausted-b-${runId}-0001`),
        error => error.status === 400 && error.message === 'Cupom esgotado'
    );
    assert.deepEqual(await state(exhausted), { uses: 1, orders: 1, sales: 1, stock: 1 });
    console.log('EXHAUSTED: rejected before order/payment; no extra stock movement');

    const firstPurchase = await fixture('FIRSTPURCHASE', 2, true);
    const firstPurchaseUser = await user('first-purchase');
    const firstPurchaseResults = await Promise.allSettled([
        placeOrder(firstPurchaseUser, request(firstPurchase), `first-purchase-a-${runId}`),
        placeOrder(firstPurchaseUser, request(firstPurchase), `first-purchase-b-${runId}`),
    ]);
    assert.equal(firstPurchaseResults.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(firstPurchaseResults.find(result => result.status === 'rejected').reason.message, /primeira compra/);
    assert.deepEqual(await state(firstPurchase), { uses: 1, orders: 1, sales: 1, stock: 1 });
    console.log('FIRST PURCHASE: concurrent customer orders cannot both use the coupon');
} finally {
    await pool.end();
}
