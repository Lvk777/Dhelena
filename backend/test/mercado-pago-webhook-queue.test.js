import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import express from 'express';
import pg from 'pg';
import { pool } from '../src/config/db.js';
import webhookRouter from '../src/routes/webhooks.js';
import { paymentContexts, bindPaymentAttempt } from '../src/lib/mercadoPagoContext.js';
import { authenticateOrderDelivery, persistOrderDelivery, acknowledgeOrderDelivery, createOrderWebhookWorker } from '../src/services/mercadoPagoWebhookQueue.js';
import { getOrderStatus, getWebhookCredentialIdentity } from '../src/services/mercadoPago.js';

const env = { MERCADO_PAGO_MODE: 'test', MERCADO_PAGO_ACCESS_TOKEN: 'synthetic-test-token', MERCADO_PAGO_WEBHOOK_SECRET: 'synthetic-test-secret' };
const testContext = paymentContexts(env)[0];
const productionContext = paymentContexts({ MERCADO_PAGO_MODE: 'production', MERCADO_PAGO_ACCESS_TOKEN: 'synthetic-production-token',
    MERCADO_PAGO_WEBHOOK_SECRET: 'synthetic-production-secret', MERCADO_PAGO_APPLICATION_ID: '98765' })[0];
const resourceId = 'ORD01MOCK1234567890123456789';
function request(context = testContext, sequence = 1) {
    const ts = '1760000000000', requestId = `synthetic-request-${sequence}`;
    const v1 = crypto.createHmac('sha256', context.secret).update(`id:${resourceId};request-id:${requestId};ts:${ts};`).digest('hex');
    return { headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId },
        query: { 'data.id': resourceId, type: 'order' },
        body: { id: 'unsigned-id', type: 'order', live_mode: context.mode === 'production',
            application_id: context.applicationId || '12345', data: { id: resourceId } } };
}
function fixture(context = testContext) {
    const events = [], queries = [], logs = [];
    const sellerId = context.mode === 'production' ? '24680' : '67890';
    const order = { id: 'local-order', order_number: 'DH-2026-900001', total: '114.95', subtotal: '100.00',
        shipping_cost: '19.95', discount: '5.00', coupon_code: 'UNCHANGED', payment_status: 'pending', status: 'recebido',
        mercado_pago_order_id: resourceId, snapshot: { payment_context: { version: 1, mode: context.mode,
            credential_id: context.credentialId, application_id: context.applicationId || '12345', provider_order_id: resourceId },
        discount_breakdown: { coupon: 5, pix: 0 }, items: [{ quantity: 1, stock: 7 }] } };
    const resource = { mp_order_id: resourceId, external_reference: order.order_number, application_id: context.applicationId || '12345',
        user_id: sellerId, resource_type: 'online', currency_id: 'BRL', total_amount: '114.95', transaction_amount: '114.95',
        order_status: 'processed', order_status_detail: 'accredited', mp_status: 'processed', mp_status_detail: 'accredited',
        transaction_status: 'processed', transaction_status_detail: 'accredited', payment_count: 1, mp_payment_id: 'PAY-MOCK' };
    let clock = 1000, failFetch = false, failCommit = false, paymentWrites = 0, ledgerWrites = 0, fetches = 0;
    let holdFetch = null, bound = true, activeContexts = [context], orderOwner = null, orderWaiters = [], duplicateOrder = false;
    const connect = async () => {
        const client = { locks: [], originalOrder: null, originalEvents: new Map(), writes: 0, ledger: 0 };
        const unlock = () => {
            for (const e of client.locks) e.locked = false;
            client.locks = [];
            if (orderOwner === client) { orderOwner = null; for (const wake of orderWaiters) wake(); orderWaiters = []; }
        };
        client.query = async (sql, args = []) => {
            queries.push(sql);
            if (sql === 'BEGIN' || sql.startsWith('SET LOCAL') || sql === 'SELECT 1') return { rows: [] };
            if (sql === 'COMMIT') {
                if (failCommit && client.writes) { failCommit = false; throw new Error('synthetic lost connection before commit'); }
                paymentWrites += client.writes; ledgerWrites += client.ledger;
                client.originalOrder = null; client.originalEvents.clear(); client.writes = 0; client.ledger = 0; unlock(); return { rows: [] };
            }
            if (sql === 'ROLLBACK') {
                if (client.originalOrder) { for (const key of Object.keys(order)) delete order[key]; Object.assign(order, client.originalOrder); }
                for (const [e, original] of client.originalEvents) Object.assign(e, original);
                client.originalOrder = null; client.originalEvents.clear(); client.writes = 0; client.ledger = 0; unlock(); return { rows: [] };
            }
            if (sql.startsWith('INSERT INTO webhook_events')) {
                if (events.some(e => e.event_id === args[0])) return { rows: [] };
                events.push({ id: String(events.length + 1), event_id: args[0], payload: JSON.parse(args[1]), processed: false });
                return { rows: [{ processed: false }] };
            }
            if (sql.startsWith('SELECT processed')) return { rows: events.filter(e => e.event_id === args[0]).map(e => ({ processed: e.processed })) };
            if (sql.startsWith('SELECT * FROM webhook_events')) {
                assert.match(sql, /FOR UPDATE SKIP LOCKED/);
                const e = events.find(e => !e.processed && !e.locked
                    && ((e.payload.mp_webhook?.version === 1 && args[0].includes(e.payload.mp_webhook.credential_id))
                        || (e.payload.mp_webhook?.version === 2 && e.payload.mp_webhook.candidate_credential_ids?.some(id => args[0].includes(id))))
                    && e.payload.queue?.state !== 'blocked'
                    && (e.payload.queue?.next_at || 0) <= args[1]);
                if (!e) return { rows: [] };
                e.locked = true; client.locks.push(e); return { rows: [structuredClone(e)] };
            }
            if (sql.startsWith('SELECT * FROM orders')) {
                if (!bound) return { rows: [] };
                if (sql.includes('FOR UPDATE')) {
                    while (orderOwner && orderOwner !== client) await new Promise(resolve => orderWaiters.push(resolve));
                    orderOwner = client;
                }
                return { rows: duplicateOrder ? [structuredClone(order), { ...structuredClone(order), id: 'duplicate-local' }] : [structuredClone(order)] };
            }
            if (sql.includes('to_regclass')) return { rows: [{ relation: null }] };
            if (sql.startsWith('UPDATE orders SET payment_provider')) {
                client.originalOrder ||= structuredClone(order); client.writes++;
                Object.assign(order, { mercado_pago_payment_id: args[1], mercado_pago_external_reference: args[2],
                    mercado_pago_status: args[3], mercado_pago_status_detail: args[4], payment_status: args[5], payment_attempt_started_at: null });
                if (sql.includes('paid_at =')) { order.paid_at = 'paid'; order.status = args[6]; }
                return { rows: [] };
            }
            if (sql.startsWith('INSERT INTO audit_logs') || sql.startsWith('INSERT INTO order_events')) { client.ledger++; return { rows: [] }; }
            if (sql.startsWith('UPDATE orders SET snapshot')) { order.snapshot.payment_context = JSON.parse(args[1]); return { rows: [] }; }
            if (sql.startsWith('UPDATE webhook_events')) {
                const e = events.find(e => e.id === args[0]);
                if (sql.includes('processed = true')) {
                    client.originalEvents.set(e, structuredClone(e)); e.processed = true; e.payload = JSON.parse(args[1]);
                } else if (!e.processed && JSON.stringify(e.payload) === args[2]) e.payload.queue = JSON.parse(args[1]);
                return { rows: [] };
            }
            assert.fail(`Unexpected query: ${sql}`);
        };
        client.release = () => unlock();
        return client;
    };
    const transaction = async callback => {
        const client = await connect(); await client.query('BEGIN');
        try { const value = await callback(client); await client.query('COMMIT'); return value; }
        catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    };
    const provider = {
        async getWebhookCredentialIdentity(c) { assert.equal(c.accessToken, context.accessToken); return { userId: sellerId, mode: context.mode }; },
        async getOrderStatus(id, c) {
            fetches++; assert.equal(id, resourceId); assert.equal(c.accessToken, context.accessToken);
            if (holdFetch) await holdFetch;
            if (failFetch) throw Object.assign(new Error('synthetic timeout'), { name: 'TimeoutError' });
            return structuredClone(resource);
        },
    };
    const makeWorker = (overrides = {}) => createOrderWebhookWorker({ db: { connect }, contexts: () => activeContexts,
        provider, refund: async () => null, now: () => clock, random: () => 0, logger: record => logs.push(record), ...overrides });
    const persist = (sequence = 1) => persistOrderDelivery(authenticateOrderDelivery(request(context, sequence), [context]), transaction);
    return { events, queries, logs, order, resource, provider, transaction, connect, makeWorker, persist,
        get paymentWrites() { return paymentWrites; }, get ledgerWrites() { return ledgerWrites; }, get fetches() { return fetches; },
        advance() { clock += 400000; }, setFetchFailure(value) { failFetch = value; }, failCommit() { failCommit = true; },
        setHold(value) { holdFetch = value; }, setBound(value) { bound = value; }, setContexts(value) { activeContexts = value; },
        setDuplicateOrder(value) { duplicateOrder = value; } };
}

