import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { cancelPendingOrder, refundOrder } from '../src/services/mercadoPago.js';
import afterSalesRoutes from '../src/routes/afterSales.js';
import orderRoutes from '../src/routes/orders.js';
import {
    assertFulfillmentTransition, assertRefundableOrder, canCancelAfterRefund, canCancelWithoutRefund,
    findIdempotentRefund, nextReturnStatus, planRefund, shouldApplyProviderPayment,
} from '../src/lib/afterSalesPolicy.js';
import { restoreStock } from '../src/afterSalesService.js';

const order = {
    id: 'order-1', order_number: 'DH-TEST', total: '100.00', subtotal: '100.00',
    discount: '0.00', payment_provider: 'mercado_pago', payment_status: 'approved',
    mercado_pago_order_id: 'ORD-1', mercado_pago_payment_id: 'PAY-1',
    paid_at: '2026-01-01', status: 'pagamento_aprovado',
};
const remote = {
    id: 'ORD-1', external_reference: 'DH-TEST', total_amount: '100.00',
    currency: 'BRL', payment: { id: 'PAY-1', status: 'approved' }, refunds: [],
};
const items = [
    { id: 'item-1', unit_price: '40.00', quantity: 1 },
    { id: 'item-2', unit_price: '60.00', quantity: 1 },
];

test('full refund is server-derived and requires the exact paid MP order', () => {
    assert.equal(planRefund(order, remote, [], 'full', [], items), 10000);
    for (const changed of [
        { id: 'OTHER' }, { external_reference: 'OTHER' }, { total_amount: '99.00' },
        { currency: 'USD' }, { payment: { id: 'OTHER', status: 'approved' } },
    ]) assert.throws(() => assertRefundableOrder(order, { ...remote, ...changed }));
    assert.throws(() => planRefund({ ...order, status: 'cancelado' }, remote, [], 'full', [], items));
});

test('partial refund amount comes from purchased items; cumulative total cannot exceed payment', () => {
    const selection = [{ order_item_id: 'item-1', quantity: 1 }];
    assert.equal(planRefund(order, remote, [], 'partial', selection, items), 4000);
    const prior = [{ status: 'processed', amount: '40.00', selected_items: selection }];
    assert.equal(planRefund(order, remote, prior, 'partial', [{ order_item_id: 'item-2', quantity: 1 }], items), 6000);
    assert.equal(planRefund(order, remote, prior, 'remaining', [], items), 6000);
    assert.throws(() => planRefund(order, remote, prior, 'partial', selection, items));
    assert.throws(() => planRefund(order, remote, [{ status: 'processed', amount: '90.00', selected_items: [] }],
        'partial', [{ order_item_id: 'item-2', quantity: 1 }], items));
    assert.throws(() => planRefund(order, remote, prior, 'full', [], items));
});

test('duplicate refund key returns the same reservation and never plans another POST', () => {
    const selection = [{ order_item_id: 'item-1', quantity: 1 }];
    const existing = { idempotency_key: 'refund-key-1', kind: 'partial', reason: 'Produto devolvido',
        selected_items: selection, return_id: null, status: 'processing' };
    assert.equal(findIdempotentRefund([existing], 'refund-key-1', 'partial',
        'Produto devolvido', selection, null), existing);
    assert.throws(() => findIdempotentRefund([existing], 'refund-key-1', 'full',
        'Produto devolvido', [], null));
    assert.throws(() => planRefund(order, remote, [existing], 'partial', selection, items));
});

test('Orders API sends no body for full refund and only trusted transaction amount for partial', async () => {
    const oldFetch = global.fetch;
    const oldToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    process.env.MERCADO_PAGO_ACCESS_TOKEN = 'local-mock-only';
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url, options });
        return { ok: true, json: async () => ({ id: 'ORD-1', transactions: { refunds: [] } }) };
    };
    try {
        await refundOrder({ mpOrderId: 'ORD-1', mpPaymentId: 'PAY-1', amount: 10000,
            full: true, idempotencyKey: 'refund-one' });
        await refundOrder({ mpOrderId: 'ORD-1', mpPaymentId: 'PAY-1', amount: 4000,
            full: false, idempotencyKey: 'refund-two' });
        assert.equal(calls.length, 2);
        assert.equal(calls[0].url, 'https://api.mercadopago.com/v1/orders/ORD-1/refund');
        assert.equal(calls[0].options.body, undefined);
        assert.equal(calls[0].options.headers['X-Idempotency-Key'], 'refund-one');
        assert.deepEqual(JSON.parse(calls[1].options.body),
            { transactions: [{ id: 'PAY-1', amount: '40.00' }] });
        assert.equal(calls[1].options.headers['X-Idempotency-Key'], 'refund-two');
    } finally {
        global.fetch = oldFetch;
        if (oldToken === undefined) delete process.env.MERCADO_PAGO_ACCESS_TOKEN;
        else process.env.MERCADO_PAGO_ACCESS_TOKEN = oldToken;
    }
});

