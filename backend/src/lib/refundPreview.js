import { pool } from '../config/db.js';
import * as mp from '../services/mercadoPago.js';
import { assertRefundableOrder, moneyCents } from './afterSalesPolicy.js';
import { isAuthorizedTestRefund } from './testRefundScope.js';
import { isRefundPhysicalBaseline, loadRefundPhysicalState } from './refundPhysicalState.js';

function providerLedgerMatches(provider, ledger, paymentId) {
    const processed = ledger.filter(row => row.status === 'processed');
    if (provider.refunds.length !== processed.length) return false;
    return processed.every(row => provider.refunds.some(refund =>
        refund.id === row.provider_refund_id
        && row.provider_order_id === provider.id
        && String(refund.transaction_id) === String(paymentId)
        && String(row.provider_payment_id) === String(paymentId)
        && refund.status === 'processed'
        && moneyCents(refund.amount) === moneyCents(row.amount)));
}

export function buildRefundPreview(order, provider, ledger, returns, stock, restorations, mode, enabled) {
    const paid = moneyCents(order.total);
    const processed = ledger.filter(row => row.status === 'processed');
    const alreadyRefunded = processed
        .reduce((sum, row) => sum + moneyCents(row.amount), 0);
    const providerTotalRefunded = provider.refunds
        .reduce((sum, row) => sum + moneyCents(row.amount), 0);
    const balance = paid - alreadyRefunded;
    const requested = Math.max(0, balance);
    let paymentMatches = false;
    try {
        assertRefundableOrder(order, provider, alreadyRefunded);
        paymentMatches = order.payment_status === 'partially_refunded';
    } catch { /* The checks below explain why the preview is unsafe. */ }
    const refundInProgress = ledger.some(row => ['reserved', 'processing', 'reconciliation_required'].includes(row.status));
    const reconciliationRequired = ledger.some(row => row.status === 'reconciliation_required');
    const checks = {
        test_mode: mode === 'test',
        refunds_enabled: enabled,
        authorized_test_scope: isAuthorizedTestRefund(order, 'remaining', paid,
            alreadyRefunded, requested, ledger.length),
        physical_baseline: isRefundPhysicalBaseline({ returns, restorations, stock }),
        approved_payment_matches: paymentMatches,
        provider_ledger_matches: providerLedgerMatches(provider, ledger, order.mercado_pago_payment_id),
        no_refund_in_progress: !refundInProgress,
        amount_available: balance > 0 && alreadyRefunded + requested <= paid,
    };
    return {
        order_number: order.order_number,
        mode,
        paid_amount_cents: paid,
        already_refunded_cents: alreadyRefunded,
        refundable_balance_cents: Math.max(0, balance),
        requested_refund_cents: requested,
        remaining_balance_cents: Math.max(0, balance - requested),
        provider_refund_count: provider.refunds.length,
        local_refund_count: ledger.length,
        provider_total_refunded_cents: providerTotalRefunded,
        local_total_refunded_cents: alreadyRefunded,
        ledger_match: checks.provider_ledger_matches,
        provider_refunds: provider.refunds.map(row => ({
            id: row.id, amount_cents: moneyCents(row.amount), status: row.status,
            transaction_id: row.transaction_id,
        })),
        mp_order_id: order.mercado_pago_order_id,
        mp_transaction_id: order.mercado_pago_payment_id,
        local_payment_status: order.payment_status,
        provider_status: { order: provider.status, payment: provider.payment?.status },
        existing_refunds: ledger.map(row => ({
            id: row.id, kind: row.kind, amount_cents: moneyCents(row.amount), status: row.status,
            provider_refund_id: row.provider_refund_id, provider_payment_id: row.provider_payment_id,
        })),
        refund_in_progress: refundInProgress,
        reconciliation_required: reconciliationRequired,
        stock,
        stock_restorations: restorations,
        return_status: returns.map(row => ({ id: row.id, status: row.status })),
        checks,
        safe_to_refund_remaining: Object.values(checks).every(Boolean),
        only_blocker_is_flag: !enabled && Object.entries(checks)
            .every(([name, passed]) => name === 'refunds_enabled' || passed),
        stock_change: 0,
        stock_restoration: 0,
        return_created: false,
        return_received: false,
    };
}

/** Read-only: fresh official Orders API GET plus local SELECTs, no reservation or POST. */
export async function loadRefundPreview(orderId, db = pool, provider = mp) {
    const order = (await db.query('SELECT * FROM orders WHERE id = $1', [orderId])).rows[0];
    if (!order) throw Object.assign(new Error('Pedido não encontrado'), { status: 404 });
    if (!order.mercado_pago_order_id) throw Object.assign(new Error('Pedido sem order Mercado Pago'), { status: 409 });
    const [remote, refunds, physical] = await Promise.all([
        provider.getRefundableOrder(order.mercado_pago_order_id),
        db.query('SELECT * FROM order_refunds WHERE order_id = $1 ORDER BY created_at', [orderId]),
        loadRefundPhysicalState(db, orderId),
    ]);
    return buildRefundPreview(order, remote, refunds.rows, physical.returns, physical.stock, physical.restorations,
        provider.getMercadoPagoMode(), process.env.AFTER_SALES_REFUNDS_ENABLED === 'true');
}
