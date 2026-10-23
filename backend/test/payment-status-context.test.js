import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { readPaymentStatus, resolveStatusContext, legacyStatusEvidencePayload } from '../src/services/paymentStatus.js';
import { pool } from '../src/config/db.js';
import orders from '../src/routes/orders.js';

const contexts = ['test', 'production'].map((mode, i) => ({ mode, credentialId: `synthetic-${mode}`,
    applicationId: String(100 + i), secret: 'synthetic-shared-secret', accessToken: `synthetic-${mode}-token` }));
const base = () => ({ id: '11111111-1111-4111-8111-111111111111', user_id: 'owner', order_number: 'DH-SYNTHETIC',
    total: '100.00', payment_status: 'pending', status: 'recebido', payment_method: 'credito',
    mercado_pago_order_id: 'ORDSYNTHETIC0001', mercado_pago_payment_id: 'PAYSYNTHETIC', snapshot: {} });
function bound(mode = 'test') {
    const order = base(), c = contexts.find(c => c.mode === mode);
    order.snapshot.payment_context = { version: 1, mode, credential_id: c.credentialId,
        application_id: c.applicationId, provider_order_id: order.mercado_pago_order_id };
    return order;
}
const resource = (order, mode = 'test') => ({ mp_order_id: order.mercado_pago_order_id, mp_payment_id: order.mercado_pago_payment_id,
    external_reference: order.order_number, total_amount: '100.00', transaction_amount: '100.00', currency_id: 'BRL',
    payment_count: 1, order_status: 'action_required', transaction_status: 'action_required', mp_status: 'action_required',
    mp_status_detail: 'pending_challenge', transaction_status_detail: 'pending_challenge', resource_type: 'online',
    user_id: mode === 'test' ? '200' : '201', application_id: contexts.find(c => c.mode === mode).applicationId,
    live_mode: null, challenge_url: 'https://www.mercadopago.com.br/auth/card/validation/pages/synthetic' });
function fixture(order, mode = 'test') {
    const calls = [], queries = [], state = structuredClone(order);
    const provider = { async getWebhookCredentialIdentity(context) {
        calls.push(['identity', context.mode]); return { mode: context.mode, userId: context.mode === 'test' ? '200' : '201' };
    }, async getOrderStatus(id, context) { calls.push(['resource', context.mode, id]); return resource(order, mode); },
    mapPaymentStatus: () => 'pending' };
    const client = { async query(sql) {
        queries.push(sql);
        if (sql.includes('FROM orders')) return { rows: [structuredClone(state)] };
        if (sql.includes('to_regclass')) return { rows: [{ relation: null }] };
        if (sql.startsWith('UPDATE orders')) {
            Object.assign(state, { mercado_pago_status: 'action_required', mercado_pago_status_detail: 'pending_challenge',
                mercado_pago_external_reference: state.order_number, payment_attempt_started_at: null });
        }
        return { rows: [] };
    } };
    let lock = Promise.resolve();
    const transaction = async callback => {
        const previous = lock; let release; lock = new Promise(resolve => { release = resolve; });
        await previous;
        try { return await callback(client); } finally { release(); }
    };
    return { provider, calls, queries, state, options: { provider, contexts, transaction,
        db: { async query(sql) { queries.push(sql); return { rows: [] }; } } } };
}
function proof(order, mode = 'test') {
    const c = contexts.find(c => c.mode === mode);
    const evidence = { version: 1, source: 'official_order_read', provider_order_id: order.mercado_pago_order_id,
        mode, credential_id: c.credentialId, application_id: c.applicationId, seller_id: mode === 'test' ? '200' : '201' };
    evidence.seal = crypto.createHmac('sha256', c.secret).update(legacyStatusEvidencePayload(order, evidence)).digest('hex');
    return evidence;
}

