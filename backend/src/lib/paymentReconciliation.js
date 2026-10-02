import { verifyPaymentResourceForOrder, hasPaymentStateChanged } from './paymentVerification.js';
import { shouldApplyProviderPayment } from './afterSalesPolicy.js';
import { refundInFlight } from './refundState.js';
import { mapPaymentStatus } from '../services/mercadoPago.js';

// This historical TEST attempt requires a fresh read-only preview before any local mutation.
const MANUAL_RECONCILIATION_ONLY = new Set(['DH-2026-000006']);

export function reconciliationPlan(order, resource, hasRefundInFlight = false) {
    verifyPaymentResourceForOrder(order, resource);
    const paymentStatus = mapPaymentStatus(resource.mp_status, resource.mp_status_detail);
    const approved = resource.order_status === 'processed'
        && resource.order_status_detail === 'accredited'
        && resource.transaction_status === 'processed'
        && resource.transaction_status_detail === 'accredited'
        && paymentStatus === 'approved';
    const canApply = shouldApplyProviderPayment(order, paymentStatus, hasRefundInFlight)
        && !(order.payment_status === 'approved' && paymentStatus !== 'approved');
    return {
        safe_to_reconcile: canApply && approved,
        payment_status: paymentStatus,
        order_status: approved && order.status === 'recebido' ? 'pagamento_aprovado' : order.status,
        mp_order_id: resource.mp_order_id,
        mp_payment_id: resource.mp_payment_id,
        external_reference: resource.external_reference,
        total_amount: resource.total_amount,
        currency: resource.currency_id,
        order_provider_status: resource.order_status,
        order_provider_status_detail: resource.order_status_detail,
        transaction_amount: resource.transaction_amount,
        transaction_status: resource.transaction_status,
        transaction_status_detail: resource.transaction_status_detail,
        would_set_paid_at: approved && !order.paid_at,
        manual_reconciliation_only: MANUAL_RECONCILIATION_ONLY.has(order.order_number),
        would_change_stock: false,
        would_create_charge: false,
    };
}

/** Caller owns the transaction; row lock serializes webhook and manual sync. */
export async function applyVerifiedOrderInTransaction(client, orderId, resource, source) {
    const { rows } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (!rows.length) throw Object.assign(new Error('Pedido não encontrado'), { status: 404 });
    const current = rows[0];
    if (MANUAL_RECONCILIATION_ONLY.has(current.order_number) && source !== 'admin') {
        return { outcome: 'manual_reconciliation_required', payment_status: current.payment_status };
    }
    const plan = reconciliationPlan(current, resource, await refundInFlight(client, current.id));
    if (!plan.safe_to_reconcile) return { outcome: 'ignored', payment_status: current.payment_status };
    const changed = hasPaymentStateChanged(current, resource, plan.payment_status)
        || (plan.would_set_paid_at || current.status !== plan.order_status || !!current.payment_attempt_started_at);
    if (!changed) return { outcome: 'already_reconciled', payment_status: current.payment_status };

    await client.query(
        `UPDATE orders SET payment_provider = 'mercado_pago',
            mercado_pago_order_id = $1, mercado_pago_payment_id = $2,
            mercado_pago_external_reference = $3, mercado_pago_status = $4,
            mercado_pago_status_detail = $5, payment_status = $6,
            paid_at = COALESCE(paid_at, now()), status = $7,
            payment_attempt_started_at = NULL, payment_updated_at = now(), updated_at = now()
         WHERE id = $8`,
        [resource.mp_order_id, resource.mp_payment_id, resource.external_reference,
            resource.mp_status, resource.mp_status_detail, plan.payment_status, plan.order_status, orderId]
    );
    await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, changes)
         VALUES ('payment_reconciled', 'order', $1, $2)`,
        [orderId, JSON.stringify({ source, mp_order_id: resource.mp_order_id, mp_payment_id: resource.mp_payment_id })]
    );
    await client.query(
        `INSERT INTO order_events (order_id, event, description, metadata)
         VALUES ($1, 'payment_approved', 'Pagamento aprovado pela order oficial do Mercado Pago', $2)`,
        [orderId, JSON.stringify({ source, mp_order_id: resource.mp_order_id })]
    );
    return { outcome: 'applied', payment_status: plan.payment_status };
}

/** Save a verified non-approved Orders API state without claiming it is paid. */
export async function recordVerifiedNonApprovedOrderInTransaction(client, orderId, resource, source) {
    const { rows } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (!rows.length) throw Object.assign(new Error('Pedido não encontrado'), { status: 404 });
    const current = rows[0];
    if (MANUAL_RECONCILIATION_ONLY.has(current.order_number) && source !== 'admin') {
        return { outcome: 'manual_reconciliation_required', payment_status: current.payment_status };
    }
    verifyPaymentResourceForOrder(current, resource);
    const paymentStatus = mapPaymentStatus(resource.mp_status, resource.mp_status_detail);
    if (paymentStatus === 'approved' || current.payment_status === 'approved'
        || !shouldApplyProviderPayment(current, paymentStatus, await refundInFlight(client, current.id))) {
        return { outcome: 'ignored', payment_status: current.payment_status };
    }
    if (!hasPaymentStateChanged(current, resource, paymentStatus) && !current.payment_attempt_started_at) {
        return { outcome: 'already_recorded', payment_status: current.payment_status };
    }
    await client.query(
        `UPDATE orders SET payment_provider = 'mercado_pago', mercado_pago_order_id = $1,
            mercado_pago_payment_id = $2, mercado_pago_external_reference = $3,
            mercado_pago_status = $4, mercado_pago_status_detail = $5,
            payment_status = $6, payment_attempt_started_at = NULL,
            payment_updated_at = now(), updated_at = now() WHERE id = $7`,
        [resource.mp_order_id, resource.mp_payment_id, resource.external_reference,
            resource.mp_status, resource.mp_status_detail, paymentStatus, orderId]
    );
    await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, changes)
         VALUES ($2, 'order', $1, $3)`,
        [orderId, `payment_${paymentStatus}`, JSON.stringify({ source, mp_order_id: resource.mp_order_id, mp_payment_id: resource.mp_payment_id })]
    );
    await client.query(
        `INSERT INTO order_events (order_id, event, description, metadata)
         VALUES ($1, $2, 'Estado do pagamento confirmado pela order oficial do Mercado Pago', $3)`,
        [orderId, `payment_${paymentStatus}`, JSON.stringify({ source, mp_order_id: resource.mp_order_id })]
    );
    return { outcome: 'applied', payment_status: paymentStatus };
}
