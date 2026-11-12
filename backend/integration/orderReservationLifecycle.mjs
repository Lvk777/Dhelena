// Run only in a disposable localhost database named dhelenas_audit_reservation_*.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';

const url = new URL(process.env.TEST_DATABASE_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
assert.match(url.pathname, /^\/dhelenas_audit_reservation_[a-z0-9_]+$/);
process.env.DATABASE_URL = url.href;
process.env.NODE_ENV = 'test';
const db = new pg.Pool({ connectionString: url.href, max: 8 });
const { placeOrder, cancelOrder } = await import('../src/orderService.js');
const { reserveOrderStockInTransaction } = await import('../src/lib/deferredStock.js');
const { applyVerifiedOrderInTransaction, recordVerifiedNonApprovedOrderInTransaction } =
    await import('../src/lib/paymentReconciliation.js');
const { restoreStock } = await import('../src/afterSalesService.js');
const { createOrderReservationExpiryWorker } = await import('../src/services/orderReservationExpiry.js');
const { previewCheckout } = await import('../src/lib/checkoutPreview.js');
const { withStockSummary } = await import('../src/routes/catalog.js');
const { pool } = await import('../src/config/db.js');
const transaction = async callback => {
    const client = await db.connect();
    try { await client.query('BEGIN'); const result = await callback(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
};
const env = { ORDER_RESERVATION_EXPIRY_ENABLED: 'true', ORDER_RESERVATION_TTL_MINUTES: '60' };
const notify = async () => {};
const pixReadiness = () => ({ configured: true, webhook_configured: true });
const body = (productId, method = 'debito') => ({
    items: [{ productId, colorId: 'bege', size: 'G', qty: 1 }], payment_method: method,
    shipping_method: 'retirada', shipping_address: null, customer: { name: 'Pessoa fictícia' },
});
const place = (userId, request, key) => placeOrder(userId, request, key,
    { transaction, notify, pixReadiness, env });
const product = async name => (await db.query(
    `INSERT INTO products(name,sku,price,sizes,colors,status,weight,package_height,package_width,package_length)
     VALUES($1,$2,10,$3,$4,'published',0.5,10,20,30) RETURNING id`,
    [name, name, JSON.stringify(['G']), JSON.stringify([{ id: 'bege', name: 'Bege', stock: { G: 1 } }])])).rows[0].id;
const stock = async productId => {
    const { rows } = await db.query('SELECT colors,sold_count FROM products WHERE id=$1', [productId]);
    return { available: rows[0].colors[0].stock.G, sold: rows[0].sold_count };
};
const ledger = async orderId => (await db.query(
    'SELECT status,quantity FROM stock_reservations WHERE order_id=$1', [orderId])).rows;
const startAttempt = orderId => transaction(async client => {
    const order = (await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0];
    const result = await client.query(
        `UPDATE orders SET payment_attempt_started_at=now(),payment_attempt_method=$2
         WHERE id=$1 AND status='recebido' AND payment_status='pending'
           AND payment_attempt_started_at IS NULL RETURNING id`,
        [orderId, order.payment_method === 'pix' ? 'pix' : 'card']);
    if (!result.rows.length) throw Object.assign(new Error('Attempt already started'), { status: 409 });
    await reserveOrderStockInTransaction(client, order);
});
const provider = (order, state) => {
    const approved = state === 'approved';
    const rejected = state === 'rejected';
    const status = approved ? 'processed' : rejected ? 'rejected' : 'pending';
    const detail = approved ? 'accredited' : rejected ? 'rejected' : 'waiting_payment';
    return {
        mp_order_id: `ORD-${order.id}`, mp_payment_id: `PAY-${order.id}`,
        external_reference: order.order_number, total_amount: order.total,
        transaction_amount: order.total, currency_id: 'BRL', transaction_currency_id: 'BRL', payment_count: 1,
        order_status: approved ? 'processed' : rejected ? 'failed' : 'action_required',
        order_status_detail: detail, transaction_status: status, transaction_status_detail: detail,
        mp_status: status, mp_status_detail: detail,
    };
};
const readOrder = async id => (await db.query('SELECT * FROM orders WHERE id=$1', [id])).rows[0];
const apply = (id, state) => transaction(async client => {
    const order = (await client.query('SELECT * FROM orders WHERE id=$1', [id])).rows[0];
    return state === 'approved'
        ? applyVerifiedOrderInTransaction(client, id, provider(order, state), 'synthetic_official_read')
        : recordVerifiedNonApprovedOrderInTransaction(client, id, provider(order, state), 'synthetic_official_read');
});
const expireInScratch = id => db.query(
    `UPDATE orders SET snapshot=jsonb_set(snapshot,'{reservation_expires_at}',to_jsonb('2020-01-01T00:00:00.000Z'::text)) WHERE id=$1`, [id]);

try {
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0);
    const files = await fs.readdir(new URL('../migrations/', import.meta.url));
    for (let n = 1; n <= 18; n++) {
        const file = files.find(value => value.startsWith(`${String(n).padStart(3, '0')}_`) && value.endsWith('.sql'));
        assert.ok(file, `migration ${n}`);
        await db.query(await fs.readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    }
    await db.query("INSERT INTO settings(key,value) VALUES('payments','{\"card_enabled\":true,\"pix_enabled\":true}'),('shipping','{\"pickup_enabled\":true}')");
    const users = [];
    for (let n = 0; n < 3; n++) users.push((await db.query(
        'INSERT INTO profiles(email,password_hash) VALUES($1,$2) RETURNING id',
        [`synthetic-${n}@example.invalid`, 'not-a-login'])).rows[0].id);

    const checkoutProduct = await product('Synthetic checkout');
    const request = body(checkoutProduct);
    await previewCheckout(request, users[0], { db, env });
    const unstarted = await place(users[0], request, 'synthetic-checkout-unstarted');
    assert.deepEqual(await stock(checkoutProduct), { available: 1, sold: 0 });
    assert.deepEqual(await ledger(unstarted.id), []);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM stock_movements WHERE product_id=$1', [checkoutProduct])).rows[0].n, 0);
    assert.equal((await place(users[0], request, 'synthetic-checkout-unstarted')).id, unstarted.id);
    await expireInScratch(unstarted.id);
    const worker = createOrderReservationExpiryWorker({ db, transaction, env });
    assert.equal((await worker.runOnce()).expired, 1);
    assert.deepEqual(await stock(checkoutProduct), { available: 1, sold: 0 });
    console.log('PASS checkout/abandon: no reserve, no sale, no stock change, idempotent order');

    const lastUnit = await product('Synthetic last unit');
    const first = await place(users[0], body(lastUnit), 'synthetic-race-first');
    const second = await place(users[1], body(lastUnit), 'synthetic-race-second');
    assert.deepEqual(await stock(lastUnit), { available: 1, sold: 0 });
    const attempts = await Promise.allSettled([startAttempt(first.id), startAttempt(second.id)]);
    assert.equal(attempts.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(attempts.filter(value => value.status === 'rejected' && value.reason.status === 409).length, 1);
    const winner = attempts[0].status === 'fulfilled' ? first : second;
    assert.deepEqual(await stock(lastUnit), { available: 0, sold: 0 });
    assert.equal((await ledger(winner.id))[0].status, 'active');
    const reservedSummary = (await withStockSummary((await db.query('SELECT * FROM products WHERE id=$1', [lastUnit])).rows, db))[0].stock_summary;
    assert.deepEqual({ on_hand: reservedSummary.on_hand, reserved: reservedSummary.reserved,
        available: reservedSummary.available, sold: reservedSummary.sold_confirmed_new },
    { on_hand: 1, reserved: 1, available: 0, sold: 0 });
    assert.equal(await transaction(async client => {
        const current = (await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [winner.id])).rows[0];
        return reserveOrderStockInTransaction(client, current);
    }), false);
    assert.deepEqual(await stock(lastUnit), { available: 0, sold: 0 });
    assert.equal((await db.query('SELECT count(*)::int AS n FROM stock_movements WHERE product_id=$1', [lastUnit])).rows[0].n, 0);
    await expireInScratch(winner.id);
    assert.equal((await worker.runOnce()).expired, 0); // Unknown attempt is never auto-released.
    console.log('PASS concurrent last unit and uncertain attempt: one reservation, zero sales');

    const rejectedProduct = await product('Synthetic rejected card');
    const rejected = await place(users[2], body(rejectedProduct, 'credito'), 'synthetic-rejected-card');
    await startAttempt(rejected.id);
    assert.deepEqual(await stock(rejectedProduct), { available: 0, sold: 0 });
    await apply(rejected.id, 'rejected');
    assert.deepEqual(await stock(rejectedProduct), { available: 1, sold: 0 });
    assert.equal((await ledger(rejected.id))[0].status, 'released');
    await apply(rejected.id, 'rejected');
    assert.deepEqual(await stock(rejectedProduct), { available: 1, sold: 0 });
    await assert.rejects(apply(rejected.id, 'approved'), /Reserva.*incompleta/);
    await assert.rejects(cancelOrder(rejected.id, users[2]), { status: 409 });
    assert.deepEqual(await stock(rejectedProduct), { available: 1, sold: 0 });
    console.log('PASS rejected card: official rejection releases once, late approval fails closed');

    const pixProduct = await product('Synthetic unpaid Pix');
    const pix = await place(users[0], body(pixProduct, 'pix'), 'synthetic-pix-pending');
    await startAttempt(pix.id);
    await apply(pix.id, 'pending');
    await db.query("UPDATE orders SET pix_qr_code='synthetic-unpaid-qr' WHERE id=$1", [pix.id]);
    assert.deepEqual(await stock(pixProduct), { available: 0, sold: 0 });
    assert.equal((await ledger(pix.id))[0].status, 'active');
    await expireInScratch(pix.id);
    assert.equal((await worker.runOnce()).expired, 0);
    await apply(pix.id, 'approved');
    assert.deepEqual(await stock(pixProduct), { available: 0, sold: 1 });
    assert.equal((await ledger(pix.id))[0].status, 'sold');
    const soldSummary = (await withStockSummary((await db.query('SELECT * FROM products WHERE id=$1', [pixProduct])).rows, db))[0].stock_summary;
    assert.deepEqual({ on_hand: soldSummary.on_hand, reserved: soldSummary.reserved,
        available: soldSummary.available, sold: soldSummary.sold_confirmed_new },
    { on_hand: 0, reserved: 0, available: 0, sold: 1 });
    await apply(pix.id, 'approved'); // Duplicate webhook/readback.
    assert.deepEqual(await stock(pixProduct), { available: 0, sold: 1 });
    console.log('PASS Pix pending then official approval; duplicate confirmation does not double count');

    // Production has an unrelated manual-only historical order number 000006.
    await place(users[2], body(await product('Synthetic number gap')), 'synthetic-number-gap');
    const cardProduct = await product('Synthetic approved card');
    const card = await place(users[1], body(cardProduct, 'credito'), 'synthetic-approved-card');
    await startAttempt(card.id);
    await apply(card.id, 'approved');
    assert.deepEqual(await stock(cardProduct), { available: 0, sold: 1 });
    const item = (await db.query('SELECT * FROM order_items WHERE order_id=$1', [card.id])).rows[0];
    await transaction(client => restoreStock(client, card, item, 1, 'cancellation'));
    await transaction(client => restoreStock(client, card, item, 1, 'cancellation'));
    assert.deepEqual(await stock(cardProduct), { available: 1, sold: 0 });
    const returnedSummary = (await withStockSummary((await db.query('SELECT * FROM products WHERE id=$1', [cardProduct])).rows, db))[0].stock_summary;
    assert.equal(returnedSummary.sold_confirmed_new, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM stock_restorations WHERE order_id=$1', [card.id])).rows[0].n, 1);
    console.log('PASS approved card and one-time cancellation restoration');

    const manualProduct = await product('Synthetic manual cancellation');
    const manual = await place(users[2], body(manualProduct), 'synthetic-manual-cancel');
    assert.equal((await cancelOrder(manual.id, users[2])).status, 'cancelado');
    assert.equal((await cancelOrder(manual.id, users[2])).status, 'cancelado');
    assert.deepEqual(await stock(manualProduct), { available: 1, sold: 0 });

    const legacyProduct = await product('Synthetic legacy order');
    const legacy = await place(users[0], body(legacyProduct), 'synthetic-legacy');
    await db.query("UPDATE orders SET snapshot=snapshot-'stock_model' WHERE id=$1", [legacy.id]);
    await db.query('UPDATE products SET colors=$1,sold_count=1 WHERE id=$2',
        [JSON.stringify([{ id: 'bege', name: 'Bege', stock: { G: 0 } }]), legacyProduct]);
    await db.query("INSERT INTO stock_movements(product_id,type,quantity,color_id,size,previous_stock,new_stock) VALUES($1,'sale',-1,'bege','G',1,0)",
        [legacyProduct]);
    assert.equal((await ledger(legacy.id)).length, 0);
    assert.equal((await cancelOrder(legacy.id, users[0])).status, 'cancelado');
    assert.deepEqual(await stock(legacyProduct), { available: 1, sold: 0 });
    assert.equal((await db.query('SELECT count(*)::int AS n FROM stock_restorations WHERE order_id=$1', [legacy.id])).rows[0].n, 1);
    console.log('PASS legacy order remains on legacy cancellation path without ledger backfill');
} finally {
    await db.end();
    await pool.end();
}