for (const mode of ['test', 'production']) test(`historical ${mode} lookup ignores opposite active mode and uses original identity/application/resource`, async t => {
    const previous = process.env.MERCADO_PAGO_MODE; process.env.MERCADO_PAGO_MODE = mode === 'test' ? 'production' : 'test';
    t.after(() => { if (previous === undefined) delete process.env.MERCADO_PAGO_MODE; else process.env.MERCADO_PAGO_MODE = previous; });
    const o = bound(mode), f = fixture(o, mode);
    const result = await readPaymentStatus(o, f.options);
    assert.equal(result.reconciliation_required, false); assert.equal(result.mp_status, 'action_required');
    assert.deepEqual(f.calls.map(c => c[1]), [mode, mode]);
});

test('unbound legacy resource and reservation remain byte-for-byte unchanged, no provider calls or writes', async () => {
    for (const linked of [true, false]) {
        const o = base(); if (!linked) { o.mercado_pago_order_id = null; o.payment_attempt_started_at = 'open-reservation'; }
        const original = JSON.stringify(o), f = fixture(o);
        const result = await readPaymentStatus(o, f.options);
        assert.equal(result.reconciliation_required, true); assert.equal(result.payment_status, 'pending');
        assert.equal(result.challenge_url, null); assert.equal(JSON.stringify(o), original);
        assert.equal(f.calls.length, 0); assert.ok(f.queries.every(q => q.startsWith('SELECT')));
    }
});

test('only sealed independent official evidence permits a legacy GET, which remains read-only even if officially approved', async () => {
    const o = base(), f = fixture(o), evidence = proof(o);
    f.options.db.query = async sql => { f.queries.push(sql); return { rows: [{ changes: evidence }] }; };
    f.provider.mapPaymentStatus = () => 'approved';
    const original = JSON.stringify(o), result = await readPaymentStatus(o, f.options);
    assert.equal(result.context_verified, true); assert.equal(result.status_read_only, true);
    assert.equal(result.provider_payment_status, 'approved'); assert.equal(result.payment_status, 'pending');
    assert.equal(result.reconciliation_required, true); assert.equal(result.challenge_url, null);
    assert.equal(JSON.stringify(o), original); assert.ok(f.queries.every(q => q.startsWith('SELECT')));
});

test('legacy seal binds local order, resource, environment, application, seller and credential; no prefix or notification hint is trusted', () => {
    const o = base(), original = proof(o);
    assert.equal(resolveStatusContext(o, contexts, [original]).context.mode, 'test');
    assert.equal(resolveStatusContext(o, contexts, [original, original]).context.mode, 'test');
    for (const key of ['source', 'mode', 'provider_order_id', 'application_id', 'seller_id', 'credential_id', 'seal']) {
        assert.throws(() => resolveStatusContext(o, contexts, [{ ...original, [key]: 'tampered' }]));
    }
    assert.throws(() => resolveStatusContext({ ...o, id: 'another-order' }, contexts, [original]));
    assert.throws(() => resolveStatusContext(o, contexts, [original, proof(o, 'production')]));
    assert.throws(() => resolveStatusContext(o, contexts, [{ live_mode: false, application_id: '100' }]));
});

test('incomplete or contradictory bound context never falls back to legacy evidence or active credentials', async () => {
    for (const key of ['version', 'mode', 'credential_id', 'application_id', 'provider_order_id']) {
        const o = bound(); o.snapshot.payment_context[key] = 'tampered'; const f = fixture(o);
        const result = await readPaymentStatus(o, f.options);
        assert.equal(result.reconciliation_required, true); assert.equal(f.calls.length, 0); assert.equal(f.queries.length, 0);
    }
    const o = bound(), f = fixture(o); f.options.contexts = [contexts[1]];
    assert.equal((await readPaymentStatus(o, f.options)).reconciliation_required, true); assert.equal(f.calls.length, 0);
});

