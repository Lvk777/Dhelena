import crypto from 'node:crypto';

function safeIdentifier(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(value) ? value : null;
}

function safeProviderCode(value) {
    return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(value)
        && !/(token|bearer|secret|password|authorization|\d{6})/i.test(value) ? value : null;
}

function safeProviderDescription(value) {
    // Only fixed generic descriptions are emitted; free-form provider prose can contain PII.
    const known = new Map([
        ['invalid request', 'Invalid request'],
        ['bad request', 'Bad request'],
        ['invalid identification', 'Invalid identification'],
        ['invalid payer', 'Invalid payer'],
        ['invalid payment method', 'Invalid payment method'],
        ['invalid amount', 'Invalid amount'],
    ]);
    return typeof value === 'string' ? known.get(value.trim().toLowerCase()) || null : null;
}

export function safeProviderError(err) {
    const data = err?.mpError;
    if (!data || typeof data !== 'object' || !Number.isInteger(err.status)) return {
        provider_http_status: null, provider_error: null, provider_message: null,
        provider_cause_codes: [], provider_cause_descriptions: [],
    };
    const causes = Array.isArray(data.cause) ? data.cause.slice(0, 8) : [];
    return {
        provider_http_status: err.status,
        provider_error: safeProviderCode(data.error),
        provider_message: safeProviderDescription(data.message),
        provider_cause_codes: causes.map(cause => safeProviderCode(cause?.code)).filter(Boolean),
        provider_cause_descriptions: causes.map(cause => safeProviderDescription(cause?.description)).filter(Boolean),
    };
}

export function paymentFailurePolicy(err, stage = 'mp_request') {
    // An HTTP 400 suggests rejection before creation, but only a verified provider
    // search can establish that no order exists. Neither branch releases a retry.
    return stage === 'mp_request' && err?.mpError && err.status === 400
        ? 'precreation_rejection_requires_reconciliation'
        : 'ambiguous_requires_reconciliation';
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
            const provider = safeProviderError(err);
            const frames = typeof err.stack === 'string'
                ? err.stack.split('\n').slice(1).filter(line => /\bat\b/.test(line))
                    .map(line => line.match(/(?:src|node_modules)[\\/][A-Za-z0-9_./\\-]+:\d+:\d+/)?.[0] || null)
                    .filter(Boolean).slice(0, 6)
                : [];
            // Do not emit err.message, provider bodies, headers, payer, or credentials.
            const sanitizedMessage = provider.provider_http_status ? `Mercado Pago HTTP ${provider.provider_http_status}`
                : err.code && /^[A-Z0-9_]{2,20}$/.test(err.code) ? `Código ${err.code}`
                    : 'Falha no fluxo Pix';
            console.error(JSON.stringify({
                event: 'payment_pix_error', stage, error_name: safeIdentifier(err.name) || 'Error',
                message: sanitizedMessage, ...provider, failure_policy: paymentFailurePolicy(err, stage),
                external_reference: externalReference, local_order_id: safeIdentifier(req.params?.id),
                mp_order_id: mpOrderId, correlation_id: correlationId, stack_frames: frames,
            }));
        },
    };
}
