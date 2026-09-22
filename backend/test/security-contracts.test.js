import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { normalizeBirthDate } from '../src/lib/validation.js';
import {
    createCardPayment,
    createPixPayment,
    findTestOrdersByReference,
    mapPaymentStatus,
    validateWebhookSignature,
} from '../src/services/mercadoPago.js';
import {
    calculateShipping,
    generateLabel,
    getTracking,
    validateWebhook as validateMelhorEnvioWebhook,
} from '../src/services/melhorEnvio.js';
import { buildShippingPackages, getCheckoutShippingInput, getPersistedShippingService, selectShippingQuote } from '../src/lib/shipping.js';
import { assertLabelEligible } from '../src/lib/shipping.js';
import { ALLOWED_SETTING_KEYS, buildFilter, buildSort, CATALOG_FILTER_FIELDS, CATALOG_SORT_FIELDS, PUBLIC_SETTING_KEYS } from '../src/routes/catalog.js';
import { createWebhookEventId, isVerifiedPaymentForOrder } from '../src/routes/webhooks.js';
import { getVerifiedPaymentForOrder, hasPaymentStateChanged } from '../src/lib/paymentVerification.js';
import { assertMatchingIdempotencyRequest, createOrderRequestFingerprint, normalizeIdempotencyKey } from '../src/lib/idempotency.js';
import { getMaintenanceRedirect } from '../../src/lib/maintenance.js';
import { buildPlaceOrderRequest } from '../../src/api/orderRequest.js';
import { calculateServerOrderTotal, resolveCatalogLine } from '../src/lib/orderPricing.js';
import { validateCoupon } from '../src/services.js';
import { pool } from '../src/config/db.js';

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
        { id: 'mp-pending', external_reference: 'DH-3', transactions: { payments: [{ id: 'p-pending', status: 'pending', payment_method: { qr_code: 'mock-qr' } }] } },
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
        assert.equal(calls[2].body.processing_mode, 'automatic');
        assert.equal(mapPaymentStatus('approved'), 'approved');
        assert.equal(mapPaymentStatus('rejected'), 'rejected');
        assert.equal(mapPaymentStatus('pending'), 'pending');
    } finally {
        global.fetch = originalFetch;
        if (originalToken === undefined) delete process.env.MERCADO_PAGO_ACCESS_TOKEN;
        else process.env.MERCADO_PAGO_ACCESS_TOKEN = originalToken;
    }
});

test('Mercado Pago TEST order search returns diagnostic codes without payer data', async () => {
    const originalFetch = global.fetch;
    const originalToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    const originalMode = process.env.MERCADO_PAGO_MODE;
    process.env.MERCADO_PAGO_ACCESS_TOKEN = 'TEST-safe-local-only';
    process.env.MERCADO_PAGO_MODE = 'test';
    global.fetch = async (url) => {
        assert.equal(new URL(url).searchParams.get('external_reference'), 'DH-TEST');
        return { ok: true, json: async () => ({ data: [
            { id: 'ORD-TEST', external_reference: 'DH-TEST', status: 'failed', status_detail: 'processing_error', payer: { email: 'private@example.com' }, errors: [{ code: 'failed', cause: 'rejected_by_bank' }] },
            { id: 'ORD-OTHER', external_reference: 'DH-OTHER', status: 'processed' },
        ] }) };
    };
    try {
        const results = await findTestOrdersByReference('DH-TEST', new Date().toISOString());
        assert.equal(results.length, 1);
        assert.deepEqual(results[0].errors, [{ code: 'failed', cause: 'rejected_by_bank' }]);
        assert.equal(JSON.stringify(results).includes('private@example.com'), false);
        process.env.MERCADO_PAGO_MODE = 'production';
        await assert.rejects(findTestOrdersByReference('DH-TEST', new Date().toISOString()), { status: 409 });
    } finally {
        global.fetch = originalFetch;
        if (originalToken === undefined) delete process.env.MERCADO_PAGO_ACCESS_TOKEN;
        else process.env.MERCADO_PAGO_ACCESS_TOKEN = originalToken;
        if (originalMode === undefined) delete process.env.MERCADO_PAGO_MODE;
        else process.env.MERCADO_PAGO_MODE = originalMode;
    }
});

