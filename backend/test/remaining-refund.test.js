import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import afterSalesRoutes from '../src/routes/afterSales.js';
import { requestRefund, reconcileRefundFromWebhook } from '../src/afterSalesService.js';
import { planRefund } from '../src/lib/afterSalesPolicy.js';
import { buildRefundPreview, loadRefundPreview } from '../src/lib/refundPreview.js';

const order = {
    id: 'local-1', order_number: 'DH-2026-000006', total: '50.00',
    payment_provider: 'mercado_pago', payment_status: 'partially_refunded',
    mercado_pago_order_id: 'ORDTST01M3WY62VJNVEVXATHY3CRDVHW',
    mercado_pago_payment_id: 'PAY01M3WY62W216W8V5J7XA7JD5JJ',
    paid_at: '2026-10-02', status: 'pagamento_aprovado',
};
const prior = {
    id: 'local-first', order_id: order.id, idempotency_key: 'first-partial-key', kind: 'partial',
    amount: '1.00', status: 'processed', provider_refund_id: 'REF-FIRST',
    provider_order_id: order.mercado_pago_order_id, provider_payment_id: order.mercado_pago_payment_id,
    selected_items: [], return_id: null,
};
const providerPrior = { id: 'REF-FIRST', transaction_id: order.mercado_pago_payment_id,
    amount: '1.00', status: 'processed' };
const providerRemaining = { id: 'REF-REMAINING', transaction_id: order.mercado_pago_payment_id,
    amount: '49.00', status: 'processed' };
const official = {
    id: order.mercado_pago_order_id, external_reference: order.order_number,
    total_amount: '50.00', currency: 'BRL', status: 'processed',
    payment: { id: order.mercado_pago_payment_id, amount: '50.00', status: 'processed' },
    refunds: [providerPrior],
};
const stock = [{ size: 'M', quantity: 7 }];

test('remaining is 5000 minus 100 cents, and pending or overpaid ledgers block', () => {
    assert.equal(planRefund(order, official, [prior], 'remaining', [], []), 4900);
    for (const status of ['reserved', 'processing', 'reconciliation_required']) {
        assert.throws(() => planRefund(order, official, [prior, { status }], 'remaining', [], []));
    }
    assert.throws(() => planRefund(order, official, [prior, { status: 'processed', amount: '49.01' }],
        'remaining', [], []));
    assert.throws(() => planRefund(order, official, [prior, { status: 'processed', amount: '49.00' }],
        'remaining', [], []));
});

test('read-only preview refetches Orders API and reports the exact financial and physical baseline', async () => {
    const statements = [];
    let officialGets = 0;
    const db = { query: async sql => {
        statements.push(sql);
        if (sql.includes('FROM orders')) return { rows: [order] };
        if (sql.includes('FROM order_refunds')) return { rows: [prior] };
        if (sql.includes('FROM order_returns') || sql.includes('FROM stock_restorations')) return { rows: [] };
        if (sql.includes('FROM order_items')) return { rows: [{ product_id: 'product-1', color_id: 'black', size: 'M' }] };
        if (sql.includes('FROM products')) return { rows: [{ colors: [{ id: 'black', stock: { M: 7 } }] }] };
        throw new Error(`unexpected query: ${sql}`);
    } };
    const provider = { getRefundableOrder: async () => { officialGets++; return official; },
        getMercadoPagoMode: () => 'test' };
    const oldFlag = process.env.AFTER_SALES_REFUNDS_ENABLED;
    process.env.AFTER_SALES_REFUNDS_ENABLED = 'false';
    try {
        const preview = await loadRefundPreview(order.id, db, provider);
        assert.equal(officialGets, 1);
        assert.equal(statements.every(sql => /^SELECT /i.test(sql)), true);
        assert.deepEqual([
            preview.paid_amount_cents, preview.already_refunded_cents,
            preview.refundable_balance_cents, preview.requested_refund_cents,
            preview.remaining_balance_cents, preview.provider_refund_count, preview.local_refund_count,
        ], [5000, 100, 4900, 4900, 0, 1, 1]);
        assert.equal(preview.existing_refunds[0].id, 'local-first');
        assert.equal(preview.existing_refunds[0].provider_refund_id, 'REF-FIRST');
        assert.equal(preview.existing_refunds[0].status, 'processed');
        assert.deepEqual(preview.provider_refunds, [{ id: 'REF-FIRST', amount_cents: 100,
            status: 'processed', transaction_id: order.mercado_pago_payment_id }]);
        assert.equal(preview.provider_total_refunded_cents, 100);
        assert.equal(preview.local_total_refunded_cents, 100);
        assert.equal(preview.ledger_match, true);
        assert.equal(preview.checks.provider_ledger_matches, true);
        assert.equal(preview.refund_in_progress, false);
        assert.equal(preview.reconciliation_required, false);
        assert.equal(preview.stock[0].quantity, 7);
        assert.deepEqual(preview.return_status, []);
        assert.deepEqual(preview.stock_restorations, []);
        assert.equal(preview.safe_to_refund_remaining, false);
        assert.equal(preview.only_blocker_is_flag, true);
        assert.equal(preview.checks.refunds_enabled, false);
    } finally {
        if (oldFlag === undefined) delete process.env.AFTER_SALES_REFUNDS_ENABLED;
        else process.env.AFTER_SALES_REFUNDS_ENABLED = oldFlag;
    }
});

