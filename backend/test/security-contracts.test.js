import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { normalizeBirthDate } from '../src/lib/validation.js';
import {
    createCardPayment,
    createPixPayment,
    mapPaymentStatus,
    validateWebhookSignature,
} from '../src/services/mercadoPago.js';
import {
    calculateShipping,
    getTracking,
    validateWebhook as validateMelhorEnvioWebhook,
} from '../src/services/melhorEnvio.js';
import { buildShippingPackages, getCheckoutShippingInput, getPersistedShippingService, selectShippingQuote } from '../src/lib/shipping.js';
import { ALLOWED_SETTING_KEYS, buildFilter, buildSort, CATALOG_FILTER_FIELDS, CATALOG_SORT_FIELDS, PUBLIC_SETTING_KEYS } from '../src/routes/catalog.js';
import { isVerifiedPaymentForOrder } from '../src/routes/webhooks.js';
import { getMaintenanceRedirect } from '../../src/lib/maintenance.js';

test('birth date accepts only real dates with a four-digit, non-future year', () => {
    assert.equal(normalizeBirthDate('12/03/1990'), '1990-03-12');
    assert.equal(normalizeBirthDate('29/02/2024'), '2024-02-29');
    assert.throws(() => normalizeBirthDate('29/02/2023'));
    assert.throws(() => normalizeBirthDate('12/03/275760'));
    assert.throws(() => normalizeBirthDate('12/03/19900'));
    assert.throws(() => normalizeBirthDate('31/04/1990'));
    assert.throws(() => normalizeBirthDate('12/03/990'));
    assert.throws(() => normalizeBirthDate('1990-02-29'));
});

test('Mercado Pago service mock preserves amount, external reference and idempotency contracts', async () => {
    const originalFetch = global.fetch;
    const originalToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    process.env.MERCADO_PAGO_ACCESS_TOKEN = 'TEST-safe-local-only';
    const calls = [];
    const payloads = [
        { id: 'mp-approved', external_reference: 'DH-1', transactions: { payments: [{ id: 'p-approved', status: 'approved', installments: 3 }] } },
        { id: 'mp-rejected', external_reference: 'DH-2', transactions: { payments: [{ id: 'p-rejected', status: 'rejected', installments: 1 }] } },
        { id: 'mp-pending', external_reference: 'DH-3', transactions: { payments: [{ id: 'p-pending', status: 'pending', point_of_interaction: { transaction_data: { qr_code: 'mock-qr' } } }] } },
    ];
    global.fetch = async (url, options) => {
        calls.push({ url, options, body: JSON.parse(options.body) });
        return { ok: true, json: async () => payloads.shift() };
    };
    try {
        const payer = { email: 'customer@example.invalid', first_name: 'Test', last_name: 'User', identification: { type: 'CPF', number: '00000000000' } };
        const approved = await createCardPayment({ orderNumber: 'DH-1', total: 120.5, payer, cardToken: 'mock-card-token', installments: 3, paymentMethodId: 'visa', idempotencyKey: 'card-DH-1' });
        const rejected = await createCardPayment({ orderNumber: 'DH-2', total: 80, payer, cardToken: 'mock-card-token', installments: 1, paymentMethodId: 'visa', idempotencyKey: 'card-DH-2' });
        const pending = await createPixPayment({ orderNumber: 'DH-3', total: 40, payer, idempotencyKey: 'pix-DH-3' });
        assert.equal(approved.mp_status, 'approved');
        assert.equal(rejected.mp_status, 'rejected');
        assert.equal(pending.mp_status, 'pending');
        assert.equal(pending.pix_qr_code, 'mock-qr');
        assert.deepEqual(calls.map(c => c.options.headers['X-Idempotency-Key']), ['card-DH-1', 'card-DH-2', 'pix-DH-3']);
        assert.deepEqual(calls.map(c => c.body.external_reference), ['DH-1', 'DH-2', 'DH-3']);
        assert.deepEqual(calls.map(c => c.body.total_amount), ['120.50', '80.00', '40.00']);
        assert.equal(mapPaymentStatus('approved'), 'approved');
        assert.equal(mapPaymentStatus('rejected'), 'rejected');
        assert.equal(mapPaymentStatus('pending'), 'pending');
    } finally {
        global.fetch = originalFetch;
        if (originalToken === undefined) delete process.env.MERCADO_PAGO_ACCESS_TOKEN;
        else process.env.MERCADO_PAGO_ACCESS_TOKEN = originalToken;
    }
});

