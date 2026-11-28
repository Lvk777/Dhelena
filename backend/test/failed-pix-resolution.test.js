import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFailedPixAttempt, resolveFailedPixAttemptInTransaction } from '../src/failedPixResolution.js';
import { applyVerifiedOrderInTransaction } from '../src/lib/paymentReconciliation.js';
import { findTestOrdersByReference } from '../src/services/mercadoPago.js';

const baseOrder = () => ({
    id: 'order-1', order_number: 'DH-TEST-1', created_at: '2026-01-01T00:00:00Z',
    status: 'recebido', payment_status: 'pending', payment_method: 'pix',
    payment_attempt_method: 'pix', payment_attempt_started_at: '2026-01-01T00:01:00Z',
    mercado_pago_order_id: null, mercado_pago_payment_id: null, paid_at: null,
    melhor_envio_shipment_id: null, tracking_code: null, total: '50.00',
});

function fakeDatabase(initial = baseOrder()) {
    const state = { order: { ...initial }, stock: 4, restorations: 0, events: [], audits: [], queries: [] };
    const client = { async query(sql, params = []) {
        state.queries.push(sql);
        if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}] };
        if (sql.startsWith('SELECT * FROM orders WHERE id')) return { rows: [{ ...state.order }] };
        if (sql.includes("FROM order_events WHERE order_id = $1 AND event = 'payment_attempt_resolved'")) {
            return { rows: state.events.some(event => event.includes("'payment_attempt_resolved'")) ? [{ '?column?': 1 }] : [] };
        }
        if (sql.startsWith('SELECT * FROM order_items')) return { rows: [{
            id: 'item-1', order_id: state.order.id, product_id: 'product-1', color_id: 'color-1',
            size: 'M', quantity: 1,
        }] };
        if (sql.includes('INSERT INTO stock_restorations')) {
            if (state.restorations) return { rows: [] };
            state.restorations++;
            return { rows: [{ id: 'restoration-1' }] };
        }
        if (sql.includes('FROM stock_restorations') && sql.includes('SUM')) return { rows: [{ quantity: 0 }] };
        if (sql.startsWith('SELECT colors, sizes FROM products')) return { rows: [{
            colors: [{ id: 'color-1', stock: { M: state.stock } }], sizes: ['M'],
        }] };
        if (sql.startsWith('UPDATE products SET colors')) {
            state.stock = JSON.parse(params[0])[0].stock.M;
            return { rows: [] };
        }
        if (sql.startsWith('INSERT INTO stock_movements')) return { rows: [] };
        if (sql.startsWith("UPDATE orders SET status = 'cancelado'")) {
            state.order.status = 'cancelado';
            return { rows: [{ ...state.order }] };
        }
        if (sql.includes('INSERT INTO order_events')) { state.events.push(sql); return { rows: [] }; }
        if (sql.includes('INSERT INTO audit_logs')) { state.audits.push({ sql, params }); return { rows: [] }; }
        if (sql.includes('to_regclass')) return { rows: [{ relation: null }] };
        throw new Error(`Unexpected query: ${sql}`);
    } };
    return { state, client };
}

const provider = (orders = []) => ({
    getMercadoPagoMode: () => 'test',
    findTestOrdersByReference: async () => orders,
});

test('zero provider Orders resolves and cancels once, preserving attempt and coupon evidence', async () => {
    const { client, state } = fakeDatabase();
    const first = await resolveFailedPixAttemptInTransaction(client, state.order.id, 'admin-1', provider());
    assert.equal(first.outcome, 'resolved_and_cancelled');
    assert.equal(state.order.status, 'cancelado');
    assert.equal(state.order.payment_status, 'pending');
    assert.equal(state.order.payment_attempt_started_at, '2026-01-01T00:01:00Z');
    assert.equal(state.stock, 5);
    assert.equal(state.restorations, 1);
    assert.equal(state.events.length, 2);
    assert.equal(state.audits.length, 2);
    assert.equal(state.queries.some(sql => /coupon_usage|refund/i.test(sql)), false);
    const second = await resolveFailedPixAttemptInTransaction(client, state.order.id, 'admin-1', provider());
    assert.equal(second.outcome, 'already_resolved');
    assert.equal(state.stock, 5);
    assert.equal(state.restorations, 1);
    assert.equal(state.events.length, 2);
});

test('provider Order and inconclusive lookups leave local state untouched', async () => {
    for (const lookup of [async () => [{ id: 'ORD-1' }],
        async () => { throw new Error('GET failed'); },
        async () => { throw Object.assign(new Error('HTTP 503'), { status: 503 }); },
        async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); }]) {
        const { client, state } = fakeDatabase();
        await assert.rejects(resolveFailedPixAttemptInTransaction(client, state.order.id, 'admin-1', {
            getMercadoPagoMode: () => 'test', findTestOrdersByReference: lookup,
        }));
        assert.equal(state.order.status, 'recebido');
        assert.equal(state.order.payment_attempt_started_at, '2026-01-01T00:01:00Z');
        assert.equal(state.stock, 4);
        assert.equal(state.restorations, 0);
    }
});

