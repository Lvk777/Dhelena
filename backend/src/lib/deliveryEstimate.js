// Business-day durations only. Calendar dates require the carrier's holiday
// and cutoff calendar plus the actual payment confirmation time.
function days(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 && number <= 365 ? number : null;
}

export function preparationPolicy(config = {}, env = process.env) {
    const configured = config.melhor_envio_extra_days;
    const preparation = configured === undefined || configured === null || configured === '' ? 2 : days(configured);
    const enabled = env.SHIPPING_PREPARATION_ENABLED === 'true' && preparation !== null;
    return { enabled, business_days: enabled ? preparation : null, includes_posting: true,
        counting: 'next_business_day_after_payment_confirmation', excludes_weekends_and_holidays: true };
}

export function withDeliveryEstimate(quote, config = {}, env = process.env) {
    const min = days(quote.delivery_time_min);
    const max = days(quote.delivery_time_max);
    const single = days(quote.delivery_time);
    const validRange = min !== null && max !== null && min <= max;
    const inconsistentRange = min !== null && max !== null && min > max;
    const carrierMax = inconsistentRange ? null : validRange ? Math.max(max, single ?? 0) : max !== null && min === null ? Math.max(max, single ?? 0) : single;
    const policy = preparationPolicy(config, env);
    return { ...quote, delivery_estimate: {
        unit: 'business_days', starts_at: 'payment_confirmation',
        preparation_business_days: policy.business_days,
        preparation_includes_posting: true,
        counting: policy.counting,
        excludes_weekends_and_holidays: true,
        carrier_business_days: carrierMax,
        total_business_days: policy.enabled && carrierMax !== null ? policy.business_days + carrierMax : null,
    } };
}

export function assertDeliveryEstimateAcknowledged(expected, actual) {
    if (actual?.total_business_days == null && expected?.total_business_days == null) return;
    const fields = ['unit', 'starts_at', 'preparation_business_days', 'carrier_business_days', 'total_business_days'];
    if (!expected || !actual || fields.some(key => expected[key] !== actual[key])) {
        throw Object.assign(new Error('O prazo de entrega mudou. Confira o resumo atualizado antes de confirmar.'), { status: 409 });
    }
}