test('repeated payment creation reuses the same provider idempotency key', async () => {
    const originalFetch = global.fetch;
    const originalToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    process.env.MERCADO_PAGO_ACCESS_TOKEN = 'TEST-safe-local-only';
    const keys = [];
    global.fetch = async (url, options) => {
        keys.push(options.headers['X-Idempotency-Key']);
        return { ok: true, json: async () => ({ id: 'mp-order-1', external_reference: 'DH-RETRY', transactions: { payments: [{ id: 'payment-1', status: 'pending' }] } }) };
    };
    try {
        const input = {
            orderNumber: 'DH-RETRY', total: 75,
            payer: { email: 'buyer@example.invalid', first_name: 'Test', last_name: 'User', identification: { type: 'CPF', number: '00000000000' } },
            idempotencyKey: 'pix-order-stable-key',
        };
        await createPixPayment(input);
        await createPixPayment(input);
        assert.deepEqual(keys, ['pix-order-stable-key', 'pix-order-stable-key']);
    } finally {
        global.fetch = originalFetch;
        if (originalToken === undefined) delete process.env.MERCADO_PAGO_ACCESS_TOKEN;
        else process.env.MERCADO_PAGO_ACCESS_TOKEN = originalToken;
    }
});

test('Mercado Pago webhook payment verification mock rejects unknown order, amount and currency mismatches', () => {
    const order = { order_number: 'DH-100', total: 99.9 };
    const valid = { external_reference: 'DH-100', total_amount: '99.90', currency_id: 'BRL', mp_status: 'approved' };
    assert.equal(isVerifiedPaymentForOrder(order, valid), true);
    assert.equal(isVerifiedPaymentForOrder(order, { ...valid, external_reference: 'OTHER-ORDER' }), false);
    assert.equal(isVerifiedPaymentForOrder(order, { ...valid, total_amount: '0.01' }), false);
    assert.equal(isVerifiedPaymentForOrder(order, { ...valid, currency_id: 'USD' }), false);
    assert.equal(isVerifiedPaymentForOrder(order, { ...valid, currency_id: undefined }), false);
    assert.equal(isVerifiedPaymentForOrder(order, { ...valid, mp_status: undefined }), false);
});

test('manual payment sync reads official resources and rejects every mismatch or missing payment', async () => {
    const order = {
        order_number: 'DH-200', total: 149.9, mercado_pago_order_id: 'ord-200',
        mercado_pago_status: 'pending', mercado_pago_status_detail: null, payment_status: 'pending',
    };
    const officialOrder = { mp_status: 'approved', mp_status_detail: 'accredited', mp_payment_id: 'pay-200', external_reference: 'DH-200', total_amount: '149.90' };
    const officialPayment = { mp_status: 'approved', mp_status_detail: 'accredited', mp_payment_id: 'pay-200', external_reference: 'DH-200', transaction_amount: 149.9, currency_id: 'BRL' };
    const provider = {
        getOrderStatus: async () => officialOrder,
        getPaymentStatus: async () => officialPayment,
    };

    const verified = await getVerifiedPaymentForOrder(order, provider);
    assert.equal(verified.mp_status, 'approved');
    assert.equal(verified.currency_id, 'BRL');
    assert.equal(hasPaymentStateChanged(order, verified, 'approved'), true);
    assert.equal(hasPaymentStateChanged({ ...order, mercado_pago_status: 'approved', mercado_pago_status_detail: 'accredited', mercado_pago_payment_id: 'pay-200', payment_status: 'approved' }, verified, 'approved'), false);

    for (const changed of [
        { external_reference: 'DH-OTHER' },
        { transaction_amount: 0.01 },
        { currency_id: 'USD' },
    ]) {
        await assert.rejects(
            () => getVerifiedPaymentForOrder(order, { ...provider, getPaymentStatus: async () => ({ ...officialPayment, ...changed }) }),
            error => error.code === 'PAYMENT_MISMATCH'
        );
    }
    await assert.rejects(
        () => getVerifiedPaymentForOrder({ ...order, mercado_pago_order_id: null }, { getOrderStatus: async () => null, getPaymentStatus: async () => null }),
        error => error.code === 'PAYMENT_NOT_CREATED'
    );
    await assert.rejects(
        () => getVerifiedPaymentForOrder(order, { getOrderStatus: async () => { throw Object.assign(new Error('not found'), { status: 404 }); }, getPaymentStatus: async () => null }),
        error => error.status === 404
    );
});