test('preview blocks mismatched ledger, pending refund, scope, mode and physical changes', () => {
    const preview = (o = order, p = official, l = [prior], r = [], s = stock, x = [], mode = 'test') =>
        buildRefundPreview(o, p, l, r, s, x, mode, true);
    assert.equal(preview().safe_to_refund_remaining, true);
    assert.equal(preview(order, { ...official, refunds: [] }).checks.provider_ledger_matches, false);
    assert.equal(buildRefundPreview(order, { ...official, refunds: [] }, [prior], [], stock, [], 'test', false)
        .only_blocker_is_flag, false);
    assert.equal(preview(order, { ...official, refunds: [{ ...providerPrior, amount: '2.00' }] }).safe_to_refund_remaining, false);
    assert.equal(preview(order, official, [{ ...prior, amount: '2.00' }]).safe_to_refund_remaining, false);
    assert.equal(preview(order, official, [prior, { status: 'reserved', amount: '49.00' }]).safe_to_refund_remaining, false);
    assert.equal(preview({ ...order, order_number: 'OTHER' }).safe_to_refund_remaining, false);
    assert.equal(preview({ ...order, total: '50.01' }).safe_to_refund_remaining, false);
    assert.equal(preview(order, official, [prior], [], stock, [], 'production').safe_to_refund_remaining, false);
    assert.equal(preview(order, official, [prior], [{ status: 'recebida' }]).safe_to_refund_remaining, false);
    assert.equal(preview(order, official, [prior], [], [{ quantity: 8 }]).safe_to_refund_remaining, false);
    assert.equal(preview(order, official, [prior], [], stock, [{ id: 'restored' }]).safe_to_refund_remaining, false);
});

