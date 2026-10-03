// Temporary E2E fence. Widen only through a separately reviewed release.
export const TEST_REFUND_SCOPE = Object.freeze({
    orderNumber: 'DH-2026-000006',
    mpOrderId: 'ORDTST01M3WY62VJNVEVXATHY3CRDVHW',
    mpTransactionId: 'PAY01M3WY62W216W8V5J7XA7JD5JJ',
    amountCents: 100,
});

export function isAuthorizedTestRefund(order, requestedCents) {
    return order.order_number === TEST_REFUND_SCOPE.orderNumber
        && order.mercado_pago_order_id === TEST_REFUND_SCOPE.mpOrderId
        && String(order.mercado_pago_payment_id) === TEST_REFUND_SCOPE.mpTransactionId
        && requestedCents === TEST_REFUND_SCOPE.amountCents;
}
