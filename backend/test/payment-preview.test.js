import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { requireSupabaseAdmin } from '../src/middleware.js';
import { buildPaymentReconciliationPreview, loadPaymentReconciliationPreview } from '../src/lib/paymentPreview.js';
import orderRouter from '../src/routes/orders.js';
import { pool } from '../src/config/db.js';

const orderId = 'e0ee23b9-cc7e-4511-bea9-899860e0ff20';
const mpOrderId = 'ORDTST01M3WY62VJNVEVXATHY3CRDVHW';
const transactionId = 'PAY01M3WY62W216W8V5J7XA7JD5JJ';
const order = {
    id: orderId, order_number: 'DH-2026-000006', status: 'recebido', payment_status: 'pending',
    total: '50.00', paid_at: null, mercado_pago_order_id: null, mercado_pago_payment_id: null,
    payment_attempt_started_at: '2026-10-01T23:53:21.213Z', created_at: '2026-10-01T23:52:46.070Z',
    coupon_code: 'TEST-PIX', snapshot: { customer: { email: 'private@example.invalid' } },
};
const provider = {
    mp_order_id: mpOrderId, external_reference: order.order_number, total_amount: '50.00',
    currency_id: 'BRL', payment_count: 1, mp_payment_id: transactionId,
    transaction_amount: '50.00', order_status: 'processed', order_status_detail: 'accredited',
    transaction_status: 'processed', transaction_status_detail: 'accredited',
    mp_status: 'processed', mp_status_detail: 'accredited',
    payer: { email: 'private@example.invalid' }, access_token: 'never-return-this-token',
};
const evidence = {
    stock_items: [{ product_id: 'product-id', color_id: 'caramelo', size: 'P', purchased_quantity: 1,
        current_stock: 7, reservation_count: 1, restoration_movement_count: 0,
        reservation: { quantity: -1, previous_stock: 8, new_stock: 7, attribution: 'creation_time' } }],
    restorations: [], coupon_usages: [{ code: 'TEST-PIX', total_uses: 1 }],
    audit: [{ action: 'order.create' }], timeline: [], refund_in_flight: false,
};

function authorize(request) {
    let result = null;
    const res = { status(code) { result = code; return this; }, json() { return this; } };
    requireSupabaseAdmin(request, res, () => { result = 200; });
    return result;
}

test('preview requires a Supabase-validated admin, not an anonymous or Express JWT user', () => {
    assert.equal(authorize({}), 401);
    assert.equal(authorize({ user: { role: 'admin' }, authProvider: 'express' }), 401);
    assert.equal(authorize({ user: { role: 'customer' }, authProvider: 'supabase' }), 403);
    assert.equal(authorize({ user: { role: 'admin' }, authProvider: 'supabase' }), 200);
});

test('admin preview reads local evidence and official TEST order without writes or leaked secrets', async () => {
    const sql = [];
    const db = { async query(statement) {
        sql.push(statement);
        if (statement.startsWith('SELECT * FROM orders')) return { rows: [order] };
        if (statement.includes('FROM order_items')) return { rows: [{ id: 'item-id', product_id: 'product-id', color_id: 'caramelo', size: 'P', quantity: 1 }] };
        if (statement.includes('FROM products')) return { rows: [{ colors: [{ id: 'caramelo', stock: { P: 7 } }] }] };
        if (statement.includes('FROM stock_movements')) return { rows: [{ order_id: null, type: 'sale', quantity: -1, previous_stock: 8, new_stock: 7, created_at: order.created_at }] };
        if (statement.includes('FROM stock_restorations')) return { rows: [] };
        if (statement.includes('FROM coupon_usages cu')) return { rows: [{ code: 'TEST-PIX', total_uses: '1', created_at: order.created_at }] };
        if (statement.includes('FROM audit_logs')) return { rows: [{ action: 'order.create', created_at: order.created_at }] };
        if (statement.includes('FROM order_events')) return { rows: [] };
        if (statement.includes('to_regclass')) return { rows: [{ relation: null }] };
        throw new Error(`Unexpected query: ${statement}`);
    } };
    let reads = 0;
    const mercadoPago = {
        getMercadoPagoMode: () => 'test',
        getMercadoPagoReadiness: () => ({ webhook_configured: true, webhook_secret: 'never-return-this-secret' }),
        getOrderStatus: async id => { reads++; assert.equal(id, mpOrderId); return provider; },
    };
    const { preview } = await loadPaymentReconciliationPreview(db, mercadoPago, orderId, mpOrderId);
    assert.equal(reads, 1);
    assert.equal(preview.safe_to_reconcile, true);
    assert.equal(preview.integration.webhook_test_secret_configured, true);
    assert.equal(preview.local.stock[0].current_stock, 7);
    assert.equal(preview.local.coupon_usages.length, 1);
    assert.equal(preview.local.audit[0].action, 'order.create');
    assert.equal(sql.every(statement => /^SELECT\b/i.test(statement.trim())), true);
    const body = JSON.stringify(preview);
    for (const forbidden of ['never-return-this-token', 'never-return-this-secret', 'private@example.invalid', 'authorization', 'snapshot']) {
        assert.equal(body.includes(forbidden), false);
    }
    await assert.rejects(loadPaymentReconciliationPreview(db,
        { ...mercadoPago, getMercadoPagoMode: () => 'production' }, orderId, mpOrderId), { status: 409 });
});