test('404 and timeout return reconciliation, never try the other credential, change money or release reservations', async () => {
    for (const status of [404, 503]) {
        const o = bound(), f = fixture(o);
        f.provider.getOrderStatus = async (id, context) => { f.calls.push(['resource', context.mode]); throw Object.assign(new Error('synthetic'), { status }); };
        const result = await readPaymentStatus(o, f.options);
        assert.equal(result.reconciliation_required, true); assert.deepEqual(f.calls.map(c => c[1]), ['test', 'test']);
        assert.equal(f.queries.length, 0);
    }
});

test('official identity, application, seller, environment, resource and amount mismatches fail before any transaction', async () => {
    for (const override of [{ application_id: '101' }, { user_id: '201' }, { live_mode: true },
        { mp_order_id: 'other' }, { total_amount: '0.01' }, { resource_type: 'offline' }]) {
        const o = bound(), f = fixture(o); f.provider.getOrderStatus = async () => ({ ...resource(o), ...override });
        assert.equal((await readPaymentStatus(o, f.options)).reconciliation_required, true);
        assert.equal(f.queries.length, 0);
    }
    const o = bound(), f = fixture(o);
    f.provider.getWebhookCredentialIdentity = async () => ({ mode: 'production', userId: '201' });
    assert.equal((await readPaymentStatus(o, f.options)).reconciliation_required, true); assert.equal(f.calls.length, 0);
});

test('concurrent duplicate status reads apply once, no stock/coupon changes, and a stale response cannot downgrade a webhook', async () => {
    const o = bound(), f = fixture(o);
    await Promise.all([readPaymentStatus(o, f.options), readPaymentStatus(o, f.options)]);
    assert.equal(f.queries.filter(q => q.startsWith('UPDATE orders')).length, 1);
    assert.equal(f.queries.filter(q => q.startsWith('INSERT INTO order_events')).length, 1);
    assert.ok(f.queries.every(q => !/UPDATE products|stock_movements|coupon_usages/.test(q)));
    const g = fixture(o); g.state.payment_status = 'approved'; g.state.status = 'pagamento_aprovado';
    const result = await readPaymentStatus(o, g.options);
    assert.equal(result.payment_status, 'approved'); assert.ok(g.queries.every(q => q.startsWith('SELECT')));
});

test('real HTTP route protects ownership and makes legacy lookups read-only with a visible reconciliation state', async t => {
    const o = base(), queries = [], oldFetch = global.fetch;
    t.mock.method(pool, 'query', async (sql, args) => {
        queries.push(sql);
        if (sql.includes('FROM orders')) return { rows: args.length === 1 || args[1] === 'owner' ? [structuredClone(o)] : [] };
        if (sql.includes('FROM audit_logs')) return { rows: [] };
        throw new Error('Mutation forbidden');
    });
    global.fetch = (url, options) => {
        assert.ok(!String(url).includes('api.mercadopago.com'), 'legacy cannot call provider'); return oldFetch(url, options);
    };
    t.after(() => { global.fetch = oldFetch; });
    const app = express();
    app.use((req, res, next) => { if (req.headers['x-owner']) { req.user = { id: req.headers['x-owner'], role: 'customer' }; req.authProvider = 'supabase'; } next(); });
    app.use('/api', orders);
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const url = `http://127.0.0.1:${server.address().port}/api/orders/${o.id}/payment/status`;
    assert.equal((await oldFetch(url)).status, 401);
    assert.equal((await oldFetch(url, { headers: { 'x-owner': 'other' } })).status, 404);
    for (let i = 0; i < 2; i++) {
        const response = await oldFetch(url, { headers: { 'x-owner': 'owner' } }); assert.equal(response.status, 200);
        const result = await response.json(); assert.equal(result.reconciliation_required, true); assert.match(result.status_message, /conciliação/);
        assert.equal(result.payment_status, 'pending');
    }
    assert.ok(queries.every(q => q.startsWith('SELECT')));
});