test('Mercado Pago webhook payment verification mock rejects unknown order, amount and currency mismatches', () => {
    const order = { order_number: 'DH-100', total: 99.9 };
    assert.equal(isVerifiedPaymentForOrder(order, { external_reference: 'DH-100', total_amount: '99.90', currency_id: 'BRL' }), true);
    assert.equal(isVerifiedPaymentForOrder(order, { external_reference: 'OTHER-ORDER', total_amount: '99.90', currency_id: 'BRL' }), false);
    assert.equal(isVerifiedPaymentForOrder(order, { external_reference: 'DH-100', total_amount: '0.01', currency_id: 'BRL' }), false);
    assert.equal(isVerifiedPaymentForOrder(order, { external_reference: 'DH-100', total_amount: '99.90', currency_id: 'USD' }), false);
});

test('Melhor Envio sandbox mock returns provider services and tracking without real freight', async () => {
    const originalFetch = global.fetch;
    const originalToken = process.env.MELHOR_ENVIO_TOKEN;
    const originalMode = process.env.MELHOR_ENVIO_MODE;
    process.env.MELHOR_ENVIO_TOKEN = 'sandbox-local-fixture';
    process.env.MELHOR_ENVIO_MODE = 'sandbox';
    const calls = [];
    global.fetch = async (url, options = {}) => {
        calls.push({ url, options });
        const data = url.includes('/calculate')
            ? { correios: [{ id: 17, name: 'PAC', price: '24.50', delivery_time: 5, company: { id: 1, name: 'Correios' } }, { id: 99, error: 'unavailable' }] }
            : { tracking: 'MOCK123', status: 'in_transit', history: [{ status: 'posted' }] };
        return { ok: true, json: async () => data };
    };
    try {
        const options = await calculateShipping({ fromPostalCode: '01001000', toPostalCode: '20040020', products: [{ weight: 300, height: 10, width: 15, length: 20, qty: 1 }], totalValue: 99.9 });
        const tracking = await getTracking('fixture-shipment');
        assert.deepEqual(options, [{ id: 17, name: 'PAC', company: 'Correios', company_id: 1, service: 'PAC', price: 24.5, delivery_time: 5, delivery_time_min: null, delivery_time_max: null, carrier: 'correios' }]);
        assert.equal(tracking.tracking_code, 'MOCK123');
        assert.equal(calls.every(call => call.url.startsWith('https://sandbox.melhorenvio.com.br/')), true);
        assert.throws(() => selectShippingQuote(options, 'service-inventado'));
    } finally {
        global.fetch = originalFetch;
        if (originalToken === undefined) delete process.env.MELHOR_ENVIO_TOKEN;
        else process.env.MELHOR_ENVIO_TOKEN = originalToken;
        if (originalMode === undefined) delete process.env.MELHOR_ENVIO_MODE;
        else process.env.MELHOR_ENVIO_MODE = originalMode;
    }
});

test('catalog query fields are allowlisted before SQL construction', () => {
    const result = buildFilter({ query: { category: 'vestidos', 'status); DROP TABLE orders; --': 'x' } }, CATALOG_FILTER_FIELDS.products);
    assert.deepEqual(result, { conditions: ['category = $1'], params: ['vestidos'] });
    assert.equal(buildSort({ query: { sort: '-price' } }, CATALOG_SORT_FIELDS.products, 'created_date', 'DESC'), 'ORDER BY price DESC');
    assert.equal(buildSort({ query: { sort: 'price;DROP' } }, CATALOG_SORT_FIELDS.products, 'created_date', 'DESC'), 'ORDER BY created_date DESC');
});