test('preview blocks mismatched provider fields and an already approved local order', () => {
    const valid = buildPaymentReconciliationPreview(order, provider, evidence, true, mpOrderId);
    assert.equal(valid.safe_to_reconcile, true);
    for (const [changed, check] of [
        [{ external_reference: 'DH-OTHER' }, 'reference_match'],
        [{ total_amount: '50.01' }, 'amount_match'],
        [{ transaction_amount: '49.99' }, 'amount_match'],
        [{ currency_id: 'USD' }, 'currency_match'],
        [{ order_status_detail: 'pending' }, 'approved_at_provider'],
    ]) {
        const result = buildPaymentReconciliationPreview(order, { ...provider, ...changed }, evidence, true, mpOrderId);
        assert.equal(result.checks[check], false);
        assert.equal(result.safe_to_reconcile, false);
    }
    const paid = buildPaymentReconciliationPreview({ ...order, status: 'pagamento_aprovado', payment_status: 'approved', paid_at: new Date() }, provider, evidence, true, mpOrderId);
    assert.equal(paid.checks.local_pending, false);
    assert.equal(paid.safe_to_reconcile, false);
    assert.equal(buildPaymentReconciliationPreview(order, provider, { ...evidence, restorations: [{ source: 'cancellation' }] }, true, mpOrderId).safe_to_reconcile, false);
});

test('admin GET endpoint enforces 401/403 and returns a sanitized read-only preview', async () => {
    const previous = {
        query: pool.query, fetch: global.fetch,
        token: process.env.MERCADO_PAGO_ACCESS_TOKEN,
        mode: process.env.MERCADO_PAGO_MODE,
        secret: process.env.MERCADO_PAGO_WEBHOOK_SECRET,
    };
    process.env.MERCADO_PAGO_ACCESS_TOKEN = 'TEST-local-fixture';
    process.env.MERCADO_PAGO_MODE = 'test';
    process.env.MERCADO_PAGO_WEBHOOK_SECRET = 'fixture-secret-never-return';
    const statements = [];
    pool.query = async statement => {
        statements.push(statement);
        if (statement.startsWith('SELECT * FROM orders')) return { rows: [order] };
        if (statement.includes('FROM order_items')) return { rows: [{ id: 'item-id', product_id: 'product-id', color_id: 'caramelo', size: 'P', quantity: 1 }] };
        if (statement.includes('FROM products')) return { rows: [{ colors: [{ id: 'caramelo', stock: { P: 7 } }] }] };
        if (statement.includes('FROM stock_movements')) return { rows: [{ order_id: null, type: 'sale', quantity: -1, previous_stock: 8, new_stock: 7, created_at: order.created_at }] };
        if (statement.includes('FROM stock_restorations')) return { rows: [] };
        if (statement.includes('FROM coupon_usages cu')) return { rows: [{ code: 'TEST-PIX', total_uses: 1, created_at: order.created_at }] };
        if (statement.includes('FROM audit_logs')) return { rows: [{ action: 'order.create', created_at: order.created_at }] };
        if (statement.includes('FROM order_events')) return { rows: [] };
        if (statement.includes('to_regclass')) return { rows: [{ relation: null }] };
        throw new Error(`Unexpected SQL: ${statement}`);
    };
    let providerReads = 0;
    global.fetch = async (url, options) => {
        if (!String(url).startsWith('https://api.mercadopago.com/')) return previous.fetch(url, options);
        providerReads++;
        assert.equal(options.method || 'GET', 'GET');
        assert.equal(new URL(url).pathname, `/v1/orders/${mpOrderId}`);
        return { ok: true, json: async () => ({
            id: mpOrderId, external_reference: order.order_number, total_amount: '50.00', currency_id: 'BRL',
            status: 'processed', status_detail: 'accredited', payer: { email: 'private@example.invalid' },
            transactions: { payments: [{ id: transactionId, amount: '50.00', status: 'processed', status_detail: 'accredited' }] },
        }) };
    };
    const app = express();
    app.use((req, res, next) => {
        const role = req.headers['x-test-role'];
        if (role) { req.user = { role }; req.authProvider = 'supabase'; }
        next();
    });
    app.use('/api', orderRouter);
    const server = await new Promise(resolve => {
        const running = app.listen(0, '127.0.0.1', () => resolve(running));
    });
    try {
        const url = `http://127.0.0.1:${server.address().port}/api/admin/orders/${orderId}/payment-reconciliation-preview?mp_order_id=${mpOrderId}`;
        assert.equal((await previous.fetch(url)).status, 401);
        assert.equal((await previous.fetch(url, { headers: { 'x-test-role': 'customer' } })).status, 403);
        const response = await previous.fetch(url, { headers: { 'x-test-role': 'admin' } });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.safe_to_reconcile, true);
        assert.equal(body.provider.transaction_id, transactionId);
        assert.equal(body.integration.webhook_test_secret_configured, true);
        assert.equal(providerReads, 1);
        assert.equal(statements.every(statement => /^SELECT\b/i.test(statement.trim())), true);
        assert.equal(JSON.stringify(body).includes('fixture-secret-never-return'), false);
        assert.equal(JSON.stringify(body).includes('private@example.invalid'), false);
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        pool.query = previous.query;
        global.fetch = previous.fetch;
        for (const [key, value] of [['MERCADO_PAGO_ACCESS_TOKEN', previous.token], ['MERCADO_PAGO_MODE', previous.mode], ['MERCADO_PAGO_WEBHOOK_SECRET', previous.secret]]) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    }
});
