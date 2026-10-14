import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';
import router from '../src/routes/installments.js';
import { pool } from '../src/config/db.js';

async function fixture(t) {
    let stored = null, mode = 'supported', charges = 0, audit = [], tail = Promise.resolve();
    const oldFetch = global.fetch;
    for (const [key, value] of Object.entries({ MERCADO_PAGO_ACCESS_TOKEN: 'mock-only', MERCADO_PAGO_MODE: 'test' })) {
        const previous = process.env[key]; process.env[key] = value;
        t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
    }
    const q = async (sql, args = []) => {
        if (['SELECT 1', 'BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
        if (sql.startsWith('SELECT value FROM settings')) return { rows: stored ? [{ value: structuredClone(stored) }] : [] };
        if (sql.startsWith('INSERT INTO settings') || sql.startsWith('UPDATE settings')) { stored = JSON.parse(args[0]); return { rows: [{ id: 'setting' }] }; }
        if (sql.startsWith('INSERT INTO audit_logs')) { assert.ok(sql.includes('changes')); audit.push(args); return { rows: [] }; }
        assert.fail(sql);
    };
    const connect = async () => { let release;
        return { query: async (sql, args) => {
            if (sql.includes('pg_advisory_xact_lock')) { const before = tail; tail = new Promise(resolve => { release = resolve; }); await before; return { rows: [] }; }
            if (['COMMIT', 'ROLLBACK'].includes(sql)) { release?.(); release = null; }
            return q(sql, args);
        }, release: () => { release?.(); } };
    };
    t.mock.method(pool, 'query', q); t.mock.method(pool, 'connect', connect);
    t.mock.method(pg.Pool.prototype, 'query', q); t.mock.method(pg.Pool.prototype, 'connect', connect);
    global.fetch = async (url, opts = {}) => {
        if (!String(url).startsWith('https://api.mercadopago.com')) return oldFetch(url, opts);
        if (opts.method === 'POST') { charges++; assert.fail('Financial POST forbidden in simulator'); }
        if (mode === 'offline') throw new Error('mock provider unavailable');
        const amount = Number(new URL(url).searchParams.get('amount'));
        return { ok: true, json: async () => [{ payment_method_id: 'master', payment_type_id: 'credit_card', issuer: { id: 12749 },
            payer_costs: Array.from({ length: mode === 'missing12' ? 11 : 12 }, (_, i) => { const n = i + 1, rate = mode === 'interest-all' ? n > 1 ? 20 : 0 : n > 6 ? 20 : 0;
                const total = amount * (rate ? 1.2 : 1); return { installments: n, installment_rate: rate, installment_amount: Math.round(total / n * 100) / 100, total_amount: total.toFixed(2) }; }) }] };
    };
    t.after(() => { global.fetch = oldFetch; });
    const app = express(); app.use(express.json()); app.use((req, _res, next) => {
        if (req.headers['x-mock-role']) { req.user = { id: 'admin', role: req.headers['x-mock-role'] }; req.authProvider = req.headers['x-mock-auth'] || 'supabase'; } next();
    }); app.use('/api', router);
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const request = (path = '', method = 'GET', body = null, role = 'admin', auth = 'supabase') => oldFetch(`http://127.0.0.1:${server.address().port}/api/${path.startsWith('payments/') ? path : `admin/payments/installments${path}`}`, {
        method, headers: { 'content-type': 'application/json', ...(role ? { 'x-mock-role': role, 'x-mock-auth': auth } : {}) }, ...(body && method !== 'GET' ? { body: JSON.stringify(body) } : {}) });
    const args = async () => { const get = await (await request()).json(); return { config: get.config, expected_version: get.version, amount: 120, bin: '54808328' }; };
    return { request, args, get stored() { return stored; }, get charges() { return charges; }, get audits() { return audit; }, setMode: value => { mode = value; } };
}
test('only Supabase administrators may read, save, simulate or approve installments', async t => {
    const f = await fixture(t);
    for (const [path, method] of [['', 'GET'], ['', 'PATCH'], ['/simulate', 'POST'], ['/approve', 'POST']]) {
        assert.equal((await f.request(path, method, {}, '')).status, 401);
        assert.equal((await f.request(path, method, {}, 'customer')).status, 403);
        assert.equal((await f.request(path, method, {}, 'admin', 'express')).status, 401);
    }
    assert.equal(f.stored, null); assert.equal(f.audits.length, 0);
});
test('simulator returns actual buyer financing with unknown boutique costs and never creates payments', async t => {
    const f = await fixture(t), args = await f.args();
    const result = await (await f.request('/simulate', 'POST', args)).json();
    assert.equal(result.offers.length, 12); assert.equal(result.provider_options.at(-1).buyer_total, 144);
    assert.equal(result.offers.at(-1).processing_fee, null); assert.equal(f.charges, 0); assert.equal(f.stored, null);
    f.setMode('interest-all'); const blocked = await (await f.request('/simulate', 'POST', args)).json();
    assert.deepEqual(blocked.unavailable_installments, []);
    f.setMode('offline'); assert.equal((await f.request('/simulate', 'POST', args)).status, 503);
    assert.equal(f.charges, 0);
});
test('draft is audited, forged approval ignored, duplicate competing saves reject stale versions', async t => {
    const f = await fixture(t), args = await f.args();
    args.config = { ...args.config, commercial_message: 'Crédito em até 12x', approval: { homologated: true } };
    const responses = await Promise.all([f.request('', 'PATCH', args), f.request('', 'PATCH', args)]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    assert.equal(f.stored.enabled, false); assert.equal(f.stored.approval, null); assert.equal(f.audits.length, 1);
    const publicPolicy = await (await f.request('payments/installment-policy')).json(); assert.equal(publicPolicy.commercial_message, '');
    assert.equal(JSON.stringify(f.audits).includes('54808328'), false);
});
test('activation needs independent approval, fresh account plans and saved proposal', async t => {
    const f = await fixture(t); let args = await f.args();
    assert.equal((await f.request('', 'PATCH', { ...args, config: { ...args.config, enabled: true } })).status, 409);
    assert.equal((await f.request('/approve', 'POST', { ...args, commercial_approved: true, financial_homologated: true })).status, 409);
    assert.equal((await f.request('', 'PATCH', args)).status, 200);
    args = await f.args(); assert.equal((await f.request('/approve', 'POST', args)).status, 409);
    f.setMode('missing12'); assert.equal((await f.request('/approve', 'POST', { ...args, commercial_approved: true, financial_homologated: true })).status, 409);
    f.setMode('supported'); assert.equal((await f.request('/approve', 'POST', { ...args, commercial_approved: true, financial_homologated: true })).status, 200);
    assert.equal(f.stored.enabled, false);
    args = await f.args(); assert.equal((await f.request('', 'PATCH', { ...args, config: { ...args.config, enabled: true } })).status, 200);
    const pub = await (await f.request('payments/installment-policy')).json(); assert.equal(pub.max_installments, 12); assert.ok(pub.commercial_message.includes('Condições e juros sujeitos'));
    args = await f.args(); assert.equal((await f.request('', 'PATCH', { ...args, config: { ...args.config, interest_payer: 'seller' } })).status, 409);
    assert.equal(f.charges, 0);
});