test('remaining POST is server-derived, idempotent and ends refunded without physical writes', async () => {
    const oldFlag = process.env.AFTER_SALES_REFUNDS_ENABLED;
    const oldMode = process.env.MERCADO_PAGO_MODE;
    process.env.AFTER_SALES_REFUNDS_ENABLED = 'true';
    process.env.MERCADO_PAGO_MODE = 'test';
    const localOrder = { ...order };
    const ledger = [{ ...prior }];
    const queries = [];
    let posts = 0;
    let posted = false;
    let startPost;
    const postStarted = new Promise(resolve => { startPost = resolve; });
    let finishPost;
    const postHold = new Promise(resolve => { finishPost = resolve; });
    const provider = {
        getRefundableOrder: async () => posted
            ? { ...official, refunds: [providerPrior, providerRemaining] } : official,
        refundOrder: async input => {
            posts++;
            assert.equal(input.amount, 4900);
            assert.equal(input.full, false);
            assert.equal(input.mpPaymentId, order.mercado_pago_payment_id);
            assert.equal(input.idempotencyKey, 'refund-local-remaining');
            startPost();
            await postHold;
            posted = true;
            return { id: order.mercado_pago_order_id };
        },
    };
    const client = { query: async (sql, values) => {
        queries.push(sql);
        if (sql.includes('SELECT * FROM orders')) return { rows: [localOrder] };
        if (sql.includes('SELECT * FROM order_refunds WHERE order_id')) return { rows: [...ledger] };
        if (sql.includes('SELECT * FROM order_refunds WHERE id')) return { rows: [ledger[1]] };
        if (sql.includes('FROM order_returns') || sql.includes('FROM stock_restorations')) return { rows: [] };
        if (sql.includes('FROM order_items')) return { rows: [{ product_id: 'product-1', color_id: 'black', size: 'M' }] };
        if (sql.includes('FROM products')) return { rows: [{ colors: [{ id: 'black', stock: { M: 7 } }] }] };
        if (sql.includes('INSERT INTO order_refunds')) {
            const saved = { id: 'local-remaining', order_id: order.id,
                idempotency_key: values[1], kind: values[2], amount: values[3], status: 'reserved',
                provider_order_id: values[4], provider_payment_id: values[5], reason: values[6],
                actor_id: values[7], selected_items: [], return_id: null };
            ledger.push(saved);
            return { rows: [saved] };
        }
        if (sql.includes('UPDATE order_refunds')) {
            ledger[1].status = values[0];
            ledger[1].provider_refund_id = values[1];
            return { rows: [ledger[1]] };
        }
        if (sql.includes('SELECT amount FROM order_refunds')) return { rows: ledger.filter(row => row.status === 'processed') };
        if (sql.includes('UPDATE orders SET payment_status')) localOrder.payment_status = values[0];
        return { rows: [] };
    } };
    const db = { query: async sql => { queries.push(sql); return { rows: [localOrder] }; } };
    const persistence = { db, transaction: callback => callback(client) };
    const request = { kind: 'remaining', reason: 'Saldo restante TEST' };
    try {
        const first = requestRefund(order.id, 'admin', request, 'remaining-operation-1', provider, persistence);
        await postStarted;
        assert.equal((await requestRefund(order.id, 'admin', request,
            'remaining-operation-1', provider, persistence)).id, 'local-remaining');
        await assert.rejects(requestRefund(order.id, 'admin', request,
            'remaining-operation-2', provider, persistence), { status: 409 });
        finishPost();
        assert.equal((await first).status, 'processed');
        assert.equal(localOrder.payment_status, 'refunded');
        assert.equal(ledger.length, 2);
        assert.equal(ledger.reduce((sum, row) => sum + Number(row.amount), 0), 50);
        assert.equal((await requestRefund(order.id, 'admin', request,
            'remaining-operation-1', provider, persistence)).id, 'local-remaining');
        await assert.rejects(requestRefund(order.id, 'admin', request,
            'remaining-operation-2', provider, persistence), { status: 409 });
        assert.equal(posts, 1);
        assert.equal(queries.some(sql => /\b(INSERT INTO|UPDATE|DELETE FROM)\s+(stock_movements|stock_restorations|order_returns|products)\b/i.test(sql)), false);
    } finally {
        finishPost();
        if (oldFlag === undefined) delete process.env.AFTER_SALES_REFUNDS_ENABLED;
        else process.env.AFTER_SALES_REFUNDS_ENABLED = oldFlag;
        if (oldMode === undefined) delete process.env.MERCADO_PAGO_MODE;
        else process.env.MERCADO_PAGO_MODE = oldMode;
    }
});

test('flag, production mode, and client supplied amount block before provider access', async () => {
    const oldFlag = process.env.AFTER_SALES_REFUNDS_ENABLED;
    const oldMode = process.env.MERCADO_PAGO_MODE;
    const provider = { getRefundableOrder: () => { throw new Error('unexpected GET'); },
        refundOrder: () => { throw new Error('unexpected POST'); } };
    try {
        process.env.AFTER_SALES_REFUNDS_ENABLED = 'false';
        process.env.MERCADO_PAGO_MODE = 'test';
        await assert.rejects(requestRefund(order.id, 'admin', { kind: 'remaining', reason: 'Saldo TEST' },
            'remaining-operation', provider), { status: 503 });
        process.env.AFTER_SALES_REFUNDS_ENABLED = 'true';
        process.env.MERCADO_PAGO_MODE = 'production';
        await assert.rejects(requestRefund(order.id, 'admin', { kind: 'remaining', reason: 'Saldo TEST' },
            'remaining-operation', provider), { status: 409 });
        process.env.MERCADO_PAGO_MODE = 'test';
        for (const request of [
            { kind: 'remaining', reason: 'Saldo TEST', amount_cents: 4900 },
            { kind: 'partial', reason: 'Saldo TEST', amount_cents: 100 },
            { kind: 'remaining', reason: 'Saldo TEST', return_id: 'return-1' },
            { kind: 'remaining', reason: 'Saldo TEST', items: [] },
        ]) await assert.rejects(requestRefund(order.id, 'admin', request,
            'remaining-operation', provider), { status: 409 });
    } finally {
        if (oldFlag === undefined) delete process.env.AFTER_SALES_REFUNDS_ENABLED;
        else process.env.AFTER_SALES_REFUNDS_ENABLED = oldFlag;
        if (oldMode === undefined) delete process.env.MERCADO_PAGO_MODE;
        else process.env.MERCADO_PAGO_MODE = oldMode;
    }
});