test('rejects provider IDs, approved payment, shipment, wrong method, and production mode', async () => {
    for (const patch of [
        { mercado_pago_order_id: 'ORD-1' }, { mercado_pago_payment_id: 'PAY-1' },
        { payment_status: 'approved' }, { paid_at: '2026-01-01' },
        { status: 'enviado' }, { status: 'entregue' }, { status: 'em_transporte' },
        { melhor_envio_shipment_id: 'SHIP-1' }, { tracking_code: 'TRACK-1' },
        { payment_attempt_method: 'card' }, { payment_attempt_started_at: null },
        { payment_attempt_started_at: new Date().toISOString() },
    ]) {
        const order = { ...baseOrder(), ...patch };
        assert.throws(() => assertFailedPixAttempt(order), { status: 409 });
    }
    const { client, state } = fakeDatabase();
    await assert.rejects(resolveFailedPixAttemptInTransaction(client, state.order.id, 'admin-1', {
        getMercadoPagoMode: () => 'production', findTestOrdersByReference: async () => [],
    }), { status: 409 });
    assert.equal(state.stock, 4);
});

test('a delayed verified webhook cannot approve a cancelled order', async () => {
    const { client, state } = fakeDatabase();
    await resolveFailedPixAttemptInTransaction(client, state.order.id, 'admin-1', provider());
    const result = await applyVerifiedOrderInTransaction(client, state.order.id, {
        mp_order_id: 'ORD-1', mp_payment_id: 'PAY-1', external_reference: state.order.order_number,
        total_amount: '50.00', transaction_amount: '50.00', currency_id: 'BRL', payment_count: 1,
        order_status: 'processed', order_status_detail: 'accredited', transaction_status: 'processed',
        transaction_status_detail: 'accredited', mp_status: 'processed', mp_status_detail: 'accredited',
    }, 'webhook');
    assert.equal(result.outcome, 'ignored');
    assert.equal(state.order.status, 'cancelado');
    assert.equal(state.order.payment_status, 'pending');
});

test('two administrative calls serialize and restore stock once', async () => {
    const { client, state } = fakeDatabase();
    let releaseLock;
    let lockHeld = false;
    const waiters = [];
    const lockedClient = { query: async (sql, params) => {
        if (sql.includes('pg_advisory_xact_lock')) {
            if (lockHeld) await new Promise(resolve => waiters.push(resolve));
            lockHeld = true;
            return { rows: [{}] };
        }
        return client.query(sql, params);
    } };
    const transact = async () => {
        try { return await resolveFailedPixAttemptInTransaction(lockedClient, state.order.id, 'admin-1', provider()); }
        finally {
            lockHeld = false;
            releaseLock = waiters.shift();
            releaseLock?.();
        }
    };
    const outcomes = await Promise.all([transact(), transact()]);
    assert.deepEqual(outcomes.map(value => value.outcome).sort(), ['already_resolved', 'resolved_and_cancelled']);
    assert.equal(state.restorations, 1);
    assert.equal(state.stock, 5);
});

test('Orders API search fails closed on incomplete pages, 5xx and timeout', async () => {
    const oldFetch = global.fetch;
    const oldMode = process.env.MERCADO_PAGO_MODE;
    const oldToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    process.env.MERCADO_PAGO_MODE = 'test';
    process.env.MERCADO_PAGO_ACCESS_TOKEN = 'local-mock-only';
    try {
        for (const result of [
            { data: [] }, { paging: { total: 1 }, data: [] },
            { paging: { total: 1 }, data: [{ external_reference: 'OTHER' }] },
            { paging: { total: 10 }, data: Array.from({ length: 10 }, () => ({ external_reference: 'DH-TEST-1' })) },
        ]) {
            global.fetch = async () => ({ ok: true, status: 200, json: async () => result });
            await assert.rejects(findTestOrdersByReference('DH-TEST-1', '2026-01-01'), { status: 409 });
        }
        global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
        await assert.rejects(findTestOrdersByReference('DH-TEST-1', '2026-01-01'), { status: 409, code: 'provider_request_inconclusive' });
        global.fetch = async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); };
        await assert.rejects(findTestOrdersByReference('DH-TEST-1', '2026-01-01'));
    } finally {
        global.fetch = oldFetch;
        if (oldMode === undefined) delete process.env.MERCADO_PAGO_MODE;
        else process.env.MERCADO_PAGO_MODE = oldMode;
        if (oldToken === undefined) delete process.env.MERCADO_PAGO_ACCESS_TOKEN;
        else process.env.MERCADO_PAGO_ACCESS_TOKEN = oldToken;
    }
});
