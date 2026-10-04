// Only explicit, bounded technical identifiers may enter delivery logs.
const technicalId = (value, limit = 128) => typeof value === 'string'
    && value.length > 0 && value.length <= limit && /^[A-Za-z0-9._:-]+$/.test(value)
    ? value : null;

export function createMercadoPagoWebhookLog(req, signature) {
    const dataId = req.query?.['data.id'];
    const rawType = req.body?.type || req.body?.event;
    return {
        event: 'mp_webhook_delivery',
        webhook_type: technicalId(rawType, 40) || 'unknown',
        data_id: typeof dataId === 'string' && /^ORD[A-Za-z0-9]{10,60}$/.test(dataId) ? dataId : null,
        x_request_id_present: signature.has_request_id,
        x_request_id: technicalId(req.headers?.['x-request-id']),
        signature_present: signature.has_signature,
        signature_valid: signature.valid,
        provider_resource_fetch: 'not_attempted',
        processing_result: 'not_started',
        deduplication_result: 'not_attempted',
        refund_reconciliation: 'not_attempted',
        local_order_number: null,
    };
}

export function logMercadoPagoWebhookDelivery(delivery, level = 'log') {
    // Select fields again so no caller can accidentally spread request/provider data.
    const record = {
        event: delivery.event,
        webhook_type: delivery.webhook_type,
        data_id: delivery.data_id,
        x_request_id_present: delivery.x_request_id_present,
        x_request_id: delivery.x_request_id,
        signature_present: delivery.signature_present,
        signature_valid: delivery.signature_valid,
        provider_resource_fetch: delivery.provider_resource_fetch,
        processing_result: delivery.processing_result,
        deduplication_result: delivery.deduplication_result,
        refund_reconciliation: ['not_attempted', 'none_pending', 'pending', 'processing', 'processed']
            .includes(delivery.refund_reconciliation) ? delivery.refund_reconciliation : 'unknown',
        local_order_number: technicalId(delivery.local_order_number, 64),
    };
    console[level](JSON.stringify(record));
}
