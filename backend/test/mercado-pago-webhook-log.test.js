import test from 'node:test';
import assert from 'node:assert/strict';
import { createMercadoPagoWebhookLog, logMercadoPagoWebhookDelivery, safeApplicationId } from '../src/lib/mercadoPagoWebhookLog.js';

test('Mercado Pago delivery log contains correlation fields but never credentials or signature', () => {
    const secret = 'webhook-secret-DO-NOT-LOG';
    const accessToken = 'TEST-access-token-DO-NOT-LOG';
    const signature = 'ts=123,v1=signature-DO-NOT-LOG';
    const authorization = `Bearer ${accessToken}`;
    const req = {
        query: { 'data.id': 'ORDTST01M3WY62VJNVEVXATHY3CRDVHW' },
        headers: { 'x-request-id': 'safe-request-123', 'x-signature': signature, 'x-retry': '2', authorization },
        body: { type: 'order', application_id: '6694235692742515', live_mode: false, secret, access_token: accessToken, payer: { email: 'pii@example.test' } },
    };
    const delivery = createMercadoPagoWebhookLog(req, {
        has_request_id: true, has_signature: true, has_query_data_id: true, has_timestamp: true, valid: true,
    });
    delivery.provider_resource_fetch = 'success';
    delivery.processing_result = 'manual_reconciliation_required';
    delivery.deduplication_result = 'processed';
    delivery.refund_reconciliation = 'processed';
    delivery.local_order_number = 'DH-2026-000006';
    const captured = [];
    const original = console.log;
    console.log = value => captured.push(value);
    try { logMercadoPagoWebhookDelivery(delivery); }
    finally { console.log = original; }
    assert.equal(captured.length, 1);
    const log = captured[0];
    const record = JSON.parse(log);
    assert.equal(record.data_id, req.query['data.id']);
    assert.equal(record.x_request_id, 'safe-request-123');
    assert.equal(record.signature_valid, true);
    assert.equal(record.data_id_present, true);
    assert.equal(record.ts_present, true);
    assert.equal(record.application_id, '6694235692742515');
    assert.equal(record.live_mode, false);
    assert.equal(record.x_retry, 2);
    assert.equal(record.provider_resource_fetch, 'success');
    assert.equal(record.refund_reconciliation, 'processed');
    assert.equal(record.local_order_number, 'DH-2026-000006');
    for (const sensitive of [secret, accessToken, signature, authorization, 'pii@example.test']) {
        assert.equal(log.includes(sensitive), false);
    }
});

test('diagnostic metadata is allowlisted again even if a caller injects extra fields', () => {
    const delivery = createMercadoPagoWebhookLog({
        query: {}, headers: { 'x-retry': 'buyer@example.test' },
        body: { application_id: { payer: 'private' }, live_mode: 'private' },
    }, { valid: false });
    assert.equal(delivery.application_id, null);
    assert.equal(delivery.live_mode, null);
    assert.equal(delivery.x_retry, null);
    assert.equal(delivery.ts_present, false);
    assert.equal(delivery.data_id_present, false);
    Object.assign(delivery, { secret: 'private-secret', v1: 'private-signature', secret_hash: 'private-hash', body: 'private-body' });
    const records = [];
    const original = console.warn;
    console.warn = value => records.push(JSON.parse(value));
    try { logMercadoPagoWebhookDelivery(delivery, 'warn'); }
    finally { console.warn = original; }
    assert.equal(JSON.stringify(records).includes('private'), false);
    for (const key of ['secret', 'v1', 'secret_hash', 'body', 'headers', 'payer', 'cpf', 'email', 'qr_code']) {
        assert.equal(Object.hasOwn(records[0], key), false);
    }
    assert.equal(safeApplicationId(6694235692742515), '6694235692742515');
    assert.equal(safeApplicationId(Number.MAX_SAFE_INTEGER + 1), null);
});

test('Mercado Pago delivery log drops unsafe request IDs and untrusted webhook types', () => {
    const req = {
        query: { 'data.id': 'ORDTST01M3WY62VJNVEVXATHY3CRDVHW' },
        headers: { 'x-request-id': 'request\nsecret=DO-NOT-LOG' },
        body: { type: 'order\nsecret=DO-NOT-LOG' },
    };
    const delivery = createMercadoPagoWebhookLog(req, {
        has_request_id: true, has_signature: false, valid: false,
    });
    assert.equal(delivery.x_request_id_present, true);
    assert.equal(delivery.x_request_id, null);
    assert.equal(delivery.webhook_type, 'unknown');
    assert.equal(JSON.stringify(delivery).includes('DO-NOT-LOG'), false);
});
