import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import afterSalesRoutes from '../src/routes/afterSales.js';
import { reconcileRefundFromWebhook, requestRefund } from '../src/afterSalesService.js';
import { findIdempotentRefund, planRefund, requestedRefundCents } from '../src/lib/afterSalesPolicy.js';
import { buildRefundPreview, loadRefundPreview } from '../src/lib/refundPreview.js';

const order = {
    id: 'local-1', order_number: 'DH-2026-000006', total: '50.00',
    payment_provider: 'mercado_pago', payment_status: 'approved',
    mercado_pago_order_id: 'ORDTST01M3WY62VJNVEVXATHY3CRDVHW',
    mercado_pago_payment_id: 'PAY01M3WY62W216W8V5J7XA7JD5JJ',
    paid_at: '2026-10-02', status: 'pagamento_aprovado',
};
const remote = {
    id: order.mercado_pago_order_id, external_reference: order.order_number, total_amount: '50.00',
    currency: 'BRL', status: 'processed',
    payment: { id: order.mercado_pago_payment_id, amount: '50.00', status: 'processed' }, refunds: [],
};

test('one real is planned in integer cents; zero, negative, over balance and cumulative over paid are rejected', () => {
    assert.equal(planRefund(order, remote, [], 'partial', [], [], 100), 100);
    for (const value of [0, -1, 1.5, '100', NaN]) {
        assert.throws(() => requestedRefundCents(value), { status: 400 });
    }
    assert.throws(() => planRefund(order, remote, [], 'partial', [], [], 5001));
    const refunded = [{ amount: '49.50', status: 'processed' }];
    assert.throws(() => planRefund(order, { ...remote, refunds: [{ id: 'REF-1' }] }, refunded,
        'partial', [], [], 100));
    assert.throws(() => planRefund(order, remote, [{ amount: '50.01', status: 'processed' }],
        'partial', [], [], 1));
});

test('same idempotency key binds to one amount; in-flight reservation rejects competing request', () => {
    const reserved = { idempotency_key: 'partial-operation-1', kind: 'partial', reason: 'TEST R$ 1,00',
        selected_items: [], return_id: null, amount: '1.00', status: 'reserved' };
    assert.equal(findIdempotentRefund([reserved], 'partial-operation-1', 'partial',
        'TEST R$ 1,00', [], null, 100), reserved);
    assert.throws(() => findIdempotentRefund([reserved], 'partial-operation-1', 'partial',
        'TEST R$ 1,00', [], null, 200));
    assert.throws(() => planRefund(order, remote, [reserved], 'partial', [], [], 100));
});

test('overlapping refund requests reserve one operation and issue one Orders API POST', async () => {
    const priorFlag = process.env.AFTER_SALES_REFUNDS_ENABLED;
    const priorMode = process.env.MERCADO_PAGO_MODE;
    process.env.AFTER_SALES_REFUNDS_ENABLED = 'true';
    process.env.MERCADO_PAGO_MODE = 'test';
    const ledger = [];
    let providerPosts = 0;
    let postCompleted = false;
    let signalStarted;
    const started = new Promise(resolve => { signalStarted = resolve; });
    let releasePost;
    const holdPost = new Promise(resolve => { releasePost = resolve; });
    const provider = {
        getRefundableOrder: async () => postCompleted ? { ...remote, refunds: [{
            id: 'REF-1', transaction_id: order.mercado_pago_payment_id,
            amount: '1.00', status: 'processed',
        }] } : remote,
        refundOrder: async input => {
            providerPosts++;
            assert.equal(input.amount, 100);
            assert.equal(input.mpPaymentId, order.mercado_pago_payment_id);
            assert.equal(input.idempotencyKey, 'refund-local-refund');
            signalStarted();
            await holdPost;
            postCompleted = true;
            return { id: order.mercado_pago_order_id };
        },
    };
    const client = { query: async (sql, values) => {
        if (sql.includes('SELECT * FROM orders')) return { rows: [order] };
        if (sql.includes('SELECT * FROM order_refunds WHERE order_id')) return { rows: [...ledger] };
        if (sql.includes('SELECT * FROM order_refunds WHERE id')) return { rows: [ledger[0]] };
        if (sql.includes('FROM order_items')) return { rows: [] };
        if (sql.includes('INSERT INTO order_refunds')) {
            const saved = { id: 'local-refund', order_id: order.id,
                idempotency_key: values[1], kind: values[2], amount: values[3],
                status: 'reserved', provider_order_id: values[4], provider_payment_id: values[5],
                reason: values[6], actor_id: values[7], selected_items: [], return_id: null };
            ledger.push(saved);
            return { rows: [saved] };
        }
        if (sql.includes('UPDATE order_refunds')) {
            ledger[0].status = values[0];
            ledger[0].provider_refund_id = values[1];
            return { rows: [ledger[0]] };
        }
        if (sql.includes('SELECT amount FROM order_refunds')) return { rows: [{ amount: '1.00' }] };
        return { rows: [] };
    } };
    const db = { query: async () => ({ rows: [order] }) };
    const persistence = { db, transaction: callback => callback(client) };
    const input = { kind: 'partial', amount_cents: 100, reason: 'TEST R$ 1,00' };
    try {
        const first = requestRefund(order.id, 'admin-1', input, 'operation-one', provider, persistence);
        await started;
        const duplicate = await requestRefund(order.id, 'admin-1', input, 'operation-one', provider, persistence);
        assert.equal(duplicate.id, 'local-refund');
        await assert.rejects(requestRefund(order.id, 'admin-1', input, 'operation-two', provider, persistence),
            { status: 409 });
        releasePost();
        const result = await first;
        assert.equal(result.status, 'processed');
        assert.equal(providerPosts, 1);
        assert.equal(ledger.length, 1);
    } finally {
        releasePost();
        if (priorFlag === undefined) delete process.env.AFTER_SALES_REFUNDS_ENABLED;
        else process.env.AFTER_SALES_REFUNDS_ENABLED = priorFlag;
        if (priorMode === undefined) delete process.env.MERCADO_PAGO_MODE;
        else process.env.MERCADO_PAGO_MODE = priorMode;
    }
});

