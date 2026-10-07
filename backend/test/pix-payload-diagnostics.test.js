import assert from 'node:assert/strict';
import test from 'node:test';
import { createPixPayment, createCardPayment } from '../src/services/mercadoPago.js';
import { createPaymentDiagnostic, paymentFailurePolicy, safeProviderError } from '../src/lib/paymentDiagnostics.js';
import { normalizePayer, omitEmptyOptional, payerFromOrder } from '../src/lib/paymentPayer.js';

async function withMockProvider(run, response = { id: 'ORD-MOCK', external_reference: 'DH-MOCK', transactions: { payments: [{ id: 'PAY-MOCK', status: 'pending' }] } }) {
    const priorFetch = global.fetch;
    const priorToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    process.env.MERCADO_PAGO_ACCESS_TOKEN = 'TEST-mock-only';
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url, options, body: JSON.parse(options.body) });
        return { ok: true, json: async () => response };
    };
    try { await run(calls); } finally {
        global.fetch = priorFetch;
        if (priorToken === undefined) delete process.env.MERCADO_PAGO_ACCESS_TOKEN;
        else process.env.MERCADO_PAGO_ACCESS_TOKEN = priorToken;
    }
}

const base = { orderNumber: 'DH-MOCK', total: 50, idempotencyKey: 'pix-mock' };
const payer = { email: 'test_user_br@testuser.com', first_name: 'APRO' };

test('Pix omits absent, empty and invalid identification, preserving official R$50 TEST shape', async () => {
    await withMockProvider(async calls => {
        for (const identification of [undefined, { type: 'CPF', number: '' }, { type: 'CPF', number: '00000000000' }]) {
            await createPixPayment({ ...base, payer: { ...payer, identification } });
        }
        assert.equal(calls.length, 3);
        for (const { body, options } of calls) {
            assert.deepEqual(body.payer, payer);
            assert.equal(body.total_amount, '50.00');
            assert.equal(body.transactions.payments[0].amount, '50.00');
            assert.equal(body.external_reference, 'DH-MOCK');
            assert.equal(body.transactions.payments[0].payment_method.id, 'pix');
            assert.equal(body.transactions.payments[0].payment_method.type, 'bank_transfer');
            assert.equal(options.headers['X-Idempotency-Key'], 'pix-mock');
        }
    });
});

test('Pix retains valid CPF and omits optional blank surname', async () => {
    await withMockProvider(async calls => {
        await createPixPayment({ ...base, payer: { ...payer, last_name: '  ', identification: { type: 'CPF', number: '123.456.789-09' } } });
        assert.deepEqual(calls[0].body.payer, { ...payer, identification: { type: 'CPF', number: '12345678909' } });
    });
});

test('card retains required payment fields and valid CPF while omitting empty issuer and surname', async () => {
    await withMockProvider(async calls => {
        await createCardPayment({ ...base, payer: { ...payer, last_name: '', identification: { type: 'CPF', number: '12345678909' } },
            cardToken: 'mock-card-token', installments: 2, paymentMethodId: 'visa', paymentType: 'credit_card', issuerId: '' });
        const body = calls[0].body;
        assert.deepEqual(body.payer, { ...payer, identification: { type: 'CPF', number: '12345678909' } });
        assert.deepEqual(body.transactions.payments[0].payment_method,
            { id: 'visa', type: 'credit_card', token: 'mock-card-token', installments: 2 });
    });
});

test('payer validation happens before provider call and optional pruning handles nested blanks', async () => {
    await withMockProvider(async calls => {
        await assert.rejects(createPixPayment({ ...base, payer: { email: '', first_name: 'APRO' } }), { code: 'INVALID_PAYER' });
        assert.equal(calls.length, 0);
    });
    assert.deepEqual(payerFromOrder({ snapshot: { customer: { name: 'APRO', email: payer.email, cpf: '' } } }, {}), payer);
    assert.deepEqual(normalizePayer({ ...payer, identification: { type: 'CPF', number: null } }), payer);
    assert.deepEqual(omitEmptyOptional({ a: null, b: { c: '', d: ' ok ' }, e: {} }), { b: { d: 'ok' } });
});

test('mock HTTP 400 reports only allowlisted provider error fields and keeps retry blocked', async () => {
    const priorFetch = global.fetch;
    const priorToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    const priorError = console.error;
    const priorInfo = console.info;
    process.env.MERCADO_PAGO_ACCESS_TOKEN = 'TEST-private-token';
    const logs = [];
    console.error = line => logs.push(JSON.parse(line));
    console.info = () => {};
    global.fetch = async () => ({ ok: false, status: 400, json: async () => ({
        error: 'invalid_request', message: 'Invalid request',
        cause: [{ code: 'invalid_payer', description: 'Invalid identification' },
            { code: 'bad', description: 'private@example.test' }],
        payer: { email: 'private@example.test', identification: { number: '12345678909' } },
        access_token: 'TEST-private-token', headers: { Authorization: 'Bearer private' },
        request_body: { card_token: 'private-card-token' }, qr_code: 'private-qr',
    }) });
    try {
        let caught;
        try { await createPixPayment({ ...base, payer }); } catch (err) { caught = err; }
        assert.equal(caught.status, 400);
        const diagnostic = createPaymentDiagnostic({ headers: {}, params: { id: 'local-order' } });
        diagnostic.setStage('mp_request');
        diagnostic.logError(caught);
        assert.equal(logs.length, 1);
        assert.equal(logs[0].provider_http_status, 400);
        assert.equal(logs[0].provider_error, 'invalid_request');
        assert.equal(logs[0].provider_message, 'Invalid request');
        assert.deepEqual(logs[0].provider_cause_codes, ['invalid_payer', 'bad']);
        assert.deepEqual(logs[0].provider_cause_descriptions, ['Invalid identification']);
        assert.equal(logs[0].failure_policy, 'precreation_rejection_requires_reconciliation');
        const serialized = JSON.stringify(logs[0]);
        for (const sensitive of ['private@example.test', '12345678909', 'TEST-private-token',
            'Authorization', 'Bearer private', 'private-card-token', 'private-qr', 'request_body', '"payer"']) {
            assert.equal(serialized.includes(sensitive), false, sensitive);
        }
        assert.equal(paymentFailurePolicy(new Error('timeout')), 'ambiguous_requires_reconciliation');
        assert.equal(paymentFailurePolicy(caught, 'mp_order_readback'), 'ambiguous_requires_reconciliation');
        assert.deepEqual(safeProviderError(new Error('timeout')).provider_cause_codes, []);
        assert.deepEqual(safeProviderError({ status: 400, mpError: {
            error: 'invalid_12345678909', message: 'Maria Silva',
            cause: [{ code: 'invalid_12345678909', description: 'Maria Silva' }],
        } }), {
            provider_http_status: 400, provider_error: null, provider_message: null,
            provider_cause_codes: [], provider_cause_descriptions: [],
        });
    } finally {
        global.fetch = priorFetch;
        console.error = priorError;
        console.info = priorInfo;
        if (priorToken === undefined) delete process.env.MERCADO_PAGO_ACCESS_TOKEN;
        else process.env.MERCADO_PAGO_ACCESS_TOKEN = priorToken;
    }
});