test('stock is restored only once per item and never beyond purchased quantity', async () => {
    let stock = 2;
    let insertions = 0;
    const client = { query: async (sql) => {
        if (sql.includes('INSERT INTO stock_restorations')) {
            insertions++;
            return { rows: insertions === 1 ? [{ id: 'restore-1' }] : [] };
        }
        if (sql.includes('FROM stock_restorations')) return { rows: [{ quantity: 0 }] };
        if (sql.includes('SELECT colors FROM products')) return { rows: [{ colors: [
            { id: 'color-1', stock: { M: stock } },
        ] }] };
        if (sql.includes('UPDATE products')) { stock++; return { rows: [] }; }
        return { rows: [] };
    } };
    const item = { id: 'item-1', product_id: 'product-1', color_id: 'color-1', size: 'M', quantity: 1 };
    assert.equal(await restoreStock(client, order, item, 1, 'cancellation'), true);
    assert.equal(await restoreStock(client, order, item, 1, 'cancellation'), false);
    assert.equal(stock, 3);
    assert.equal(insertions, 2);
});

test('receiving the same return twice cannot restock twice', async () => {
    let stock = 3;
    let created = false;
    const client = { query: async sql => {
        if (sql.includes('INSERT INTO stock_restorations')) {
            if (created) return { rows: [] };
            created = true;
            return { rows: [{ id: 'restore-return-1' }] };
        }
        if (sql.includes('FROM stock_restorations')) return { rows: [{ quantity: 0 }] };
        if (sql.includes('SELECT colors FROM products')) return { rows: [{ colors: [{ id: 'color-1', stock: { M: stock } }] }] };
        if (sql.includes('UPDATE products')) { stock++; return { rows: [] }; }
        return { rows: [] };
    } };
    const item = { id: 'item-1', product_id: 'product-1', color_id: 'color-1', size: 'M', quantity: 1 };
    assert.equal(await restoreStock(client, order, item, 1, 'return', 'return-item-1'), true);
    assert.equal(await restoreStock(client, order, item, 1, 'return', 'return-item-1'), false);
    assert.equal(stock, 4);
});

test('concurrent cancellation restoration still applies one stock increment', async () => {
    let reserved = false;
    let updates = 0;
    const client = { query: async sql => {
        if (sql.includes('INSERT INTO stock_restorations')) {
            await Promise.resolve();
            if (reserved) return { rows: [] };
            reserved = true;
            return { rows: [{ id: 'one' }] };
        }
        if (sql.includes('FROM stock_restorations')) return { rows: [{ quantity: 0 }] };
        if (sql.includes('SELECT colors FROM products')) return { rows: [{ colors: [{ id: 'color-1', stock: { M: 2 } }] }] };
        if (sql.includes('UPDATE products')) updates++;
        return { rows: [] };
    } };
    const item = { id: 'item-1', product_id: 'product-1', color_id: 'color-1', size: 'M', quantity: 1 };
    const results = await Promise.all([
        restoreStock(client, order, item, 1, 'cancellation'),
        restoreStock(client, order, item, 1, 'cancellation'),
    ]);
    assert.deepEqual(results.sort(), [false, true]);
    assert.equal(updates, 1);
});