test('preview is read-only, refetches official TEST order and reports financial and physical state', async () => {
    const statements = [];
    let remoteReads = 0;
    const db = { query: async (sql) => {
        statements.push(sql);
        if (sql.includes('FROM orders')) return { rows: [order] };
        if (sql.includes('FROM order_refunds')) return { rows: [] };
        if (sql.includes('FROM order_returns')) return { rows: [] };
        if (sql.includes('FROM stock_restorations')) return { rows: [] };
        if (sql.includes('FROM order_items')) return { rows: [{ product_id: 'product-1', color_id: 'black', size: 'M' }] };
        if (sql.includes('FROM products')) return { rows: [{ colors: [{ id: 'black', stock: { M: 7 } }] }] };
        throw new Error('unexpected query');
    } };
    const provider = { getRefundableOrder: async () => { remoteReads++; return remote; },
        getMercadoPagoMode: () => 'test' };
    const prior = process.env.AFTER_SALES_REFUNDS_ENABLED;
    process.env.AFTER_SALES_REFUNDS_ENABLED = 'false';
    try {
        const preview = await loadRefundPreview(order.id, 100, db, provider);
        assert.equal(remoteReads, 1);
        assert.equal(statements.every(sql => /^SELECT /i.test(sql)), true);
        assert.equal(preview.paid_amount_cents, 5000);
        assert.equal(preview.already_refunded_cents, 0);
        assert.equal(preview.refundable_balance_cents, 5000);
        assert.equal(preview.requested_refund_cents, 100);
        assert.equal(preview.remaining_balance_cents, 4900);
        assert.equal(preview.mp_transaction_id, order.mercado_pago_payment_id);
        assert.equal(preview.stock[0].quantity, 7);
        assert.deepEqual(preview.return_status, []);
        assert.equal(preview.stock_change, 0);
        assert.equal(preview.return_created, false);
        assert.equal(preview.safe_to_partial_refund, false);
        assert.equal(preview.checks.refunds_enabled, false);
        assert.equal(JSON.stringify(preview).includes('secret'), false);
    } finally {
        if (prior === undefined) delete process.env.AFTER_SALES_REFUNDS_ENABLED;
        else process.env.AFTER_SALES_REFUNDS_ENABLED = prior;
    }
});

test('preview blocks provider mismatch, untracked refunds, in-flight refund, and production mode', () => {
    const stock = [{ quantity: 7 }];
    const baseline = buildRefundPreview(order, remote, [], [], stock, [], 100, 'test', true);
    assert.equal(baseline.safe_to_partial_refund, true);
    assert.equal(buildRefundPreview(order, { ...remote, external_reference: 'OTHER' }, [], [], stock, [], 100, 'test', true).safe_to_partial_refund, false);
    assert.equal(buildRefundPreview(order, { ...remote, refunds: [{ id: 'REF-1', transaction_id: order.mercado_pago_payment_id, amount: '1.00', status: 'processed' }] }, [], [], stock, [], 100, 'test', true).safe_to_partial_refund, false);
    assert.equal(buildRefundPreview(order, remote, [{ amount: '1.00', status: 'reserved' }], [], stock, [], 100, 'test', true).safe_to_partial_refund, false);
    assert.equal(buildRefundPreview(order, remote, [], [], stock, [], 100, 'production', true).safe_to_partial_refund, false);
    assert.equal(buildRefundPreview(order, remote, [], [], stock, [{ id: 'restored' }], 100, 'test', true).safe_to_partial_refund, false);
});

