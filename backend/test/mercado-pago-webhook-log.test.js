import test from 'node:test';
import assert from 'node:assert/strict';
import { createMercadoPagoWebhookLog, logMercadoPagoWebhookDelivery } from '../src/lib/mercadoPagoWebhookLog.js';

test('Mercado Pago delivery log contains correlation fields but never credentials or signature', () => {
    const secret = 'webhook-secret-DO-NOT-LOG';
    const accessToken = 'TEST-access-token-DO-NOT-LOG';
    const signature = 'ts=123,v1=signature-DO-NOT-LOG';
    const authorization = `Bearer ${accessToken}`;
    const req = {
        query: { 'data.id': 'ORDTST01M3WY62VJNVEVXATHY3CRDVHW' },
        headers: { 'x-request-id': 'safe-request-123', 'x-signature': signature, authorization },
        body: { type: 'order', secret, access_token: accessToken, payer: { email: 'pii@example.test' } },
    };
    const delivery = createMercadoPagoWebhookLog(req, {
        has_request_id: true, has_signature: true, valid: true,
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
    assert.equal(record.provider_resource_fetch, 'success');
    assert.equal(record.refund_reconciliation, 'processed');
    assert.equal(record.local_order_number, 'DH-2026-000006');
    for (const sensitive of [secret, accessToken, signature, authorization, 'pii@example.test']) {
        assert.equal(log.includes(sensitive), false);
    }
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