test('request blocks a different order and provider ledger divergence before any refund POST', async () => {
    const oldFlag = process.env.AFTER_SALES_REFUNDS_ENABLED;
    const oldMode = process.env.MERCADO_PAGO_MODE;
    process.env.AFTER_SALES_REFUNDS_ENABLED = 'true';
    process.env.MERCADO_PAGO_MODE = 'test';
    let posts = 0;
    const request = { kind: 'remaining', reason: 'Saldo restante TEST' };
    const provider = { getRefundableOrder: async () => ({ ...official, refunds: [] }),
        refundOrder: async () => { posts++; } };
    const client = { query: async sql => {
        if (sql.includes('FROM orders')) return { rows: [order] };
        if (sql.includes('FROM order_refunds')) return { rows: [prior] };
        throw new Error(`unexpected query: ${sql}`);
    } };
    const persistence = { db: { query: async () => ({ rows: [order] }) },
        transaction: callback => callback(client) };
    try {
        await assert.rejects(requestRefund(order.id, 'admin', request,
            'remaining-operation', provider, persistence), { status: 409 });
        assert.equal(posts, 0);
        persistence.db.query = async () => ({ rows: [{ ...order, order_number: 'OTHER' }] });
        await assert.rejects(requestRefund(order.id, 'admin', request,
            'remaining-operation', provider, persistence), { status: 409 });
        assert.equal(posts, 0);
    } finally {
        if (oldFlag === undefined) delete process.env.AFTER_SALES_REFUNDS_ENABLED;
        else process.env.AFTER_SALES_REFUNDS_ENABLED = oldFlag;
        if (oldMode === undefined) delete process.env.MERCADO_PAGO_MODE;
        else process.env.MERCADO_PAGO_MODE = oldMode;
    }
});

test('webhook reconciliation uses a fresh official GET once and leaves physical state alone', async () => {
    const queries = [];
    const pending = { id: 'local-remaining', order_id: order.id, amount: '49.00', status: 'reserved',
        provider_order_id: order.mercado_pago_order_id, provider_payment_id: order.mercado_pago_payment_id,
        actor_id: 'admin', reason: 'Saldo restante TEST' };
    const localOrder = { ...order };
    const db = { query: async sql => {
        queries.push(sql);
        if (sql.includes("status IN ('reserved'")) return { rows: pending.status === 'processed' ? [] : [pending] };
        if (sql.includes('id <>')) return { rows: [prior] };
        if (sql.includes('FROM orders')) return { rows: [localOrder] };
        throw new Error(`unexpected query: ${sql}`);
    } };
    const client = { query: async (sql, values) => {
        queries.push(sql);
        if (sql.includes('SELECT * FROM order_refunds')) return { rows: [pending] };
        if (sql.includes('SELECT * FROM orders')) return { rows: [localOrder] };
        if (sql.includes('UPDATE order_refunds')) {
            pending.status = 'processed'; pending.provider_refund_id = 'REF-REMAINING';
            return { rows: [pending] };
        }
        if (sql.includes('SELECT amount FROM order_refunds')) return { rows: [prior, pending] };
        if (sql.includes('UPDATE orders SET payment_status')) localOrder.payment_status = values[0];
        return { rows: [] };
    } };
    const provider = { getRefundableOrder: async () => ({ ...official,
        refunds: [providerPrior, providerRemaining] }) };
    const transaction = callback => callback(client);
    assert.equal((await reconcileRefundFromWebhook(order.id, order.mercado_pago_order_id,
        provider, db, transaction)).status, 'processed');
    assert.equal(localOrder.payment_status, 'refunded');
    assert.equal(await reconcileRefundFromWebhook(order.id, order.mercado_pago_order_id,
        provider, db, transaction), null);
    assert.equal(queries.filter(sql => sql.includes('UPDATE order_refunds')).length, 1);
    assert.equal(queries.some(sql => /\b(stock_movements|stock_restorations|order_returns|products)\b/i.test(sql)), false);
});

test('non-admin cannot access remaining preview or mutation', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: 'customer', role: 'customer' }; next(); });
    app.use('/api', afterSalesRoutes);
    const server = await new Promise(resolve => {
        const running = app.listen(0, '127.0.0.1', () => resolve(running));
    });
    try {
        const base = `http://127.0.0.1:${server.address().port}/api/orders/${order.id}/refunds`;
        assert.equal((await fetch(`${base}/preview`)).status, 403);
        assert.equal((await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'remaining', reason: 'Saldo TEST' }) })).status, 403);
    } finally { await new Promise(resolve => server.close(resolve)); }
});