test('production and disabled flag prevent any provider refund call', async () => {
    const priorMode = process.env.MERCADO_PAGO_MODE;
    const priorFlag = process.env.AFTER_SALES_REFUNDS_ENABLED;
    const provider = { getRefundableOrder: () => { throw new Error('must not call provider'); },
        refundOrder: () => { throw new Error('must not refund'); } };
    try {
        process.env.AFTER_SALES_REFUNDS_ENABLED = 'true';
        process.env.MERCADO_PAGO_MODE = 'production';
        await assert.rejects(requestRefund(order.id, 'admin', { kind: 'partial', amount_cents: 100,
            reason: 'TEST R$ 1,00' }, 'partial-operation-1', provider), { status: 409 });
        process.env.MERCADO_PAGO_MODE = 'test';
        process.env.AFTER_SALES_REFUNDS_ENABLED = 'false';
        await assert.rejects(requestRefund(order.id, 'admin', { kind: 'partial', amount_cents: 100,
            reason: 'TEST R$ 1,00' }, 'partial-operation-1', provider), { status: 503 });
    } finally {
        if (priorMode === undefined) delete process.env.MERCADO_PAGO_MODE;
        else process.env.MERCADO_PAGO_MODE = priorMode;
        if (priorFlag === undefined) delete process.env.AFTER_SALES_REFUNDS_ENABLED;
        else process.env.AFTER_SALES_REFUNDS_ENABLED = priorFlag;
    }
});

test('signed webhook reconciliation trusts official refund, records one financial update, and never changes stock or returns', async () => {
    const queries = [];
    const refund = {
        id: 'local-refund', order_id: order.id, amount: '1.00', status: 'reserved',
        provider_order_id: order.mercado_pago_order_id,
        provider_payment_id: order.mercado_pago_payment_id,
        actor_id: 'admin-1', reason: 'TEST R$ 1,00',
    };
    const db = { query: async sql => {
        queries.push(sql);
        if (sql.includes("status IN ('reserved'")) return { rows: refund.status === 'processed' ? [] : [refund] };
        if (sql.includes('id <>')) return { rows: [] };
        if (sql.includes('FROM orders')) return { rows: [order] };
        throw new Error(`unexpected query: ${sql}`);
    } };
    const client = { query: async sql => {
        queries.push(sql);
        if (sql.includes('SELECT * FROM order_refunds')) return { rows: [refund] };
        if (sql.includes('SELECT * FROM orders')) return { rows: [order] };
        if (sql.includes('UPDATE order_refunds')) {
            refund.status = 'processed';
            refund.provider_refund_id = 'REF-1';
            return { rows: [refund] };
        }
        if (sql.includes('SELECT amount FROM order_refunds')) return { rows: [{ amount: refund.amount }] };
        return { rows: [] };
    } };
    const official = { ...remote, refunds: [{ id: 'REF-1',
        transaction_id: order.mercado_pago_payment_id, amount: '1.00', status: 'processed' }] };
    const provider = { getRefundableOrder: async () => official };
    const transaction = callback => callback(client);
    const outcome = await reconcileRefundFromWebhook(order.id, order.mercado_pago_order_id,
        provider, db, transaction);
    assert.equal(outcome.status, 'processed');
    assert.equal(refund.provider_refund_id, 'REF-1');
    assert.equal(queries.some(sql => sql.includes("payment_status = $1")), true);
    assert.equal(queries.some(sql => /\b(stock_movements|stock_restorations|order_returns|products)\b/i.test(sql)), false);
    assert.equal(await reconcileRefundFromWebhook(order.id, order.mercado_pago_order_id,
        provider, db, transaction), null);
    assert.equal(queries.filter(sql => sql.includes('UPDATE order_refunds')).length, 1);
});

test('non-admin cannot access refund preview or mutation', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: 'customer', role: 'customer' }; next(); });
    app.use('/api', afterSalesRoutes);
    const server = await new Promise(resolve => {
        const running = app.listen(0, '127.0.0.1', () => resolve(running));
    });
    try {
        const base = `http://127.0.0.1:${server.address().port}/api/orders/${order.id}/refunds`;
        assert.equal((await fetch(`${base}/preview?amount_cents=100`)).status, 403);
        assert.equal((await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'partial', amount_cents: 100, reason: 'TEST R$ 1,00' }) })).status, 403);
    } finally { await new Promise(resolve => server.close(resolve)); }
});
