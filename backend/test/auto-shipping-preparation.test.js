import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticShippingPreparationEligible, enqueueAutomaticShippingPreparation,
    createAutoShippingPreparationWorker } from '../src/services/autoShippingPreparation.js';

const enabled = { AUTO_SHIPPING_PREPARE_ENABLED: 'true', FISCAL_XML_IMPORT_ENABLED: 'true' };
const baseOrder = { id: '11111111-1111-4111-8111-111111111111', payment_status: 'approved',
    status: 'pagamento_aprovado', shipping_method: 'melhor_envio', shipping_status: null,
    melhor_envio_shipment_id: null, snapshot: { shipping_environment: 'production' } };

function fixture({ env = { ...enabled }, order = structuredClone(baseOrder), fiscalVerified = true,
    originalState = 'pending', locked = true, operate } = {}) {
    const queries = [], calls = [];
    const event = { id: '22222222-2222-4222-8222-222222222222', order_id: order.id,
        metadata: { auto_shipping_prepare_version: 1, auto_shipping_prepare_state: originalState,
            requested_by: '33333333-3333-4333-8333-333333333333' } };
    const query = async (sql, params = []) => {
        queries.push(sql);
        if (sql.includes('SELECT id FROM order_events')) return { rows: event.metadata.auto_shipping_prepare_state === 'pending' ? [{ id: event.id }] : [] };
        if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked }] };
        if (sql.includes('pg_advisory_unlock')) return { rows: [] };
        if (sql.includes('FROM order_events e')) return { rows: [{ order_id: order.id, metadata: structuredClone(event.metadata), ...order }] };
        if (sql.includes('FROM fiscal_documents')) return { rows: fiscalVerified ? [{ exists: 1 }] : [] };
        if (sql.startsWith('UPDATE order_events')) { Object.assign(event.metadata, JSON.parse(params[1])); return { rows: [] }; }
        if (sql.includes('SELECT shipping_status FROM orders')) return { rows: [{ shipping_status: order.shipping_status }] };
        throw new Error(`Unexpected SQL: ${sql}`);
    };
    const db = { connect: async () => ({ query, release() {} }) };
    const prepare = operate || (async (...args) => {
        calls.push(args);
        order.melhor_envio_shipment_id = 'shipment-fixture'; order.shipping_status = 'cart_created';
        return { status: 'cart_created', shipment_id: 'shipment-fixture' };
    });
    return { db, env, event, queries, order, calls,
        worker: createAutoShippingPreparationWorker({ db, env, operate: prepare }) };
}

test('automatic shipping is opt-in, requires paid production orders and will not backfill uncertain carts', async () => {
    assert.equal(automaticShippingPreparationEligible(baseOrder, {}), false);
    assert.equal(automaticShippingPreparationEligible(baseOrder, enabled), true);
    for (const change of [
        { payment_status: 'pending' }, { status: 'cancelado' }, { status: 'entregue' }, { shipping_method: 'retirada' },
        { shipping_status: 'cart_inflight' }, { shipping_status: 'cart_uncertain' },
        { melhor_envio_shipment_id: 'already-created' },
        { snapshot: { shipping_environment: 'sandbox' } },
    ]) assert.equal(automaticShippingPreparationEligible({ ...baseOrder, ...change }, enabled), false);
    const f = fixture({ env: {} });
    assert.equal(await f.worker.processOne(), false);
    assert.equal(f.queries.length, 0);
});

test('verified NF-e enqueues one durable event without touching orders, inventory or products', async () => {
    const queries = [];
    const client = { async query(sql, args) { queries.push([sql, args]); } };
    assert.equal(await enqueueAutomaticShippingPreparation(client, baseOrder, 'admin-id', enabled), true);
    assert.equal(await enqueueAutomaticShippingPreparation(client, { ...baseOrder, shipping_status: 'cart_inflight' }, 'admin-id', enabled), false);
    assert.equal(await enqueueAutomaticShippingPreparation(client, baseOrder, 'admin-id', {}), false);
    assert.equal(queries.length, 1);
    assert.match(queries[0][0], /INSERT INTO order_events/);
    assert.deepEqual(JSON.parse(queries[0][1][3]), {
        auto_shipping_prepare_version: 1, auto_shipping_prepare_state: 'pending',
        requested_by: 'admin-id', shipping_environment: 'production',
    });
    assert.equal(queries.some(([sql]) => /UPDATE orders|UPDATE products|stock/i.test(sql)), false);
});

test('worker prepares unpaid cart once, never purchases, prints or adjusts stock', async () => {
    const f = fixture();
    assert.equal(await f.worker.processOne(), true);
    assert.equal(f.event.metadata.auto_shipping_prepare_state, 'prepared');
    assert.equal(await f.worker.processOne(), false);
    assert.deepEqual(f.calls, [[baseOrder.id, 'prepare', {}, '33333333-3333-4333-8333-333333333333']]);
    assert.equal(f.queries.some(sql => /UPDATE orders|UPDATE products|stock/i.test(sql)), false);
});

test('network uncertainty blocks further automatic requests instead of making duplicate carts', async () => {
    const f = fixture({ operate: async (orderId, action) => {
        f.calls.push([orderId, action]); f.order.shipping_status = 'cart_inflight';
        throw new Error('Provider timeout containing confidential data must never be persisted');
    } });
    assert.equal(await f.worker.processOne(), true);
    assert.equal(f.event.metadata.auto_shipping_prepare_state, 'blocked');
    assert.equal(f.event.metadata.auto_shipping_prepare_reason, 'needs_reconciliation');
    assert.equal(await f.worker.processOne(), false);
    assert.deepEqual(f.calls, [[baseOrder.id, 'prepare']]);
    assert.equal(JSON.stringify(f.event.metadata).includes('confidential'), false);
});

test('preflight failure, stale NF-e and existing provider record never issue a second cart call', async () => {
    const f = fixture({ operate: async () => { throw new Error('Recipient address invalid'); } });
    assert.equal(await f.worker.processOne(), true);
    assert.equal(f.event.metadata.auto_shipping_prepare_reason, 'manual_review_required');
    assert.equal(await f.worker.processOne(), false);

    const g = fixture({ fiscalVerified: false });
    await g.worker.processOne();
    assert.equal(g.event.metadata.auto_shipping_prepare_reason, 'fiscal_verification_missing');
    assert.equal(g.calls.length, 0);

    const h = fixture({ order: { ...baseOrder, shipping_status: 'cart_created', melhor_envio_shipment_id: 'already-sent' } });
    await h.worker.processOne();
    assert.equal(h.event.metadata.auto_shipping_prepare_state, 'prepared');
    assert.equal(h.calls.length, 0);

    const i = fixture({ locked: false });
    assert.equal(await i.worker.processOne(), false);
    assert.equal(i.calls.length, 0);
});
