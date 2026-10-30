import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';
import orderRouter from '../src/routes/orders.js';
import { pool } from '../src/config/db.js';
import { installmentDefaults, makeInstallmentApproval } from '../src/lib/installmentPolicy.js';

const methods = [{ id: 'visa', name: 'Visa', status: 'active', payment_type_id: 'credit_card' },
    { id: 'debelo', name: 'Elo Débito', status: 'active', payment_type_id: 'debit_card' }];

async function fixture(t, method, state = 'pending') {
    const oldFetch = global.fetch;
    for (const [key, value] of Object.entries({ MERCADO_PAGO_ACCESS_TOKEN: 'mock-only', MERCADO_PAGO_PUBLIC_KEY: 'mock-public',
        MERCADO_PAGO_MODE: 'test', MERCADO_PAGO_WEBHOOK_SECRET: 'mock-secret',
        MERCADO_PAGO_APPLICATION_ID: '12345',
        MERCADO_PAGO_TEST_ACCESS_TOKEN: 'mock-only', MERCADO_PAGO_TEST_WEBHOOK_SECRET: 'mock-secret',
        MERCADO_PAGO_TEST_APPLICATION_ID: '12345', MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN: 'synthetic-production-only',
        MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET: 'mock-secret', MERCADO_PAGO_PRODUCTION_APPLICATION_ID: '54321',
        CREDIT_INSTALLMENTS_APPROVED: 'false', CARD_3DS_ENABLED: 'false', PIX_DISCOUNT_ENABLED: 'false' })) {
        const previous = process.env[key]; process.env[key] = value;
        t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
    }
    const order = { id: '11111111-1111-4111-8111-111111111111', user_id: 'owner', order_number: 'DH-MOCK-1',
        status: 'recebido', payment_status: 'pending', payment_method: method, subtotal: 100, discount: 5,
        shipping_cost: 19.95, total: 114.95, coupon_code: 'KEEP',
        snapshot: { customer: { email: 'synthetic@example.invalid', name: 'Synthetic Person', cpf: '12345678909' },
            items: [{ price_promotion: false }], discount_breakdown: { coupon: 5, promotion: 0, pix: 0 } } };
    let financialPosts = 0; let providerState = state; let updateCount = 0; let lockTail = Promise.resolve();
    let createError = null; let providerTotal = '114.95'; let installmentRate = 0; let connectionCount = 0;
    const queries = []; const payloads = []; const officialReads = [];
    let managed = null, offeredCosts = null;
    const q = async (sql, args = []) => {
        queries.push(sql);
        if (sql === 'SELECT 1' || ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
        if (sql.includes('FROM orders')) return { rows: args.length < 2 || args[1] === order.user_id ? [structuredClone(order)] : [] };
        if (sql.includes("key = 'credit_installments'")) return { rows: managed ? [{ value: structuredClone(managed) }] : [] };
        if (sql.includes('FROM settings')) return { rows: [{ value: { pix_enabled: true, card_enabled: true, debit_card_enabled: true, max_installments: 6, interest_free_installments: 6, pix_discount: 5 } }] };
        if (sql.includes('to_regclass')) return { rows: [{ relation: null }] };
        if (sql.startsWith('UPDATE orders SET payment_method')) {
            Object.assign(order, { payment_method: args[0], discount: args[1], total: args[2], snapshot: JSON.parse(args[3]) });
            return { rows: [structuredClone(order)] };
        }
        if (sql.startsWith('UPDATE orders SET snapshot')) {
            order.snapshot.payment_context = JSON.parse(args[1]);
            return { rows: [] };
        }
        if (sql.includes('payment_attempt_started_at = now()')) {
            if (order.payment_attempt_started_at || order.mercado_pago_order_id || order.status === 'cancelado'
                || order.payment_status !== 'pending' || (sql.includes("payment_method = 'pix'") && order.payment_method !== 'pix')
                || (sql.includes('payment_method = $2') && order.payment_method !== args[1])
                || (sql.includes('total = $3') && Number(order.total) !== Number(args[2]))
                || (sql.includes('total = $2') && Number(order.total) !== Number(args[1]))) return { rows: [] };
            order.payment_attempt_started_at = 'reserved'; order.payment_attempt_method = method === 'pix' ? 'pix' : 'card';
            if (sql.includes('jsonb_set')) order.snapshot.card_installment_offer = JSON.parse(args[3]);
            return { rows: [{ id: order.id }] };
        }
        if (sql.includes("UPDATE orders SET payment_provider = 'mercado_pago'")) {
            const approved = sql.includes('paid_at =');
            const pix = sql.includes('pix_qr_code =');
            Object.assign(order, { payment_provider: 'mercado_pago', mercado_pago_order_id: args[0], mercado_pago_payment_id: args[1],
                mercado_pago_external_reference: approved || !pix ? args[2] : args[4],
                mercado_pago_status: approved || !pix ? args[3] : args[2],
                mercado_pago_status_detail: approved || !pix ? args[4] : args[3], payment_status: pix ? args[8] : args[5],
                payment_attempt_started_at: null });
            if (approved) { order.paid_at = 'paid'; order.status = args[6]; }
            if (pix) Object.assign(order, { pix_qr_code: args[5], pix_qr_code_base64: args[6], pix_expiration_at: args[7] });
            updateCount++; return { rows: [] };
        }
        if (sql.startsWith('UPDATE orders SET installments')) { order.installments = args[0]; return { rows: [] }; }
        if (sql.startsWith('INSERT INTO audit_logs') || sql.startsWith('INSERT INTO order_events')) return { rows: [] };
        assert.fail(`Unexpected mocked database query: ${sql}`);
    };
    const connect = async () => {
        connectionCount++;
        let releaseLock;
        return { async query(sql, args) {
            if (sql.includes('credit-installment-settings')) return { rows: [] };
            if (sql.includes('pg_advisory_lock(') || sql.includes('pg_advisory_xact_lock(')) {
                const previous = lockTail;
                lockTail = new Promise(resolve => { releaseLock = resolve; });
                await previous; return { rows: [] };
            }
            if (sql.includes('pg_advisory_unlock(') || sql === 'COMMIT' || sql === 'ROLLBACK') {
                releaseLock?.(); releaseLock = null; return { rows: [] };
            }
            return q(sql, args);
        }, release() { releaseLock?.(); } };
    };
    t.mock.method(pool, 'query', q); t.mock.method(pool, 'connect', connect);
    t.mock.method(pg.Pool.prototype, 'query', q); t.mock.method(pg.Pool.prototype, 'connect', connect);
    const resource = () => ({ id: 'ORD-MOCK', integration_data: { application_id: '12345' }, user_id: '67890', type: 'online',
        external_reference: order.order_number, total_amount: providerTotal, currency: 'BRL',
        status: providerState === 'approved' ? 'processed' : providerState, status_detail: providerState === 'approved' ? 'accredited' : providerState === 'failed' ? 'failed' : 'pending_challenge',
        transactions: { payments: [{ id: 'PAY-MOCK', amount: '114.95', status: providerState === 'approved' ? 'processed' : providerState,
            status_detail: providerState === 'approved' ? 'accredited' : providerState === 'failed' ? 'failed' : 'pending_challenge',
            payment_method: { type: method === 'pix' ? 'bank_transfer' : method === 'debito' ? 'debit_card' : 'credit_card',
                id: method === 'debito' ? 'debelo' : 'visa', issuer_id: '123',
                installments: payloads.at(-1)?.transactions.payments[0].payment_method.installments || 1,
                installment_amount: offeredCosts?.[0]?.installment_amount,
                qr_code: method === 'pix' ? 'MOCK-QR' : null,
                transaction_security: providerState === 'action_required' ? { url: 'https://www.mercadopago.com.br/auth/card/validation/pages/mock' } : undefined } }] } });
    global.fetch = async (url, options = {}) => {
        if (!String(url).startsWith('https://api.mercadopago.com')) return oldFetch(url, options);
        const path = new URL(url).pathname;
        if (path === '/users/me' || path.startsWith('/v1/orders/')) {
            officialReads.push({ path, method: options.method || 'GET', original_context: options.headers.Authorization === 'Bearer mock-only' });
        }
        if (path === '/users/me') return { ok: true, json: async () => ({ id: 67890, tags: ['test_user'] }) };
        if (path === '/v1/payment_methods') return { ok: true, json: async () => methods };
        if (path === '/v1/payment_methods/installments') {
            assert.equal(new URL(url).searchParams.get('amount'), '114.95');
            if (new URL(url).searchParams.has('issuer.id')) assert.equal(new URL(url).searchParams.get('issuer.id'), '123');
            return { ok: true, json: async () => [{ payment_method_id: 'visa', payment_type_id: 'credit_card', issuer: { id: '123' },
                payer_costs: offeredCosts || [{ installments: 6, installment_rate: installmentRate, total_amount: '114.95' }] }] };
        }
        if (path === '/v1/orders' && options.method === 'POST') {
            financialPosts++; payloads.push(JSON.parse(options.body));
            assert.equal(options.headers['X-Idempotency-Key'], `${method === 'pix' ? 'pix' : 'card'}-${order.id}`);
            if (createError) throw createError;
            return { ok: true, json: async () => resource() };
        }
        if (path === '/v1/orders/ORD-MOCK' && !options.method) return { ok: true, json: async () => resource() };
        assert.fail(`Unexpected mock provider call: ${options.method} ${path}`);
    };
    t.after(() => { global.fetch = oldFetch; });
    const app = express(); app.use(express.json());
    app.use((req, res, next) => { if (req.headers['x-mock-owner']) {
        req.user = { id: req.headers['x-mock-owner'], role: 'customer', email: 'synthetic@example.invalid' }; req.authProvider = 'supabase';
    } next(); });
    app.use('/api', orderRouter);
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const request = (path, body = {}, owner = 'owner', httpMethod = 'POST') => oldFetch(`http://127.0.0.1:${server.address().port}/api/orders/${order.id}/payment/${path}`, {
        method: httpMethod, headers: { 'content-type': 'application/json', ...(owner ? { 'x-mock-owner': owner } : {}),
            ...(body.idempotencyKey ? { 'x-idempotency-key': body.idempotencyKey } : {}) },
        ...(httpMethod === 'GET' ? {} : { body: JSON.stringify(body) }),
    });
    const card = { card_token: 'mock-token', payment_method_id: method === 'debito' ? 'debelo' : 'visa',
        payment_type_id: method === 'debito' ? 'debit_card' : 'credit_card', issuer_id: '123', installments: 1, total: 0.01 };
    return { order, request, card, queries, payloads, officialReads, setProviderState: value => { providerState = value; },
        setCreateError: value => { createError = value; }, setProviderTotal: value => { providerTotal = value; },
        setInstallmentRate: value => { installmentRate = value; },
        setManaged: value => { managed = value ? { ...value, module_version: 1 } : null; },
        setOfferedCosts: value => { offeredCosts = value; },
        get financialPosts() { return financialPosts; }, get updateCount() { return updateCount; },
        get connectionCount() { return connectionCount; } };
}

for (const method of ['credito', 'debito', 'pix']) {
    for (const status of ['approved', 'pending', 'failed']) test(`${method} ${status}: authoritative totals, one concurrent charge and stable retry`, async t => {
        const f = await fixture(t, method, status); const path = method === 'pix' ? 'pix' : 'card';
        const responses = await Promise.all([f.request(path, f.card), f.request(path, f.card)]);
        assert.ok(responses.some(response => response.status === 200), JSON.stringify({ statuses: responses.map(response => response.status), posts: f.financialPosts, queries: f.queries.slice(-7) }));
        assert.ok(responses.every(response => [200, 409].includes(response.status)));
        assert.equal(f.financialPosts, 1); assert.equal(f.payloads[0].total_amount, '114.95');
        assert.equal(f.payloads[0].transactions.payments[0].amount, '114.95');
        assert.equal(f.payloads[0].transactions.payments[0].payment_method.type, method === 'pix' ? 'bank_transfer' : method === 'debito' ? 'debit_card' : 'credit_card');
        if (method !== 'pix') assert.equal('issuer_id' in f.payloads[0].transactions.payments[0].payment_method, false);
        assert.equal(f.order.payment_status, status === 'failed' ? 'rejected' : status);
        const retry = await f.request(path, f.card); assert.equal(retry.status, 200); assert.equal(f.financialPosts, 1);
        assert.equal(f.queries.some(sql => /UPDATE products|stock_movements|coupon_usages/.test(sql)), false);
    });
}

test('card challenge remains pending; only verified provider readback can approve it', async t => {
    const f = await fixture(t, 'debito', 'action_required');
    process.env.CARD_3DS_ENABLED = 'true';
    const response = await f.request('card', f.card); const pending = await response.json();
    assert.equal(response.status, 200); assert.equal(pending.payment_status, 'pending'); assert.match(pending.challenge_url, /^https:\/\/www\.mercadopago\.com\.br/);
    assert.deepEqual(f.payloads[0].config.online.transaction_security, { validation: 'on_fraud_risk', liability_shift: 'required' });
    f.setProviderState('approved'); const approved = await f.request('status', {}, 'owner', 'GET');
    assert.equal((await approved.json()).payment_status, 'approved'); assert.equal(f.financialPosts, 1);
});

test('ownership, authentication, wrong card type and debit installments reject before financial reservation', async t => {
    const f = await fixture(t, 'debito');
    assert.equal((await f.request('card', f.card, null)).status, 401);
    assert.equal((await f.request('card', f.card, 'other')).status, 404);
    assert.equal((await f.request('card', { ...f.card, payment_type_id: 'credit_card' })).status, 400);
    assert.equal((await f.request('card', { ...f.card, installments: 2 })).status, 400);
    assert.equal(f.financialPosts, 0); assert.equal(f.order.payment_attempt_started_at, undefined);
});

for (const method of ['credito', 'debito', 'pix']) test(`${method}: lock holder reserves and persists on one connection without pool starvation`, async t => {
    const f = await fixture(t, method, 'approved');
    assert.equal((await f.request(method === 'pix' ? 'pix' : 'card', f.card)).status, 200);
    assert.equal(f.connectionCount, 1); assert.equal(f.financialPosts, 1);
    assert.equal(f.order.payment_status, 'approved');
});

test('method swap after the card read cannot submit stale method or stale total', async t => {
    const f = await fixture(t, 'credito');
    // Simulate a serialized switch winning the shared lock before reservation.
    const connect = pool.connect;
    t.mock.method(pool, 'connect', async () => { f.order.payment_method = 'debito'; f.order.total = 99; return connect(); });
    assert.equal((await f.request('card', f.card)).status, 409);
    assert.equal(f.financialPosts, 0);
});

for (const method of ['credito', 'debito', 'pix']) test(`${method}: ambiguous timeout never opens a second attempt`, async t => {
    const f = await fixture(t, method); const path = method === 'pix' ? 'pix' : 'card';
    f.setCreateError(Object.assign(new Error('mock network timeout'), { name: 'TimeoutError' }));
    assert.equal((await f.request(path, f.card)).status, 500);
    assert.equal((await f.request(path, f.card)).status, 409);
    assert.equal(f.financialPosts, 1); assert.equal(f.order.payment_attempt_started_at, 'reserved');
    assert.equal((await f.request('method/preview', { payment_method: method === 'pix' ? 'debito' : 'pix' })).status, 409);
});

test('six installments require commercial gate AND official zero-rate plan before creating a charge', async t => {
    const f = await fixture(t, 'credito', 'approved');
    const installments = { ...f.card, installments: 6, bin: '503143' };
    assert.equal((await f.request('card', installments)).status, 409); assert.equal(f.financialPosts, 0);
    process.env.CREDIT_INSTALLMENTS_APPROVED = 'true';
    f.setInstallmentRate(10);
    assert.equal((await f.request('card', installments)).status, 409); assert.equal(f.financialPosts, 0);
    f.setInstallmentRate(0);
    assert.equal((await f.request('card', installments)).status, 200);
    assert.equal(f.payloads[0].transactions.payments[0].payment_method.installments, 6); assert.equal(f.financialPosts, 1);
});

function managedConfig() {
    const config = { ...installmentDefaults, enabled: true };
    return { ...config, approval: makeInstallmentApproval(config, 'Teste', 'admin') };
}
test('managed 12x with buyer interest is confirmed and frozen once; retry ignores later configuration changes', async t => {
    const f = await fixture(t, 'credito', 'approved'); f.setManaged(managedConfig());
    f.setOfferedCosts([{ installments: 12, installment_rate: 20, total_amount: 137.94, installment_amount: 11.50 }]);
    const preview = await (await f.request('installments', { bin: '54808328' })).json();
    assert.equal(preview.offers[0].buyer_total, 137.94);
    const body = { ...f.card, installments: 12, bin: '54808328', expected_offer: preview.offers[0] };
    const responses = await Promise.all([f.request('card', body), f.request('card', body)]);
    assert.ok(responses.some(r => r.status === 200)); assert.equal(f.financialPosts, 1);
    assert.equal(f.payloads[0].total_amount, '114.95'); // Never add provider financing twice.
    assert.equal(f.order.total, 114.95); assert.equal(f.order.snapshot.card_installment_offer.buyer_total, 137.94);
    f.setManaged({ ...managedConfig(), enabled: false });
    assert.equal((await f.request('card', body)).status, 200); assert.equal(f.financialPosts, 1);
    assert.equal(f.order.snapshot.card_installment_offer.installments, 12);
    assert.equal(f.queries.some(sql => /UPDATE products|stock_movements|coupon_usages/.test(sql)), false);
});
test('managed stale or altered quote never reserves inventory, consumes a coupon or starts a charge', async t => {
    const f = await fixture(t, 'credito'); f.setManaged(managedConfig());
    f.setOfferedCosts([{ installments: 12, installment_rate: 20, total_amount: 137.94, installment_amount: 11.50 }]);
    const preview = await (await f.request('installments', { bin: '54808328' })).json();
    const body = { ...f.card, installments: 12, bin: '54808328', expected_offer: { ...preview.offers[0], buyer_total: 114.95 } };
    const rejected = await f.request('card', body); assert.equal(rejected.status, 409);
    assert.equal((await rejected.json()).attempt_started, false);
    const connect = pool.connect;
    t.mock.method(pool, 'connect', async () => { f.setManaged({ ...managedConfig(), min_installment_amount: 20 }); return connect(); });
    assert.equal((await f.request('card', { ...body, expected_offer: preview.offers[0] })).status, 409);
    assert.equal(f.financialPosts, 0); assert.equal(f.order.payment_attempt_started_at, undefined);
    assert.equal(f.order.coupon_code, 'KEEP'); assert.equal(f.order.discount, 5);
});
test('managed credit settings never permit Elo Debit installments or alter Pix totals', async t => {
    const f = await fixture(t, 'debito'); f.setManaged(managedConfig());
    assert.equal((await f.request('card', { ...f.card, installments: 12 })).status, 400);
    assert.equal((await f.request('installments', { bin: '54808328' })).status, 409);
    assert.equal((await f.request('card', f.card)).status, 200); assert.equal(f.payloads[0].total_amount, '114.95');
});

test('wrong provider amount requires reconciliation and cannot approve or reset the reservation', async t => {
    const f = await fixture(t, 'credito', 'approved'); f.setProviderTotal('1.00');
    assert.equal((await f.request('card', f.card)).status, 409);
    assert.equal(f.order.payment_status, 'pending'); assert.equal(f.order.paid_at, undefined);
    assert.equal((await f.request('card', f.card)).status, 409); assert.equal(f.financialPosts, 1);
});

test('HTTP status after TEST to production switch still sends only the original TEST credential; repeated concurrent GETs do not charge or change stock/coupons', async t => {
    const f = await fixture(t, 'credito', 'action_required');
    assert.equal((await f.request('card', f.card)).status, 200);
    process.env.MERCADO_PAGO_MODE = 'production'; f.officialReads.length = 0;
    const results = await Promise.all([f.request('status', {}, 'owner', 'GET'), f.request('status', {}, 'owner', 'GET')]);
    for (const response of results) {
        const result = await response.json(); assert.equal(response.status, 200);
        assert.equal(result.mp_status, 'action_required'); assert.equal(result.reconciliation_required, false);
    }
    assert.ok(f.officialReads.length >= 4);
    assert.ok(f.officialReads.every(r => r.original_context && r.method === 'GET'));
    assert.equal(f.financialPosts, 1);
    assert.equal(f.queries.some(sql => /UPDATE products|stock_movements|coupon_usages/.test(sql)), false);
});

test('HTTP change preview, ownership, idempotency and competing card creation use one locked order', async t => {
    const f = await fixture(t, 'credito');
    assert.equal((await f.request('method/preview', { payment_method: 'debito' }, null)).status, 401);
    assert.equal((await f.request('method/preview', { payment_method: 'debito' }, 'other')).status, 404);
    const preview = await (await f.request('method/preview', { payment_method: 'debito' })).json();
    assert.equal(preview.total, 114.95);
    const body = { payment_method: 'debito', expected_pricing: preview, idempotencyKey: 'synthetic-change-http-001' };
    const [change, charge] = await Promise.all([f.request('method', body), f.request('card', f.card)]);
    assert.ok([200, 409].includes(change.status)); assert.ok([200, 400, 409].includes(charge.status));
    assert.ok(f.financialPosts <= 1);
    if (change.status === 200) {
        assert.equal(f.order.payment_method, 'debito'); assert.equal(f.financialPosts, 0);
        assert.equal((await f.request('method', body)).status, 200);
    } else { assert.equal(f.order.payment_method, 'credito'); assert.equal(f.financialPosts, 1); }
    assert.equal(f.queries.some(sql => /UPDATE products|stock_movements|coupon_usages/.test(sql)), false);
});
