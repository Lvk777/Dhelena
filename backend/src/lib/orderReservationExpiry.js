const MIN_TTL_MINUTES = 30;
const MAX_TTL_MINUTES = 1440;
const DEFAULT_TTL_MINUTES = 60;

export function reservationExpiryAt(env = process.env, now = Date.now) {
    if (env.ORDER_RESERVATION_EXPIRY_ENABLED !== 'true') return null;
    const minutes = Number(env.ORDER_RESERVATION_TTL_MINUTES ?? DEFAULT_TTL_MINUTES);
    if (!Number.isSafeInteger(minutes) || minutes < MIN_TTL_MINUTES || minutes > MAX_TTL_MINUTES) {
        throw Object.assign(new Error('Prazo de reserva inválido'), { status: 503 });
    }
    return new Date(now() + minutes * 60_000).toISOString();
}

// Only orders stamped by the opt-in checkout may be released automatically.
// Any local hint of a provider request or uncertain financial state fails closed.
export function canExpireReservation(order, now = Date.now()) {
    const marker = order?.snapshot?.reservation_expires_at;
    if (order?.snapshot?.stock_model !== 'deferred_sale_v1' || !Number.isFinite(now)
        || typeof marker !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(marker)
        || !Number.isFinite(Date.parse(marker)) || new Date(marker).toISOString() !== marker
        || Date.parse(marker) > now) return false;
    return order.status === 'recebido' && order.payment_status === 'pending'
        && !order.paid_at && !order.payment_provider && !order.payment_attempt_started_at
        && !order.payment_attempt_method && !order.mercado_pago_order_id
        && !order.mercado_pago_payment_id && !order.mercado_pago_status
        && !order.mercado_pago_external_reference && !order.mercado_pago_status_detail
        && !order.payment_updated_at && !order.pix_qr_code && !order.pix_qr_code_base64
        && !order.melhor_envio_shipment_id && !order.tracking_code
        && !order.snapshot?.payment_context && !order.snapshot?.card_installment_offer;
}
