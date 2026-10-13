// Business-day durations only. Calendar dates require the carrier's holiday
// and cutoff calendar plus the actual payment confirmation time.
function days(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 && number <= 365 ? number : null;
}

export function withDeliveryEstimate(quote, config = {}, env = process.env) {
    const min = days(quote.delivery_time_min);
    const max = days(quote.delivery_time_max);
    const single = days(quote.delivery_time);
    const validRange = min !== null && max !== null && min <= max;
    const carrierMax = validRange ? Math.max(max, single ?? 0) : max !== null && min === null ? Math.max(max, single ?? 0) : single;
    const configured = config.melhor_envio_extra_days;
    const preparation = configured === undefined || configured === null || configured === '' ? 2 : days(configured);
    const approved = env.SHIPPING_PREPARATION_ENABLED === 'true' && preparation !== null;
    return { ...quote, delivery_estimate: {
        unit: 'business_days', starts_at: 'payment_confirmation',
        preparation_business_days: approved ? preparation : null,
        carrier_business_days: carrierMax,
        total_business_days: approved && carrierMax !== null ? preparation + carrierMax : null,
    } };
}

export function assertDeliveryEstimateAcknowledged(expected, actual) {
    if (actual?.total_business_days == null) return;
    const fields = ['unit', 'starts_at', 'preparation_business_days', 'carrier_business_days', 'total_business_days'];
    if (!expected || fields.some(key => expected[key] !== actual[key])) {
        throw Object.assign(new Error('O prazo de entrega mudou. Confira o resumo atualizado antes de confirmar.'), { status: 409 });
    }
}
