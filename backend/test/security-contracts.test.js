import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { normalizeBirthDate } from '../src/lib/validation.js';
import { validateWebhookSignature } from '../src/services/mercadoPago.js';
import { validateWebhook as validateMelhorEnvioWebhook } from '../src/services/melhorEnvio.js';
import { buildShippingPackages, getCheckoutShippingInput, getPersistedShippingService, selectShippingQuote } from '../src/lib/shipping.js';
import { ALLOWED_SETTING_KEYS, PUBLIC_SETTING_KEYS } from '../src/routes/catalog.js';
import { getMaintenanceRedirect } from '../../src/lib/maintenance.js';

test('birth date accepts only real dates with a four-digit, non-future year', () => {
    assert.equal(normalizeBirthDate('12/03/1990'), '1990-03-12');
    assert.equal(normalizeBirthDate('29/02/2024'), '2024-02-29');
    assert.throws(() => normalizeBirthDate('29/02/2023'));
    assert.throws(() => normalizeBirthDate('12/03/275760'));
    assert.throws(() => normalizeBirthDate('12/03/19900'));
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
