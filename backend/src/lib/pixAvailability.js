// Pix uses the Orders API. The optional /v1/payment_methods listing is not a
// capability check for that flow, especially with TEST credentials.
export function getPixCapability(paymentConfig, readiness) {
    const configured = readiness.configured && readiness.webhook_configured;
    return {
        available: configured,
        enabled: configured && paymentConfig.pix_enabled !== false,
        source: 'orders_api_configuration',
        reason: !readiness.configured ? 'integration_not_configured'
            : !readiness.webhook_configured ? 'webhook_not_configured'
                : paymentConfig.pix_enabled === false ? 'disabled_in_store' : null,
    };
}
