import crypto from 'node:crypto';

function safeIdentifier(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(value) ? value : null;
}

export function createPaymentDiagnostic(req) {
    const correlationId = safeIdentifier(req.headers?.['x-request-id']) || crypto.randomUUID();
    let stage = 'load_order';
    let externalReference = null;
    let mpOrderId = null;
    return {
        setStage(value, orderId = null) {
            stage = value;
            if (orderId) mpOrderId = safeIdentifier(orderId);
            console.info(JSON.stringify({
                event: 'payment_pix_stage', stage, correlation_id: correlationId,
                external_reference: externalReference, local_order_id: safeIdentifier(req.params?.id),
                mp_order_id: mpOrderId,
            }));
        },
        setReference(value) { externalReference = safeIdentifier(value); },
        logError(err) {
            const providerStatus = err.mpError && Number.isInteger(err.status) ? err.status : null;
            const frames = typeof err.stack === 'string'
                ? err.stack.split('\n').slice(1).filter(line => /\bat\b/.test(line))
                    .map(line => line.match(/(?:src|node_modules)[\\/][A-Za-z0-9_./\\-]+:\d+:\d+/)?.[0] || null)
                    .filter(Boolean).slice(0, 6)
                : [];
            // Do not emit err.message, provider bodies, headers, payer, or credentials.
            const sanitizedMessage = providerStatus ? `Mercado Pago HTTP ${providerStatus}`
                : err.code && /^[A-Z0-9_]{2,20}$/.test(err.code) ? `Código ${err.code}`
                    : 'Falha no fluxo Pix';
            console.error(JSON.stringify({
                event: 'payment_pix_error', stage, error_name: safeIdentifier(err.name) || 'Error',
                message: sanitizedMessage, provider_http_status: providerStatus,
                external_reference: externalReference, local_order_id: safeIdentifier(req.params?.id),
                mp_order_id: mpOrderId, correlation_id: correlationId, stack_frames: frames,
            }));
        },
    };
}
