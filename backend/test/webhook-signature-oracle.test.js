import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { WebhookSignatureValidator, InvalidWebhookSignatureError } from 'mercadopago';
import { inspectWebhookSignature } from '../src/services/mercadoPago.js';

const secret = 'fixture-only-webhook-secret';
const dataId = 'ORDTST01M4AC9JFK06GGAVFV3HDPVFDK';
const requestId = 'fixture-request-1';
const ts = '1791349810';

function signed({ id = dataId, request = requestId, timestamp = ts, signingSecret = secret } = {}) {
    const manifest = [id && `id:${id};`, request && `request-id:${request};`, `ts:${timestamp};`].filter(Boolean).join('');
    const hash = crypto.createHmac('sha256', signingSecret).update(manifest).digest('hex');
    return `ts=${timestamp},v1=${hash}`;
}

function request({ signature = signed(), id = dataId, request = requestId } = {}) {
    return { headers: { 'x-signature': signature, 'x-request-id': request }, query: { 'data.id': id } };
}

function officialValid(req, configuredSecret = secret) {
    try {
        WebhookSignatureValidator.validate({
            xSignature: req.headers['x-signature'], xRequestId: req.headers['x-request-id'],
            dataId: req.query['data.id'], secret: configuredSecret,
        });
        return true;
    } catch (error) {
        assert.ok(error instanceof InvalidWebhookSignatureError);
        return false;
    }
}

const cases = [
    ['original alphanumeric ORD case and valid signature', request(), true],
    ['present request ID is part of the manifest', request({ request: 'altered-request' }), false],
    ['absent request ID omits only its pair', request({ request: null, signature: signed({ request: null }) }), true],
    ['absent data ID omits only its pair', request({ id: null, signature: signed({ id: null }) }), true],
    ['absent optional pairs leave the timestamp pair intact', request({ id: null, request: null, signature: signed({ id: null, request: null }) }), true],
    ['changed data ID rejects the signature', request({ id: `${dataId}X` }), false],
    ['changed case rejects an unchanged signature', request({ id: dataId.toLowerCase() }), false],
    ['lowercase ID is accepted only when signed in that case', request({ id: dataId.toLowerCase(), signature: signed({ id: dataId.toLowerCase() }) }), true],
    ['invalid timestamp is rejected', request({ signature: signed({ timestamp: 'invalid' }) }), false],
    ['missing timestamp is rejected', request({ signature: signed().split(',')[1] }), false],
    ['zero timestamp is a valid timestamp string without a tolerance policy', request({ signature: signed({ timestamp: '0' }) }), true],
    ['timestamp in milliseconds remains supported without a tolerance policy', request({ signature: signed({ timestamp: `${ts}000` }) }), true],
    ['unknown and incomplete header parts are ignored like the SDK', request({ signature: `unknown,junk=ignored,${signed()}` }), true],
    ['signature keys are case insensitive', request({ signature: signed().replace('ts=', 'TS=').replace('v1=', 'V1=') }), true],
    ['trimmed inputs and first array elements match the SDK', request({ id: [` ${dataId} `, 'ignored'], request: [` ${requestId} `], signature: [` ${signed()} `] }), true],
    ['last nonempty duplicate component matches the SDK', request({ signature: `ts=wrong,v1=wrong,${signed()}` }), true],
    ['empty duplicate components do not overwrite valid values', request({ signature: `${signed()},ts=,v1=` }), true],
    ['uppercase hash is not a lowercase hex-string signature', request({ signature: signed().replace(/v1=(.*)/, (_, hash) => `v1=${hash.toUpperCase()}`) }), false],
    ['malformed short v1 is rejected', request({ signature: `ts=${ts},v1=bad` }), false],
    ['malformed multibyte v1 fails without an unexpected exception', request({ signature: `ts=${ts},v1=${String.fromCharCode(233)}${'a'.repeat(63)}` }), false],
    ['missing signature fails closed', request({ signature: null }), false],
];

for (const [name, req, valid] of cases) {
    test(`HMAC SDK 3.6.1 oracle: ${name}`, () => {
        assert.equal(officialValid(req), valid);
        assert.equal(inspectWebhookSignature(req, secret).valid, valid);
    });
}

test('wrong secret is a mismatch for both validators', () => {
    const req = request();
    assert.equal(officialValid(req, 'incorrect-fixture-secret'), false);
    const inspected = inspectWebhookSignature(req, 'incorrect-fixture-secret');
    assert.equal(inspected.valid, false);
    assert.equal(inspected.reason, 'signature_mismatch');
    assert.equal(inspected.has_timestamp, true);
});

test('UTF-8 secret and manifest encoding match the official SDK', () => {
    const configuredSecret = `fixture-${String.fromCharCode(233)}`;
    const id = `ORDMiXeD${String.fromCharCode(233)}1234567890`;
    const req = request({ id, signature: signed({ id, signingSecret: configuredSecret }) });
    assert.equal(officialValid(req, configuredSecret), true);
    assert.equal(inspectWebhookSignature(req, configuredSecret).valid, true);
});

test('hostile header values never escape as unexpected exceptions', () => {
    const values = [42, true, {}, Object.create(null), { toString() { throw new Error('hostile'); } }, [Symbol('hostile')], []];
    for (const value of values) {
        const req = request({ signature: value });
        assert.doesNotThrow(() => inspectWebhookSignature(req, secret));
        assert.equal(inspectWebhookSignature(req, secret).valid, false);
    }
});

test('body data ID never substitutes for an absent signed query ID', () => {
    const req = request({ id: null });
    req.body = { data: { id: dataId } };
    assert.equal(inspectWebhookSignature(req, secret).valid, false);
});

test('timestamp presence remains diagnostic when the secret is missing', () => {
    const inspected = inspectWebhookSignature(request(), '');
    assert.equal(inspected.valid, false);
    assert.equal(inspected.reason, 'secret_not_configured');
    assert.equal(inspected.has_signature, true);
    assert.equal(inspected.has_timestamp, true);
});
