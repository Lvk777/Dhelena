// A financial attempt can outlive a timed-out request. Never reset it here.
export function canChangePaymentMethod(order) {
    return !!order && order.status === 'recebido' && order.payment_status === 'pending'
        && !order.paid_at && !order.payment_provider && !order.mercado_pago_order_id
        && !order.mercado_pago_payment_id && !order.payment_attempt_started_at
        && !order.payment_attempt_method && !(Number(order.refunded_amount) > 0);
}
