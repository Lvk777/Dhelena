import { pool } from '../config/db.js';
import * as mp from '../services/mercadoPago.js';
import { assertRefundableOrder, moneyCents, requestedRefundCents } from './afterSalesPolicy.js';
import { isAuthorizedTestRefund } from './testRefundScope.js';

function providerLedgerMatches(provider, ledger, paymentId) {
    const processed = ledger.filter(row => row.status === 'processed');
    if (provider.refunds.length !== processed.length) return false;
    return processed.every(row => provider.refunds.some(refund =>
        refund.id === row.provider_refund_id
        && String(refund.transaction_id) === String(paymentId)
        && refund.status === 'processed'
        && moneyCents(refund.amount) === moneyCents(row.amount)));
}

export function buildRefundPreview(order, provider, ledger, returns, stock, restorations, requestedCents, mode, enabled) {
    const requested = requestedRefundCents(requestedCents);
    const paid = moneyCents(order.total);
    const alreadyRefunded = ledger.filter(row => row.status === 'processed')
        .reduce((sum, row) => sum + moneyCents(row.amount), 0);
    const balance = paid - alreadyRefunded;
    let paymentMatches = false;
    try {
        assertRefundableOrder(order, provider, alreadyRefunded);
        paymentMatches = order.payment_status === 'approved' || order.payment_status === 'partially_refunded';
    } catch { /* The checks below explain why the preview is unsafe. */ }
    const refundInProgress = ledger.some(row => ['reserved', 'processing', 'reconciliation_required'].includes(row.status));
    const checks = {
        test_mode: mode === 'test',
        refunds_enabled: enabled,
        authorized_test_scope: isAuthorizedTestRefund(order, requested),
        physical_baseline: returns.length === 0 && restorations.length === 0
            && stock.length === 1 && Number(stock[0].quantity) === 7,
        approved_payment_matches: paymentMatches,
        provider_ledger_matches: providerLedgerMatches(provider, ledger, order.mercado_pago_payment_id),
        no_refund_in_progress: !refundInProgress,
        amount_available: alreadyRefunded <= paid && requested <= balance,
    };
    return {
        order_number: order.order_number,
        mode,
        paid_amount_cents: paid,
        already_refunded_cents: alreadyRefunded,
        refundable_balance_cents: Math.max(0, balance),
        requested_refund_cents: requested,
        remaining_balance_cents: balance - requested,
        mp_order_id: order.mercado_pago_order_id,
        mp_transaction_id: order.mercado_pago_payment_id,
        local_payment_status: order.payment_status,
        provider_status: { order: provider.status, payment: provider.payment?.status },
        existing_refunds: ledger.map(row => ({
            id: row.id, amount_cents: moneyCents(row.amount), status: row.status,
            provider_refund_id: row.provider_refund_id,
        })),
        refund_in_progress: refundInProgress,
        stock,
        stock_restorations: restorations,
        return_status: returns.map(row => ({ id: row.id, status: row.status })),
        checks,
        safe_to_partial_refund: Object.values(checks).every(Boolean),
        stock_change: 0,
        stock_restoration: 0,
        return_created: false,
        return_received: false,
    };
}

/** Read-only: fresh official Orders API GET plus local SELECTs, no reservation or POST. */
export async function loadRefundPreview(orderId, requestedCents, db = pool, provider = mp) {
    requestedRefundCents(requestedCents);
    const order = (await db.query('SELECT * FROM orders WHERE id = $1', [orderId])).rows[0];
    if (!order) throw Object.assign(new Error('Pedido não encontrado'), { status: 404 });
    if (!order.mercado_pago_order_id) throw Object.assign(new Error('Pedido sem order Mercado Pago'), { status: 409 });
    const [remote, refunds, returns, restorations, items] = await Promise.all([
        provider.getRefundableOrder(order.mercado_pago_order_id),
        db.query('SELECT * FROM order_refunds WHERE order_id = $1 ORDER BY created_at', [orderId]),
        db.query('SELECT id, status FROM order_returns WHERE order_id = $1 ORDER BY created_at', [orderId]),
        db.query('SELECT id, quantity, source FROM stock_restorations WHERE order_id = $1', [orderId]),
        db.query('SELECT product_id, color_id, size FROM order_items WHERE order_id = $1', [orderId]),
    ]);
    const stock = [];
    for (const item of items.rows) {
        const product = (await db.query('SELECT colors FROM products WHERE id = $1', [item.product_id])).rows[0];
        const colors = typeof product?.colors === 'string' ? JSON.parse(product.colors) : product?.colors;
        const color = (Array.isArray(colors) ? colors : []).find(entry => String(entry.id) === String(item.color_id));
        stock.push({ product_id: item.product_id, color_id: item.color_id,
            size: item.size, quantity: color?.stock?.[item.size] ?? null });
    }
    return buildRefundPreview(order, remote, refunds.rows, returns.rows, stock, restorations.rows,
        requestedCents, provider.getMercadoPagoMode(), process.env.AFTER_SALES_REFUNDS_ENABLED === 'true');
}