test('Melhor Envio sandbox mock returns provider services and tracking without real freight', async () => {
    const originalFetch = global.fetch;
    const originalToken = process.env.MELHOR_ENVIO_TOKEN;
    const originalMode = process.env.MELHOR_ENVIO_MODE;
    const originalTokenMode = process.env.MELHOR_ENVIO_TOKEN_MODE;
    const originalQuery = pool.query;
    process.env.MELHOR_ENVIO_TOKEN = 'sandbox-local-fixture';
    process.env.MELHOR_ENVIO_MODE = 'sandbox';
    process.env.MELHOR_ENVIO_TOKEN_MODE = 'sandbox';
    pool.query = async () => ({ rows: [] });
    const calls = [];
    global.fetch = async (url, options = {}) => {
        calls.push({ url, options });
        const data = url.includes('/calculate')
            ? { correios: [{ id: 17, name: 'PAC', price: '25.50', custom_price: '24.50', delivery_time: 6, custom_delivery_time: 5, company: { id: 1, name: 'Correios' }, packages: [{ weight: '0.30', insurance_value: '99.90', dimensions: { height: 10, width: 15, length: 20 } }] }, { id: 99, error: 'unavailable' }] }
            : { 'fixture-shipment': { tracking: 'MOCK123', status: 'in_transit', history: [{ status: 'posted' }] } };
        return { ok: true, json: async () => data };
    };
    try {
        const options = await calculateShipping({ fromPostalCode: '01001000', toPostalCode: '20040020', products: [{ id: 'catalog-product', weight: 0.3, height: 10, width: 15, length: 20, insurance_value: 99.9, qty: 1 }], totalValue: 99.9 });
        const tracking = await getTracking('fixture-shipment');
        assert.deepEqual(options, [{ id: 17, name: 'PAC', company: 'Correios', company_id: 1, service: 'PAC', price: 24.5, delivery_time: 5, delivery_time_min: null, delivery_time_max: null, carrier: 'correios', packages: [{ height: 10, width: 15, length: 20, weight: 0.3, insurance_value: 99.9 }] }]);
        assert.equal(tracking.tracking_code, 'MOCK123');
        assert.equal(calls.every(call => call.url.startsWith('https://sandbox.melhorenvio.com.br/')), true);
        assert.equal(calls.every(call => call.options.headers['User-Agent'].includes('@')), true);
        assert.deepEqual(JSON.parse(calls[1].options.body), { orders: ['fixture-shipment'] });
        assert.throws(() => selectShippingQuote(options, 'service-inventado'));
    } finally {
        global.fetch = originalFetch;
        pool.query = originalQuery;
        if (originalTokenMode === undefined) delete process.env.MELHOR_ENVIO_TOKEN_MODE;
        else process.env.MELHOR_ENVIO_TOKEN_MODE = originalTokenMode;
        if (originalToken === undefined) delete process.env.MELHOR_ENVIO_TOKEN;
        else process.env.MELHOR_ENVIO_TOKEN = originalToken;
        if (originalMode === undefined) delete process.env.MELHOR_ENVIO_MODE;
        else process.env.MELHOR_ENVIO_MODE = originalMode;
    }
});