test('current generic TEST context stays compatible; incomplete production and partial scoped sets fail closed', () => {
    assert.equal(paymentContexts(env)[0].mode, 'test');
    assert.equal(paymentContexts({ ...env, MERCADO_PAGO_MODE: 'production' }).length, 0);
    assert.equal(paymentContexts({ ...env, MERCADO_PAGO_TEST_ACCESS_TOKEN: 'partial' }).length, 0);
    assert.equal(paymentContexts({ ...env, MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET: 'partial' }).length, 1);
    assert.equal(paymentContexts({ ...env, MERCADO_PAGO_APPLICATION_ID: '12345' })[0].credentialId, testContext.credentialId);
});
for (const [name, mutate, code] of [
    ['wrong signature', r => { r.headers['x-signature'] = 'ts=1,v1=' + '0'.repeat(64); }, 'invalid_signature_context'],
    ['wrong event', r => { r.body.type = 'payment'; }, 'unsupported_event'],
    ['wrong query event', r => { r.query.type = 'payment'; }, 'unsupported_event'],
    ['production body signed by TEST key', r => { r.body.live_mode = true; }, 'delivery_context_mismatch'],
    ['missing live mode', r => { delete r.body.live_mode; }, 'delivery_context_mismatch'],
    ['different body resource', r => { r.body.data.id = 'ORDDIFFERENT123456'; }, 'delivery_context_mismatch'],
    ['missing app', r => { delete r.body.application_id; }, 'delivery_context_mismatch'],
]) test(`ingress rejects ${name} before persistence or official fetch`, () => {
    const r = request(); mutate(r);
    assert.throws(() => authenticateOrderDelivery(r, [testContext]), { code });
});
test('different production app rejects single context; shared HMAC defers selection and unsigned notification ID cannot poison identity', () => {
    const r = request(productionContext); r.body.application_id = '111';
    assert.throws(() => authenticateOrderDelivery(r, [productionContext]), { code: 'delivery_context_mismatch' });
    const shared = authenticateOrderDelivery(request(), [testContext, { ...productionContext, secret: testContext.secret }]);
    assert.equal(shared.payload.mp_webhook.version, 2);
    assert.equal(shared.payload.mp_webhook.mode, undefined);
    const a = request(), b = request(); b.body.id = 'poison';
    assert.equal(authenticateOrderDelivery(a, [testContext]).eventId, authenticateOrderDelivery(b, [testContext]).eventId);
});
for (const context of [testContext, productionContext]) test(`${context.mode}: durable pending delivery is not completed; fresh worker recovers after restart`, async () => {
    const f = fixture(context);
    assert.equal(await f.persist(), 'queued'); assert.equal(await f.persist(), 'pending'); assert.equal(f.fetches, 0);
    assert.equal(await f.makeWorker().processOne(), true);
    assert.equal(f.order.payment_status, 'approved'); assert.equal(f.events[0].processed, true);
    assert.equal(await f.persist(), 'already_processed'); assert.equal(f.paymentWrites, 1); assert.equal(f.ledgerWrites, 2);
    assert.equal(await f.makeWorker().processOne(), false);
});
test('provider timeout retains pending row, backs off and recovers without another provider notification', async () => {
    const f = fixture(); await f.persist(); f.setFetchFailure(true);
    await f.makeWorker().processOne(); assert.equal(f.events[0].processed, false); assert.equal(f.paymentWrites, 0);
    assert.equal(await f.makeWorker().processOne(), false); assert.equal(await f.persist(), 'pending');
    f.advance(); f.setFetchFailure(false); await f.makeWorker().processOne();
    assert.equal(f.events[0].processed, true); assert.equal(f.paymentWrites, 1);
});
test('failed commit rolls back payment, timeline and completion together; restart recovers exactly once', async () => {
    const f = fixture(); await f.persist(); f.failCommit(); await f.makeWorker().processOne();
    assert.equal(f.order.payment_status, 'pending'); assert.equal(f.events[0].processed, false);
    assert.equal(f.paymentWrites, 0); assert.equal(f.ledgerWrites, 0);
    f.advance(); await f.makeWorker().processOne(); assert.equal(f.paymentWrites, 1); assert.equal(f.ledgerWrites, 2);
});
test('arrival before creation commit retries instead of permanently losing the notification', async () => {
    const f = fixture(); await f.persist(); f.setBound(false); await f.makeWorker().processOne();
    assert.equal(f.events[0].processed, false); assert.equal(f.paymentWrites, 0);
    f.advance(); f.setBound(true); await f.makeWorker().processOne(); assert.equal(f.paymentWrites, 1);
});
test('two replicas skip the same locked event and serialize different events for the same order', async () => {
    const f = fixture(); await f.persist(); await f.persist(2);
    await Promise.all([f.makeWorker().processOne(), f.makeWorker().processOne(), f.makeWorker().processOne()]);
    assert.equal(f.events.filter(e => e.processed).length, 2); assert.equal(f.paymentWrites, 1); assert.equal(f.ledgerWrites, 2);
    assert.equal(f.queries.some(sql => /UPDATE products|stock_movements|coupon_usages|DELETE FROM webhook_events/.test(sql)), false);
    assert.equal(f.order.coupon_code, 'UNCHANGED'); assert.equal(f.order.discount, '5.00'); assert.equal(f.order.snapshot.items[0].stock, 7);
});
for (const [name, mutate] of [
    ['official application', f => { f.resource.application_id = '555'; }],
    ['official seller', f => { f.resource.user_id = '999'; }],
    ['official resource type', f => { f.resource.resource_type = 'point'; }],
    ['official live mode', f => { f.resource.live_mode = true; }],
    ['local environment', f => { f.order.snapshot.payment_context.mode = 'production'; }],
    ['local credential binding', f => { f.order.snapshot.payment_context.credential_id = 'different'; }],
    ['local app', f => { f.order.snapshot.payment_context.application_id = '555'; }],
    ['local resource', f => { f.order.snapshot.payment_context.provider_order_id = 'other'; }],
    ['official total', f => { f.resource.total_amount = '114.96'; }],
    ['official reference', f => { f.resource.external_reference = 'other'; }],
    ['two payments', f => { f.resource.payment_count = 2; }],
    ['legacy attempt', f => { delete f.order.snapshot.payment_context; }],
    ['tampered durable proof', f => { f.events[0].payload.mp_webhook.application_id = '555'; }],
]) test(`${name} mismatch leaves blocked pending, never changes financial history`, async () => {
    const f = fixture(); await f.persist(); mutate(f); await f.makeWorker().processOne();
    assert.equal(f.paymentWrites, 0); assert.equal(f.events[0].processed, false); assert.equal(f.events[0].payload.queue.state, 'blocked');
    assert.equal(await f.persist(), 'pending'); assert.equal(await f.makeWorker().processOne(), false);
});
test('older unsealed pending notifications remain untouched; scoped TEST credentials recover across production cutover', async () => {
    const f = fixture(); f.events.push({ id: 'legacy', event_id: 'old-id', processed: false, payload: { type: 'order' } });
    await f.persist(); f.setContexts([productionContext]); assert.equal(await f.makeWorker().processOne(), false);
    f.setContexts([testContext, productionContext]); await f.makeWorker().processOne();
    assert.equal(f.events[0].processed, false); assert.deepEqual(f.events[0].payload, { type: 'order' }); assert.equal(f.paymentWrites, 1);
});
test('delayed nonapproved resource cannot downgrade an already approved order', async () => {
    const f = fixture(); await f.persist(); await f.makeWorker().processOne(); await f.persist(2);
    Object.assign(f.resource, { order_status: 'failed', order_status_detail: 'failed', mp_status: 'failed', mp_status_detail: 'failed',
        transaction_status: 'failed', transaction_status_detail: 'failed' });
    await f.makeWorker().processOne(); assert.equal(f.order.payment_status, 'approved'); assert.equal(f.paymentWrites, 1);
});
test('protected manual reconciliation stays pending, not falsely completed', async () => {
    const f = fixture(); f.order.order_number = 'DH-2026-000006'; f.resource.external_reference = f.order.order_number;
    await f.persist(); await f.makeWorker().processOne();
    assert.equal(f.paymentWrites, 0); assert.equal(f.events[0].processed, false);
    assert.equal(f.events[0].payload.queue.reason, 'manual_reconciliation_required');
});
test('official pending and rejected states are recorded once without stock or coupon consumption', async () => {
    for (const state of ['pending', 'failed']) {
        const f = fixture(); Object.assign(f.resource, { order_status: state, order_status_detail: state,
            transaction_status: state, transaction_status_detail: state, mp_status: state, mp_status_detail: state });
        await f.persist(); await f.makeWorker().processOne(); await f.persist(2); await f.makeWorker().processOne();
        assert.equal(f.order.payment_status, state === 'failed' ? 'rejected' : 'pending');
        assert.equal(f.paymentWrites, 1); assert.equal(f.ledgerWrites, 2); assert.equal(f.order.paid_at, undefined);
        assert.equal(f.queries.some(sql => /UPDATE products|stock_movements|coupon_usages/.test(sql)), false);
    }
});
test('official provider reads use the selected token, not the active environment token; identity comes from official tags', async t => {
    const calls = []; t.mock.method(global, 'fetch', async (url, options) => {
        calls.push([url, options]); return { ok: true, json: async () => String(url).endsWith('/users/me')
            ? { id: '67890', tags: ['test_user'] } : { id: resourceId, type: 'online', user_id: '67890', integration_data: { application_id: '12345' } } };
    });
    assert.deepEqual(await getWebhookCredentialIdentity(testContext), { userId: '67890', mode: 'test' });
    const resource = await getOrderStatus(resourceId, testContext); assert.equal(resource.user_id, '67890'); assert.equal(resource.application_id, '12345');
    for (const [url, options] of calls) { assert.ok(String(url).startsWith('https://api.mercadopago.com/')); assert.equal(options.headers.Authorization, 'Bearer synthetic-test-token'); assert.equal(options.method, undefined); }
});
test('missing official identity evidence fails closed', async t => {
    t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ({ id: '67890' }) }));
    await assert.rejects(getWebhookCredentialIdentity(testContext), { code: 'credential_identity_unverified' });
});
test('stalled persistence misses receipt deadline with retryable error, never claims completion', async () => {
    await assert.rejects(acknowledgeOrderDelivery({}, () => new Promise(() => {}), 10), { code: 'receipt_timeout' });
});
test('worker tick cannot overlap itself; stopping drains the current transaction and a new process recovers pending work', async () => {
    const f = fixture(); await f.persist(); let release;
    f.setHold(new Promise(resolve => { release = resolve; }));
    const worker = f.makeWorker(); const first = worker.tick(); void worker.tick();
    await new Promise(resolve => setImmediate(resolve)); assert.equal(f.fetches, 1);
    let stopped = false; const stopping = worker.stop().then(() => { stopped = true; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(stopped, false);
    release(); await first; await stopping; assert.equal(f.events[0].processed, true); assert.equal(f.paymentWrites, 1);
    await f.persist(2); await worker.tick(); assert.equal(f.events[1].processed, false);
    await f.makeWorker().processOne(); assert.equal(f.events[1].processed, true); assert.equal(f.paymentWrites, 1);
});
test('refund reconciliation reads only the selected environment and validates provenance on its own fresh resource', async () => {
    const f = fixture(); await f.persist(); let reads = 0;
    f.provider.getRefundableOrder = async (id, context) => {
        assert.equal(id, resourceId); assert.equal(context.credentialId, testContext.credentialId); reads++;
        return { provider_resource: { ...f.resource, application_id: 'wrong' } };
    };
    await f.makeWorker({ refund: async (orderId, id, scopedProvider) => {
        assert.equal(orderId, f.order.id); await scopedProvider.getRefundableOrder(id);
    } }).processOne();
    assert.equal(reads, 1); assert.equal(f.events[0].processed, false); assert.equal(f.paymentWrites, 0);
    assert.equal(f.events[0].payload.queue.state, 'blocked');
});
test('creation binds only official application and preserves legacy contexts', async () => {
    const f = fixture(); const client = await f.connect();
    await bindPaymentAttempt(client, f.order, f.resource); assert.equal(f.order.snapshot.payment_context.application_id, '12345');
    await assert.rejects(bindPaymentAttempt(client, f.order, { ...f.resource, application_id: 'other' }), { status: 409 });
    delete f.order.snapshot.payment_context; await bindPaymentAttempt(client, f.order, f.resource);
    assert.equal(f.order.snapshot.payment_context, undefined); client.release();
});

const sharedContexts = paymentContexts({ MERCADO_PAGO_MODE: 'test',
    MERCADO_PAGO_TEST_ACCESS_TOKEN: 'shared-test-token', MERCADO_PAGO_TEST_WEBHOOK_SECRET: 'synthetic-shared-key', MERCADO_PAGO_TEST_APPLICATION_ID: '12345',
    MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN: 'shared-production-token', MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET: 'synthetic-shared-key', MERCADO_PAGO_PRODUCTION_APPLICATION_ID: '98765' });
function sharedFixture(mode = 'test') {
    const context = sharedContexts.find(c => c.mode === mode), other = sharedContexts.find(c => c.mode !== mode);
    const f = fixture(context); f.setContexts(sharedContexts);
    const r = request(context);
    const persistRequest = body => persistOrderDelivery(authenticateOrderDelivery(body, sharedContexts), f.transaction);
    return { ...f, context, other, r, persistRequest,
        // Forward live counters, rather than freezing spread getters.
        get paymentWrites() { return f.paymentWrites; }, get ledgerWrites() { return f.ledgerWrites; }, get fetches() { return f.fetches; } };
}

for (const mode of ['test', 'production']) test(`shared signature ${mode}: immutable attempt selects the correct token, never the active mode or body alone`, async () => {
    const f = sharedFixture(mode);
    assert.equal(await f.persistRequest(f.r), 'queued');
    assert.equal(await f.persistRequest(f.r), 'pending'); assert.equal(f.fetches, 0);
    assert.equal(f.events[0].payload.mp_webhook.mode, undefined); assert.equal(f.events[0].payload.mp_webhook.credential_id, undefined);
    await f.makeWorker().processOne(); assert.equal(f.paymentWrites, 1); assert.equal(f.order.payment_status, 'approved');
    assert.equal(f.logs[0].mode, mode); assert.equal(await f.persistRequest(f.r), 'already_processed');
    assert.equal(f.queries.some(sql => /UPDATE products|stock_movements|coupon_usages|DELETE FROM webhook_events/.test(sql)), false);
});

for (const [name, mutate] of [
    ['opposite live_mode', f => { f.r.body.live_mode = true; }],
    ['missing live_mode', f => { delete f.r.body.live_mode; }],
    ['opposite application', f => { f.r.body.application_id = '98765'; }],
    ['missing application', f => { delete f.r.body.application_id; }],
    ['wrong body resource', f => { f.r.body.data.id = 'ORDWRONG1234567890'; }],
    ['complete forged production body', f => { f.r.body.application_id = '98765'; f.r.body.live_mode = true; }],
    ['official application', f => { f.resource.application_id = '98765'; }],
    ['official seller', f => { f.resource.user_id = 'wrong-seller'; }],
    ['official environment', f => { f.resource.live_mode = true; }],
    ['official resource', f => { f.resource.mp_order_id = 'ORDWRONG1234567890'; }],
    ['local application', f => { f.order.snapshot.payment_context.application_id = '98765'; }],
    ['local provider resource', f => { f.order.snapshot.payment_context.provider_order_id = 'ORDWRONG1234567890'; }],
]) test(`shared signature: ${name} is preserved but cannot approve or switch token using body hints`, async () => {
    const f = sharedFixture(); mutate(f);
    const before = structuredClone(f.order);
    assert.equal(await f.persistRequest(f.r), 'queued'); await f.makeWorker().processOne();
    assert.equal(f.events[0].processed, false); assert.equal(f.events[0].payload.queue.state, 'blocked');
    assert.equal(f.paymentWrites, 0); assert.equal(f.ledgerWrites, 0); assert.deepEqual(f.order, before);
    assert.equal(await f.persistRequest(f.r), 'pending');
});

test('shared signature rejects invalid HMAC and unsupported type before queueing', () => {
    const bad = request(sharedContexts[0]); bad.headers['x-signature'] = 'ts=1,v1=' + '0'.repeat(64);
    assert.throws(() => authenticateOrderDelivery(bad, sharedContexts), { status: 401 });
    const wrongType = request(sharedContexts[0]); wrongType.body.type = 'payment';
    assert.throws(() => authenticateOrderDelivery(wrongType, sharedContexts), { code: 'unsupported_event' });
});

test('shared signature: a malicious payload cannot poison a valid delivery with the same signed headers', async () => {
    const f = sharedFixture(); const altered = structuredClone(f.r); altered.body.application_id = '98765'; altered.body.live_mode = true;
    await f.persistRequest(altered); await f.makeWorker().processOne();
    assert.equal(f.events[0].payload.queue.state, 'blocked'); assert.equal(f.paymentWrites, 0);
    await f.persistRequest(f.r); await f.makeWorker().processOne();
    assert.equal(f.events.length, 2); assert.equal(f.events[0].processed, false); assert.equal(f.events[1].processed, true);
    assert.equal(f.paymentWrites, 1);
    const replay = structuredClone(f.r); replay.body.id = 'untrusted-other-id'; replay.body.data.status = 'failed'; replay.body.data.total_amount = '0.01';
    assert.equal(await f.persistRequest(replay), 'already_processed'); assert.equal(f.paymentWrites, 1);
});

test('shared signature: missing local binding retries after creation commit without consulting the wrong credential', async () => {
    const f = sharedFixture(); f.setBound(false); await f.persistRequest(f.r); await f.makeWorker().processOne();
    assert.equal(f.fetches, 0); assert.equal(f.events[0].processed, false);
    f.setBound(true); f.advance(); await f.makeWorker().processOne(); assert.equal(f.paymentWrites, 1);
});

test('shared signature: unavailable bound credential waits for its exact restoration rather than falling back', async () => {
    const f = sharedFixture(); await f.persistRequest(f.r); f.setContexts([f.other]);
    await f.makeWorker().processOne(); assert.equal(f.fetches, 0); assert.equal(f.paymentWrites, 0);
    assert.equal(f.events[0].processed, false); assert.equal(f.events[0].payload.queue.state, 'pending');
    f.setContexts(sharedContexts); f.advance(); await f.makeWorker().processOne(); assert.equal(f.paymentWrites, 1);
});

test('shared signature: legacy pending and reserved attempts and historical deliveries are preserved without assigning a realm', async () => {
    for (const reserved of [false, true]) {
        const f = sharedFixture(); delete f.order.snapshot.payment_context;
        if (reserved) f.order.payment_attempt_started_at = 'legacy-reserved';
        f.events.push({ id: 'legacy', event_id: 'old-notification', payload: { type: 'order' }, processed: true });
        const before = structuredClone(f.order), historical = structuredClone(f.events[0]);
        await f.persistRequest(f.r); await f.makeWorker().processOne();
        assert.deepEqual(f.order, before); assert.deepEqual(f.events[0], historical); assert.equal(f.fetches, 0);
        assert.equal(f.events[1].processed, false); assert.equal(f.events[1].payload.queue.reason, 'legacy_or_unbound_attempt');
        assert.equal(f.queries.some(sql => /^UPDATE orders|stock_movements|coupon_usages/.test(sql)), false);
    }
});

test('shared signature: two local matches are ambiguous and stay blocked without a provider or financial call', async () => {
    const f = sharedFixture(); f.setDuplicateOrder(true); await f.persistRequest(f.r); await f.makeWorker().processOne();
    assert.equal(f.fetches, 0); assert.equal(f.paymentWrites, 0); assert.equal(f.events[0].processed, false);
    assert.equal(f.events[0].payload.queue.reason, 'ambiguous_attempt_context');
});

test('shared signature: envelope tampering cannot change candidates or payload after persistence', async () => {
    for (const field of ['application_id', 'live_mode', 'candidate_credential_ids']) {
        const f = sharedFixture(); await f.persistRequest(f.r);
        f.events[0].payload.mp_webhook[field] = field === 'candidate_credential_ids' ? [f.other.credentialId] : 'tampered';
        await f.makeWorker().processOne(); assert.equal(f.fetches, 0); assert.equal(f.paymentWrites, 0);
        assert.equal(f.events[0].processed, false); assert.equal(f.events[0].payload.queue.reason, 'invalid_durable_proof');
    }
});

test('shared signature: official identity with a conflicting environment cannot approve', async () => {
    const f = sharedFixture(); await f.persistRequest(f.r);
    const provider = { ...f.provider, getWebhookCredentialIdentity: async c => {
        assert.equal(c.credentialId, f.context.credentialId); return { userId: '67890', mode: 'production' };
    } };
    await f.makeWorker({ provider }).processOne(); assert.equal(f.paymentWrites, 0);
    assert.equal(f.events[0].processed, false); assert.equal(f.events[0].payload.queue.reason, 'official_environment_mismatch');
});

test('shared signature: timeout and failed commit preserve the queue and restart applies exactly once', async () => {
    for (const failure of ['timeout', 'commit']) {
        const f = sharedFixture(); await f.persistRequest(f.r);
        if (failure === 'timeout') f.setFetchFailure(true); else f.failCommit();
        await f.makeWorker().processOne(); assert.equal(f.paymentWrites, 0); assert.equal(f.ledgerWrites, 0);
        assert.equal(f.events[0].processed, false); assert.equal(f.order.payment_status, 'pending');
        f.setFetchFailure(false); f.advance(); await f.makeWorker().processOne();
        assert.equal(f.paymentWrites, 1); assert.equal(f.ledgerWrites, 2); assert.equal(f.events[0].processed, true);
    }
});

test('shared signature: concurrent deliveries and replicas apply one state transition and preserve stock and coupons', async () => {
    const f = sharedFixture(); await f.persistRequest(f.r); await f.persistRequest(request(f.context, 2));
    await Promise.all([f.makeWorker().processOne(), f.makeWorker().processOne(), f.makeWorker().processOne()]);
    assert.equal(f.events.filter(e => e.processed).length, 2); assert.equal(f.paymentWrites, 1); assert.equal(f.ledgerWrites, 2);
    assert.equal(f.order.coupon_code, 'UNCHANGED'); assert.equal(f.order.snapshot.items[0].stock, 7);
});

test('shared signature: configured order of contexts does not change deduplication or resolution', async () => {
    const f = sharedFixture(); const original = authenticateOrderDelivery(f.r, sharedContexts);
    const reversed = authenticateOrderDelivery(f.r, [...sharedContexts].reverse());
    assert.equal(original.eventId, reversed.eventId); assert.deepEqual(original.payload, reversed.payload);
    await persistOrderDelivery(reversed, f.transaction); f.setContexts([...sharedContexts].reverse());
    await f.makeWorker().processOne(); assert.equal(f.paymentWrites, 1);
});

for (const mode of ['test', 'production']) test(`shared signature HTTP ${mode}: receipt commits with both contexts while active mode stays TEST`, async t => {
    const values = { MERCADO_PAGO_MODE: 'test',
        MERCADO_PAGO_TEST_ACCESS_TOKEN: 'shared-test-token', MERCADO_PAGO_TEST_WEBHOOK_SECRET: 'synthetic-shared-key', MERCADO_PAGO_TEST_APPLICATION_ID: '12345',
        MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN: 'shared-production-token', MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET: 'synthetic-shared-key', MERCADO_PAGO_PRODUCTION_APPLICATION_ID: '98765' };
    for (const [key, value] of Object.entries(values)) { const old = process.env[key]; process.env[key] = value;
        t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; }); }
    const f = sharedFixture(mode);
    t.mock.method(pg.Pool.prototype, 'query', async () => ({ rows: [] }));
    t.mock.method(pg.Pool.prototype, 'connect', f.connect);
    const app = express(); app.use(express.json()); app.use('/api', webhookRouter);
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const send = () => fetch(`http://127.0.0.1:${server.address().port}/api/webhooks/mercado-pago?data.id=${resourceId}&type=order`,
        { method: 'POST', headers: { ...f.r.headers, 'content-type': 'application/json' }, body: JSON.stringify(f.r.body) });
    assert.equal((await (await send()).json()).status, 'queued'); assert.equal(f.fetches, 0); assert.equal(f.paymentWrites, 0);
    assert.equal((await (await send()).json()).status, 'pending'); await f.makeWorker().processOne();
    assert.equal((await (await send()).json()).status, 'already_processed'); assert.equal(f.paymentWrites, 1);
    assert.equal(process.env.MERCADO_PAGO_MODE, 'test');
});
test('HTTP acknowledgement waits for durable database commit, not slow official API; DB outage receives 503', async t => {
    for (const [key, value] of Object.entries(env)) { const old = process.env[key]; process.env[key] = value;
        t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; }); }
    const f = fixture(); const client = await f.connect(); let outage = false, committed = false;
    t.mock.method(pg.Pool.prototype, 'query', async () => ({ rows: [] }));
    t.mock.method(pg.Pool.prototype, 'connect', async () => {
        if (outage) throw new Error('synthetic database offline');
        return { query: async (sql, args) => { const result = await client.query(sql, args); if (sql === 'COMMIT') committed = true; return result; }, release() {} };
    });
    t.mock.method(pool, 'query', async () => ({ rows: [] }));
    const app = express(); app.use(express.json()); app.use('/api', webhookRouter);
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const r = request(); const url = `http://127.0.0.1:${server.address().port}/api/webhooks/mercado-pago?data.id=${resourceId}&type=order`;
    const send = () => fetch(url, { method: 'POST', headers: { ...r.headers, 'content-type': 'application/json' }, body: JSON.stringify(r.body) });
    const started = performance.now(), response = await send();
    assert.equal(response.status, 200); assert.equal((await response.json()).status, 'queued'); assert.equal(committed, true);
    assert.ok(performance.now() - started < 1000); assert.equal(f.fetches, 0);
    assert.equal((await (await send()).json()).status, 'pending');
    outage = true; assert.equal((await send()).status, 503); assert.equal(f.events.length, 1);
});
