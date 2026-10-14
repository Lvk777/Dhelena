// Temporary E2E fence for the remaining TEST refund. Widen only through a reviewed release.
export const TEST_REFUND_SCOPE = Object.freeze({
    orderNumber: 'DH-2026-000006',
    mpOrderId: 'ORDTST01M3WY62VJNVEVXATHY3CRDVHW',
    mpTransactionId: 'PAY01M3WY62W216W8V5J7XA7JD5JJ',
    paidCents: 5000,
    alreadyRefundedCents: 100,
    remainingCents: 4900,
    priorRefundCount: 1,
});

export function isAuthorizedTestOrder(order) {
    return order.order_number === TEST_REFUND_SCOPE.orderNumber
        && order.mercado_pago_order_id === TEST_REFUND_SCOPE.mpOrderId
        && String(order.mercado_pago_payment_id) === TEST_REFUND_SCOPE.mpTransactionId;
}

export function isAuthorizedTestRefund(order, kind, paidCents, alreadyRefundedCents, requestedCents, priorRefundCount) {
    return isAuthorizedTestOrder(order)
        && order.payment_status === 'partially_refunded'
        && kind === 'remaining'
        && paidCents === TEST_REFUND_SCOPE.paidCents
        && alreadyRefundedCents === TEST_REFUND_SCOPE.alreadyRefundedCents
        && requestedCents === TEST_REFUND_SCOPE.remainingCents
        && priorRefundCount === TEST_REFUND_SCOPE.priorRefundCount;
}