test('Melhor Envio label mock follows cart, checkout, generate, print and tracking', async () => {
    const originalFetch = global.fetch;
    const originalToken = process.env.MELHOR_ENVIO_TOKEN;
    const originalMode = process.env.MELHOR_ENVIO_MODE;
    const originalTokenMode = process.env.MELHOR_ENVIO_TOKEN_MODE;
    const originalQuery = pool.query;
    process.env.MELHOR_ENVIO_TOKEN = 'sandbox-label-fixture';
    process.env.MELHOR_ENVIO_MODE = 'sandbox';
    process.env.MELHOR_ENVIO_TOKEN_MODE = 'sandbox';
    pool.query = async () => ({ rows: [] });
    const calls = [];
    global.fetch = async (url, options = {}) => {
        calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
        let data = {};
        if (url.endsWith('/me/cart')) data = { id: 'shipment-1', status: 'pending' };
        else if (url.endsWith('/me/shipment/print')) data = { url: 'https://sandbox.invalid/label' };
        else if (url.endsWith('/me/shipment/tracking')) data = { 'shipment-1': { tracking: 'TRACK123', status: 'released' } };
        return { ok: true, json: async () => data };
    };
    try {
        const [label] = await generateLabel({
            from: { name: 'Loja', phone: '1100000000', email: 'shop@example.invalid', document: '12345678000199', address: 'Rua A', number: '1', district: 'Centro', city: 'São Paulo', state: 'SP', postal_code: '01001000' },
            to: { name: 'Cliente', phone: '1100000000', email: 'buyer@example.invalid', document: '00000000000', address: 'Rua B', number: '2', district: 'Centro', city: 'Rio de Janeiro', state: 'RJ', postal_code: '20040020' },
            serviceId: 17,
            products: [{ name: 'Vestido', qty: 1, price: 199.9 }],
            volumes: [{ height: 10, width: 20, length: 30, weight: 0.4 }],
            orderNumber: 'DH-TEST-1',
            totalValue: 199.9,
        });
        assert.deepEqual(calls.map(call => new URL(call.url).pathname), [
            '/api/v2/me/cart',
            '/api/v2/me/shipment/checkout',
            '/api/v2/me/shipment/generate',
            '/api/v2/me/shipment/print',
            '/api/v2/me/shipment/tracking',
        ]);
        assert.deepEqual(calls[1].body, { orders: ['shipment-1'] });
        assert.deepEqual(calls[2].body, { orders: ['shipment-1'] });
        assert.deepEqual(calls[3].body, { mode: 'public', orders: ['shipment-1'] });
        assert.equal(calls[0].body.service, 17);
        assert.deepEqual(calls[0].body.volumes, [{ height: 10, width: 20, length: 30, weight: 0.4 }]);
        assert.equal(label.tracking_code, 'TRACK123');
        assert.equal(label.print_url, 'https://sandbox.invalid/label');
    } finally {
        global.fetch = originalFetch;
        pool.query = originalQuery;
        if (originalTokenMode === undefined) delete process.env.MELHOR_ENVIO_TOKEN_MODE;
        else process.env.MELHOR_ENVIO_TOKEN_MODE = originalTokenMode;
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
    const packages = buildShippingPackages([{ id: 'catalog-product', quantity: 2, weight: 0.3, height: 10, width: 15, length: 20, unit_price: 49.95 }]);
    assert.deepEqual(packages, [{ id: 'catalog-product', weight: 0.3, height: 10, width: 15, length: 20, insurance_value: 49.95, qty: 2 }]);
    assert.throws(() => buildShippingPackages([{ id: 'catalog-product', quantity: 1, weight: 0, height: 10, width: 15, length: 20, unit_price: 49.95 }]));
    assert.equal(selectShippingQuote([{ id: 1, price: 22.5 }], '1').price, 22.5);
    assert.throws(() => selectShippingQuote([{ id: 1, price: 22.5 }], 'tampered'));
});

test('checkout idempotency ignores browser totals but rejects key reuse for another trusted request', () => {
    const request = {
        items: [{ productId: 'product-1', colorId: 'black', size: 'M', qty: 2, price: 0.01, weight: 999 }],
        coupon_code: ' SAVE10 ', payment_method: 'pix', shipping_method: 'melhor_envio', shipping_quote_id: 17,
        shipping_address: { cep: '01001-000', city: 'São Paulo' }, customer: { email: 'buyer@example.invalid' },
        subtotal: 0.01, total: 0.01, shipping_cost: 0.01, currency: 'USD',
    };
    const fingerprint = createOrderRequestFingerprint(request);
    const tamperedBrowserAmounts = createOrderRequestFingerprint({
        ...request,
        items: [{ ...request.items[0], price: 999999, weight: 0.001, height: 1, width: 1, length: 1 }],
        subtotal: 999999, total: 999999, shipping_cost: 999999, currency: 'BRL',
    });
    assert.equal(fingerprint, tamperedBrowserAmounts);
    assert.equal(normalizeIdempotencyKey('checkout_retry_123456'), 'checkout_retry_123456');
    assert.equal(assertMatchingIdempotencyRequest({ id: 'order-1', idempotency_fingerprint: fingerprint }, fingerprint).id, 'order-1');
    assert.throws(() => normalizeIdempotencyKey('short'));
    assert.throws(() => assertMatchingIdempotencyRequest(
        { idempotency_fingerprint: fingerprint },
        createOrderRequestFingerprint({ ...request, coupon_code: 'OTHER' })
    ), error => error.status === 409);
});

test('checkout propagates its idempotency key in the API header, not the JSON body', () => {
    const request = buildPlaceOrderRequest({ idempotencyKey: 'checkout_retry_123456', items: [{ productId: 'product-1', qty: 1 }] });
    assert.equal(request.headers['X-Idempotency-Key'], 'checkout_retry_123456');
    assert.deepEqual(JSON.parse(request.body), { items: [{ productId: 'product-1', qty: 1 }] });
});

test('catalog price, stock and server totals cannot be imposed by the browser', () => {
    const catalogProduct = {
        name: 'Vestido', price: '200.00', sale_price: '150.00',
        colors: [{ id: 'black', name: 'Preto', stock: { M: 2 } }],
    };
    const browserLine = { productId: 'product-1', colorId: 'black', size: 'M', qty: 2, price: 0.01, subtotal: 0.02 };
    const resolved = resolveCatalogLine(catalogProduct, browserLine);
    assert.equal(resolved.unitPrice, 150);
    assert.equal(resolved.itemSubtotal, 300);
    assert.equal(calculateServerOrderTotal(resolved.itemSubtotal, 30, 24.5), 294.5);
    assert.throws(() => resolveCatalogLine(catalogProduct, { ...browserLine, qty: 3 }), error => error.status === 409);
});

test('unknown coupon is rejected by the server lookup', async () => {
    const originalQuery = pool.query;
    pool.query = async () => ({ rows: [] });
    try {
        const result = await validateCoupon('MANIPULATED', 'user-1', 200, []);
        assert.deepEqual(result, { valid: false, error: 'Cupom não encontrado' });
    } finally {
        pool.query = originalQuery;
    }
});

test('shipping label requires approved payment and a persisted provider service', () => {
    assert.throws(() => assertLabelEligible({ payment_status: 'pending', shipping_method: 'melhor_envio' }));
    assert.throws(() => assertLabelEligible({ payment_status: 'approved', shipping_method: 'retirada' }));
    assert.equal(assertLabelEligible({ payment_status: 'approved', shipping_method: 'melhor_envio' }).payment_status, 'approved');
});

test('webhook replay keys are stable while distinct payloads remain distinct', () => {
    const first = { body: { event: 'order.posted', data: { id: 'ship-1' } }, rawBody: Buffer.from('{"event":"order.posted","data":{"id":"ship-1"}}') };
    const retry = { body: first.body, rawBody: Buffer.from(first.rawBody) };
    const changed = { body: { event: 'order.delivered', data: { id: 'ship-1' } }, rawBody: Buffer.from('{"event":"order.delivered","data":{"id":"ship-1"}}') };
    assert.equal(createWebhookEventId(first), createWebhookEventId(retry));
    assert.notEqual(createWebhookEventId(first), createWebhookEventId(changed));
    assert.equal(createWebhookEventId({ body: { id: 123 }, rawBody: Buffer.from('first') }, true), '123');
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
    assert.equal(ALLOWED_SETTING_KEYS.has('shipping_sender'), true);
    assert.equal(ALLOWED_SETTING_KEYS.has('notifications'), false);
    assert.equal(PUBLIC_SETTING_KEYS.has('shipping'), true);
    assert.equal(PUBLIC_SETTING_KEYS.has('payments'), false);
    assert.equal(PUBLIC_SETTING_KEYS.has('shipping_sender'), false);
});

test('sender phone normalizes optional Brazilian country code for shipping', async () => {
    const { normalizeBrazilianPhone } = await import('../src/lib/shipping.js');
    assert.equal(normalizeBrazilianPhone('5511927189069'), '11927189069');
    assert.equal(normalizeBrazilianPhone('(11) 92718-9069'), '11927189069');
});

test('maintenance redirects store routes before auth while preserving exempt routes', () => {
    for (const pathname of ['/', '/produtos', '/carrinho', '/checkout']) {
        assert.equal(getMaintenanceRedirect({ maintenanceEnabled: true, isAdmin: false, pathname }), '/em-breve');
    }
    assert.equal(getMaintenanceRedirect({ maintenanceEnabled: true, isAdmin: true, pathname: '/colecao' }), null);
    for (const pathname of ['/login', '/admin', '/api/orders', '/webhooks/melhor-envio', '/em-breve']) {
        assert.equal(getMaintenanceRedirect({ maintenanceEnabled: true, isAdmin: false, pathname }), null);
    }
    assert.equal(getMaintenanceRedirect({ maintenanceEnabled: false, isAdmin: false, pathname: '/checkout' }), null);
});
