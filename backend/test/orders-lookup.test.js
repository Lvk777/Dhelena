import assert from 'node:assert/strict';
import test from 'node:test';
import { findTestOrdersByReference } from '../src/services/mercadoPago.js';

const reference = 'DH-TEST-LOOKUP';
const createdAt = '2026-10-01T00:00:00Z';
const order = id => ({ id: `ORD-${id}`, external_reference: reference, status: 'pending' });
const response = (data, paging) => ({ data, paging });

async function lookupWith(pages) {
    const original = {
        fetch: global.fetch,
        mode: process.env.MERCADO_PAGO_MODE,
        token: process.env.MERCADO_PAGO_ACCESS_TOKEN,
        info: console.info,
    };
    const requests = [];
    const logs = [];
    process.env.MERCADO_PAGO_MODE = 'test';
    process.env.MERCADO_PAGO_ACCESS_TOKEN = 'mock-token';
    console.info = message => logs.push(JSON.parse(message));
    global.fetch = async (url, options) => {
        const parsed = new URL(url);
        requests.push({ url: parsed, method: options.method || 'GET', signal: options.signal });
        const next = pages[requests.length - 1];
        if (next instanceof Error) throw next;
        if (!next) throw new Error('Unexpected extra page');
        return { status: next.status || 200, ok: !next.status || next.status < 400,
            json: async () => next.body || next };
    };
    try {
        return await findTestOrdersByReference(reference, createdAt).then(
            orders => ({ orders, requests, logs }),
            error => ({ error, requests, logs })
        );
    } finally {
        global.fetch = original.fetch;
        console.info = original.info;
        if (original.mode === undefined) delete process.env.MERCADO_PAGO_MODE;
        else process.env.MERCADO_PAGO_MODE = original.mode;
        if (original.token === undefined) delete process.env.MERCADO_PAGO_ACCESS_TOKEN;
        else process.env.MERCADO_PAGO_ACCESS_TOKEN = original.token;
    }
}

test('Orders lookup proves absence with string or numeric zero', async () => {
    for (const total of ['0', 0]) {
        const result = await lookupWith([response([], { total })]);
        assert.deepEqual(result.orders, []);
        assert.equal(result.requests.length, 1);
        assert.equal(result.logs[0].parsed_total, 0);
        assert.equal(result.logs[0].pagination_complete, true);
    }
    const withMetadata = await lookupWith([response([], {
        total: '0', total_pages: '0', offset: '0', limit: '10',
    })]);
    assert.deepEqual(withMetadata.orders, []);
});

test('Orders lookup accepts a matching order and numeric string pagination', async () => {
    const result = await lookupWith([response([order(1)],
        { total: '1', total_pages: '1', offset: '0', limit: '10' })]);
    assert.equal(result.orders.length, 1);
    assert.equal(result.orders[0].id, 'ORD-1');
    assert.deepEqual(Object.keys(result.logs[0]), [
        'http_status', 'page', 'page_size', 'parsed_total', 'parsed_total_pages',
        'returned_count', 'matching_reference_count', 'pagination_complete',
    ]);
});

test('Orders lookup reads every page using GET and advances offsets', async () => {
    const result = await lookupWith([
        response(Array.from({ length: 10 }, (_, i) => order(i + 1)),
            { total: '21', total_pages: '3', offset: '0', limit: '10' }),
        response(Array.from({ length: 10 }, (_, i) => order(i + 11)),
            { total: '21', total_pages: '3', offset: '10', limit: '10' }),
        response([order(21)], { total: '21', total_pages: '3', offset: '20', limit: '10' }),
    ]);
    assert.equal(result.orders.length, 21);
    assert.deepEqual(result.requests.map(item => item.url.searchParams.get('page')), ['1', '2', '3']);
    assert.ok(result.requests.every(item => item.url.pathname === '/v1/orders'
        && item.url.searchParams.get('page_size') === '10'
        && item.url.searchParams.get('external_reference') === reference
        && item.method === 'GET' && item.signal));
    assert.deepEqual(result.logs.map(item => item.pagination_complete), [false, false, true]);
});

test('Orders lookup rejects malformed totals and pagination metadata', async () => {
    for (const total of ['abc', '-1', '1.5', '', null, NaN, Infinity, {}, [], '9007199254740992']) {
        const result = await lookupWith([response([], { total })]);
        assert.equal(result.error?.status, 409);
    }
    for (const paging of [
        { total: '0', total_pages: 'abc' },
        { total: '0', offset: '-1' },
        { total: '0', limit: '1.5' },
        { total: '0', limit: null },
        { total: '0', total_pages: '2' },
        { total: '0', offset: '10' },
        { total: '0', limit: '20' },
        { total: '501' },
    ]) {
        const result = await lookupWith([response([], paging)]);
        assert.equal(result.error?.status, 409);
    }
});

test('Orders lookup rejects repeated pages, wrong references and missing data', async () => {
    const first = Array.from({ length: 10 }, (_, i) => order(i + 1));
    const repeated = await lookupWith([
        response(first, { total: '20', offset: '0', limit: '10' }),
        response(first, { total: '20', offset: '10', limit: '10' }),
    ]);
    assert.equal(repeated.error?.status, 409);
    const wrong = await lookupWith([response([{ ...order(1), external_reference: 'OTHER' }], { total: '1' })]);
    assert.equal(wrong.error?.code, 'provider_filter_inconclusive');
    const missing = await lookupWith([{ paging: { total: '0' } }]);
    assert.equal(missing.error?.status, 409);
});

test('Orders lookup treats timeout and provider 5xx as inconclusive', async () => {
    const timeout = await lookupWith([Object.assign(new Error('timeout'), { name: 'TimeoutError' })]);
    assert.equal(timeout.error?.code, 'provider_request_inconclusive');
    assert.equal(timeout.logs[0].http_status, null);
    const failure = await lookupWith([{ status: 503, body: {} }]);
    assert.equal(failure.error?.code, 'provider_request_inconclusive');
    assert.equal(failure.logs[0].http_status, 503);
    const unexpectedSuccess = await lookupWith([{ status: 201, body: response([], { total: '0' }) }]);
    assert.equal(unexpectedSuccess.error?.code, 'provider_request_inconclusive');
});
