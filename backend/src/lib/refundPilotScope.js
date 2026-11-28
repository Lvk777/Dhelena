// Temporary real-refund pilot. Do not widen this fence by environment variables
// alone: a reviewed code change is required before other orders can be refunded.
export const PILOT_REFUND_ORDER_NUMBER = 'DH-2026-000020';
export const PILOT_REFUND_PAID_CENTS = 1615;

const blocked = () => Object.assign(new Error('Este pedido não está autorizado para o estorno de homologação.'), { status: 403 });

export function assertPilotRefund(order, kind, amountCents, env = process.env) {
    if (env.AFTER_SALES_OPERATIONAL_PILOT_ENABLED !== 'true'
        || env.AFTER_SALES_OPERATIONAL_ORDER_SCOPE !== PILOT_REFUND_ORDER_NUMBER
        || order?.order_number !== PILOT_REFUND_ORDER_NUMBER
        || kind !== 'full'
        || amountCents !== PILOT_REFUND_PAID_CENTS) throw blocked();
    return true;
}

export function pilotRefundEnabled(env = process.env) {
    return env.AFTER_SALES_OPERATIONAL_PILOT_ENABLED === 'true'
        && env.AFTER_SALES_OPERATIONAL_ORDER_SCOPE === PILOT_REFUND_ORDER_NUMBER;
}