test('Mercado Pago webhook signature uses the signed data.id and rejects tampering', () => {
    const previousSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    process.env.MERCADO_PAGO_WEBHOOK_SECRET = 'mp-test-secret';
    const dataId = '12345';
    const requestId = 'request-1';
    const timestamp = String(Date.now());
    const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`;
    const signature = crypto.createHmac('sha256', process.env.MERCADO_PAGO_WEBHOOK_SECRET).update(manifest).digest('hex');
    const req = { query: { 'data.id': dataId }, headers: { 'x-signature': `ts=${timestamp},v1=${signature}`, 'x-request-id': requestId } };
    assert.equal(validateWebhookSignature(req), true);
    req.query['data.id'] = 'tampered';
    assert.equal(validateWebhookSignature(req), false);
    assert.equal(validateWebhookSignature({ query: {}, headers: {} }), false);
    if (previousSecret === undefined) delete process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    else process.env.MERCADO_PAGO_WEBHOOK_SECRET = previousSecret;
});

test('Melhor Envio webhook requires an HMAC over the unmodified raw body', () => {
    const previousSecret = process.env.MELHOR_ENVIO_WEBHOOK_SECRET;
    process.env.MELHOR_ENVIO_WEBHOOK_SECRET = 'me-test-secret';
    const rawBody = Buffer.from('{"shipment_id":"abc"}');
    const signature = crypto.createHmac('sha256', process.env.MELHOR_ENVIO_WEBHOOK_SECRET).update(rawBody).digest('base64');
    assert.equal(validateMelhorEnvioWebhook({ rawBody, headers: { 'x-me-signature': signature } }), true);
    assert.equal(validateMelhorEnvioWebhook({ rawBody: Buffer.from('{"shipment_id":"def"}'), headers: { 'x-me-signature': signature } }), false);
    assert.equal(validateMelhorEnvioWebhook({ rawBody, headers: {} }), false);
    if (previousSecret === undefined) delete process.env.MELHOR_ENVIO_WEBHOOK_SECRET;
    else process.env.MELHOR_ENVIO_WEBHOOK_SECRET = previousSecret;
});

test('shipping accepts only catalog dimensions and a provider-returned service', () => {
    const packages = buildShippingPackages([{ id: 'catalog-product', quantity: 2, weight: 300, height: 10, width: 15, length: 20 }]);
    assert.deepEqual(packages, [{ weight: 300, height: 10, width: 15, length: 20, qty: 2 }]);
    assert.throws(() => buildShippingPackages([{ id: 'catalog-product', quantity: 1, weight: 0, height: 10, width: 15, length: 20 }]));
    assert.equal(selectShippingQuote([{ id: 1, price: 22.5 }], '1').price, 22.5);
    assert.throws(() => selectShippingQuote([{ id: 1, price: 22.5 }], 'tampered'));
});

test('checkout discards browser-supplied shipping cost, dimensions and service metadata', () => {
    const trusted = getCheckoutShippingInput({
        shipping_method: 'melhor_envio',
        shipping_quote_id: 'provider-service-42',
        shipping_address: { cep: '01001-000' },
        shipping_cost: 0.01,
        shipping_deadline: 0,
        weight: 1,
        height: 1,
        width: 1,
        length: 1,
        shipping_service: 'invented-service',
    });
    assert.deepEqual(trusted, {
        shipping_method: 'melhor_envio',
        shipping_quote_id: 'provider-service-42',
        shipping_address: { cep: '01001-000' },
    });
    assert.equal(selectShippingQuote([{ id: 'provider-service-42', price: 31.4 }], trusted.shipping_quote_id).price, 31.4);
    assert.throws(() => selectShippingQuote([{ id: 'provider-service-42', price: 31.4 }], 'invented-service'));
    assert.equal(getPersistedShippingService({ shipping_quote_id: 'provider-service-42' }), 'provider-service-42');
    assert.throws(() => getPersistedShippingService({}));
});

test('settings allowlist does not expose internal settings or client-controlled visibility', () => {
    assert.equal(ALLOWED_SETTING_KEYS.has('shipping'), true);
    assert.equal(ALLOWED_SETTING_KEYS.has('maintenance'), true);
    assert.equal(ALLOWED_SETTING_KEYS.has('notifications'), false);
    assert.equal(PUBLIC_SETTING_KEYS.has('shipping'), true);
    assert.equal(PUBLIC_SETTING_KEYS.has('payments'), false);
});

test('maintenance preserves login, admin, API and webhook routes while redirecting visitors', () => {
    assert.equal(getMaintenanceRedirect({ maintenanceEnabled: true, isAdmin: false, pathname: '/colecao' }), '/em-breve');
    assert.equal(getMaintenanceRedirect({ maintenanceEnabled: true, isAdmin: true, pathname: '/colecao' }), null);
    for (const pathname of ['/login', '/admin', '/api/orders', '/webhooks/melhor-envio', '/em-breve']) {
        assert.equal(getMaintenanceRedirect({ maintenanceEnabled: true, isAdmin: false, pathname }), null);
    }
});