test('pending payment cancel uses Orders API with stable key; no actual provider call', async () => {
    const oldFetch = global.fetch;
    const oldToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    process.env.MERCADO_PAGO_ACCESS_TOKEN = 'local-mock-only';
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url, options });
        return { ok: true, json: async () => ({ id: 'ORD-1', status: 'canceled', external_reference: 'DH-TEST' }) };
    };
    try {
        await cancelPendingOrder('ORD-1', 'cancel-order-1');
        assert.equal(calls[0].url, 'https://api.mercadopago.com/v1/orders/ORD-1/cancel');
        assert.equal(calls[0].options.headers['X-Idempotency-Key'], 'cancel-order-1');
    } finally {
        global.fetch = oldFetch;
        if (oldToken === undefined) delete process.env.MERCADO_PAGO_ACCESS_TOKEN;
        else process.env.MERCADO_PAGO_ACCESS_TOKEN = oldToken;
    }
});

test('return receipt and cancellation are idempotent and payment webhook cannot undo refund', () => {
    assert.equal(nextReturnStatus('recebida', 'recebida'), false);
    assert.throws(() => nextReturnStatus('recebida', 'autorizada'));
    assert.equal(shouldApplyProviderPayment({ status: 'cancelado', payment_status: 'rejected' }, 'approved'), false);
    assert.equal(shouldApplyProviderPayment({ status: 'entregue', payment_status: 'refunded' }, 'approved'), false);
    assert.equal(shouldApplyProviderPayment({ status: 'entregue', payment_status: 'partially_refunded' }, 'approved'), false);
    assert.equal(shouldApplyProviderPayment(order, 'refunded', true), false);
    assert.equal(shouldApplyProviderPayment(order, 'refunded'), false);
    assert.equal(canCancelWithoutRefund({ ...order, mercado_pago_order_id: null, mercado_pago_payment_id: null,
        payment_status: 'pending', payment_attempt_started_at: '2026-01-01' }), false);
    assert.equal(canCancelAfterRefund({ ...order, payment_status: 'refunded' }, 10000), true);
    assert.equal(canCancelAfterRefund({ ...order, payment_status: 'refunded', status: 'enviado' }, 10000), false);
    assert.equal(canCancelAfterRefund({ ...order, payment_status: 'refunded', status: 'entregue' }, 10000), false);
    assert.equal(canCancelAfterRefund({ ...order, payment_status: 'refunded' }, 9900), false);
    assert.equal(canCancelWithoutRefund({ ...order, mercado_pago_order_id: null, mercado_pago_payment_id: null,
        payment_status: 'pending', paid_at: null }), true);
    assert.equal(canCancelWithoutRefund({ ...order, mercado_pago_order_id: null, mercado_pago_payment_id: null,
        payment_status: 'pending', paid_at: null, status: 'enviado' }), false);
    assert.doesNotThrow(() => assertFulfillmentTransition(order, 'em_separacao'));
    assert.throws(() => assertFulfillmentTransition(order, 'entregue'));
    assert.throws(() => assertFulfillmentTransition({ ...order, status: 'cancelado' }, 'enviado'));
});

test('customer cannot invoke admin refund, pending-cancel or manual payment-status mutation', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: 'customer-1', role: 'customer' }; next(); });
    app.use('/api', afterSalesRoutes);
    app.use('/api', orderRoutes);
    const server = await new Promise(resolve => {
        const running = app.listen(0, '127.0.0.1', () => resolve(running));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        const refund = await fetch(`${base}/api/orders/someone-elses-order/refunds`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': 'refund-key-1' },
            body: JSON.stringify({ kind: 'full', reason: 'Test request' }),
        });
        assert.equal(refund.status, 403);
        const cancel = await fetch(`${base}/api/orders/someone-elses-order/cancel-pending-payment`, { method: 'POST' });
        assert.equal(cancel.status, 403);
        const manual = await fetch(`${base}/api/orders/someone-elses-order/status`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payment_status: 'approved' }),
        });
        assert.equal(manual.status, 403);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});

test('even an admin cannot set payment_status or cancel status through the generic status route', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: 'admin-1', role: 'admin' }; next(); });
    app.use('/api', orderRoutes);
    const server = await new Promise(resolve => {
        const running = app.listen(0, '127.0.0.1', () => resolve(running));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        for (const body of [{ payment_status: 'approved' }, { status: 'cancelado' },
            { status: 'pagamento_aprovado' }]) {
            const response = await fetch(`${base}/api/orders/order-1/status`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            });
            assert.equal(response.status, 400);
        }
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});
