import { reconciliationPlan } from './paymentReconciliation.js';
import { refundInFlight } from './refundState.js';

const HISTORICAL_ORDER = 'DH-2026-000006';

function cents(value) {
    if (!/^\d+(?:\.\d{1,2})?$/.test(String(value ?? ''))) return null;
    const amount = Math.round(Number(value) * 100);
    return Number.isSafeInteger(amount) ? amount : null;
}

function colorsOf(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try { return JSON.parse(value); } catch { return []; }
    }
    return [];
}

/** Every query in this function is read-only. The result excludes customer data. */
export async function loadLocalPaymentEvidence(db, order) {
    const { rows: items } = await db.query(
        'SELECT id, product_id, color_id, size, quantity FROM order_items WHERE order_id = $1 ORDER BY id', [order.id]);
    const stockItems = [];
    for (const item of items) {
        const { rows: products } = await db.query('SELECT colors FROM products WHERE id = $1', [item.product_id]);
        const color = colorsOf(products[0]?.colors).find(entry => String(entry.id) === String(item.color_id));
        const currentStock = color?.stock?.[item.size];
        const { rows: movements } = await db.query(
            `SELECT order_id, type, quantity, previous_stock, new_stock, created_at
             FROM stock_movements
             WHERE product_id = $1 AND color_id IS NOT DISTINCT FROM $2
               AND size IS NOT DISTINCT FROM $3
               AND (order_id = $4 OR (order_id IS NULL AND created_at BETWEEN
                   $5::timestamptz - interval '10 seconds' AND $5::timestamptz + interval '10 seconds'))
             ORDER BY created_at`,
            [item.product_id, item.color_id, item.size, order.id, order.created_at]);
        const reservations = movements.filter(row => row.type === 'sale'
            && Number(row.quantity) === -Number(item.quantity)
            && Number(row.previous_stock) - Number(row.new_stock) === Number(item.quantity));
        stockItems.push({
            product_id: item.product_id, color_id: item.color_id, size: item.size,
            purchased_quantity: Number(item.quantity),
            current_stock: Number.isInteger(Number(currentStock)) ? Number(currentStock) : null,
            reservation_count: reservations.length,
            reservation: reservations.length === 1 ? {
                quantity: Number(reservations[0].quantity),
                previous_stock: Number(reservations[0].previous_stock),
                new_stock: Number(reservations[0].new_stock),
                attribution: reservations[0].order_id ? 'order_id' : 'creation_time',
                created_at: reservations[0].created_at,
            } : null,
            restoration_movement_count: movements.filter(row => row.type === 'cancel' || row.type === 'return').length,
        });
    }
    const { rows: restorations } = await db.query(
        'SELECT order_item_id, source, quantity FROM stock_restorations WHERE order_id = $1', [order.id]);
    const { rows: couponUsages } = await db.query(
        `SELECT c.code, cu.created_at,
            (SELECT count(*) FROM coupon_usages all_uses WHERE all_uses.coupon_id = c.id) AS total_uses
         FROM coupon_usages cu JOIN coupons c ON c.id = cu.coupon_id
         WHERE cu.order_id = $1`, [order.id]);
    const { rows: audit } = await db.query(
        `SELECT action, created_at FROM audit_logs
         WHERE entity_type = 'order' AND entity_id = $1 ORDER BY created_at`, [String(order.id)]);
    const { rows: timeline } = await db.query(
        'SELECT event, created_at FROM order_events WHERE order_id = $1 ORDER BY created_at', [order.id]);
    const { rows: paymentIdColumn } = await db.query(
        `SELECT data_type FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'orders'
           AND column_name = 'mercado_pago_payment_id'`);
    return {
        stock_items: stockItems,
        restorations: restorations.map(row => ({ order_item_id: row.order_item_id, source: row.source, quantity: Number(row.quantity) })),
        coupon_usages: couponUsages.map(row => ({ code: row.code, created_at: row.created_at, total_uses: Number(row.total_uses) })),
        audit: audit.map(row => ({ action: row.action, created_at: row.created_at })),
        timeline: timeline.map(row => ({ event: row.event, created_at: row.created_at })),
        transaction_id_column_compatible: paymentIdColumn[0]?.data_type === 'text',
        refund_in_flight: await refundInFlight(db, order.id),
    };
}

/** Pure decision layer. Mismatches are reported as false checks, not leaked errors. */
export function buildPaymentReconciliationPreview(order, provider, evidence, webhookSecretConfigured, requestedMpOrderId) {
    const localTotal = cents(order.total);
    const historical = order.order_number === HISTORICAL_ORDER;
    const stockItems = evidence.stock_items || [];
    const usages = evidence.coupon_usages || [];
    const audit = evidence.audit || [];
    const timeline = evidence.timeline || [];
    const checks = {
        reference_match: provider.external_reference === order.order_number,
        amount_match: localTotal !== null && cents(provider.total_amount) === localTotal
            && cents(provider.transaction_amount) === localTotal,
        currency_match: provider.currency_id === 'BRL'
            && (!provider.transaction_currency_id || provider.transaction_currency_id === 'BRL'),
        provider_order_id_match: provider.mp_order_id === requestedMpOrderId,
        single_transaction: provider.payment_count === 1 && !!provider.mp_payment_id,
        approved_at_provider: provider.order_status === 'processed'
            && provider.order_status_detail === 'accredited'
            && provider.transaction_status === 'processed'
            && provider.transaction_status_detail === 'accredited',
        local_pending: order.status === 'recebido' && order.payment_status === 'pending' && !order.paid_at,
        ids_compatible: (!order.mercado_pago_order_id || order.mercado_pago_order_id === provider.mp_order_id)
            && (!order.mercado_pago_payment_id || order.mercado_pago_payment_id === provider.mp_payment_id),
        payment_attempt_recorded: !!order.payment_attempt_started_at || !!order.mercado_pago_order_id,
        transaction_id_column_compatible: evidence.transaction_id_column_compatible === true,
        stock_reservation_confirmed: stockItems.length > 0 && stockItems.every(item => item.reservation_count === 1),
        no_stock_restoration: (evidence.restorations || []).length === 0
            && stockItems.every(item => item.restoration_movement_count === 0),
        stock_baseline_match: stockItems.length > 0 && stockItems.every(item =>
            item.current_stock !== null && (!historical || (item.current_stock === 7 && item.reservation?.new_stock === 7))),
        coupon_usage_consistent: order.coupon_code
            ? usages.length === 1 && usages[0].code?.toUpperCase() === order.coupon_code.toUpperCase()
                && (!historical || usages[0].total_uses === 1)
            : usages.length === 0,
        audit_baseline_match: historical
            ? audit.length === 1 && audit[0].action === 'order.create' && timeline.length === 0
            : audit.some(entry => entry.action === 'order.create'),
        no_refund_in_flight: evidence.refund_in_flight === false,
    };
    let providerPolicyAllows = false;
    if (Object.values(checks).every(Boolean)) {
        try { providerPolicyAllows = reconciliationPlan(order, provider, evidence.refund_in_flight).safe_to_reconcile; }
        catch { providerPolicyAllows = false; }
    }
    checks.provider_policy_allows = providerPolicyAllows;
    return {
        integration: { mode: 'test', webhook_test_secret_configured: !!webhookSecretConfigured },
        local: {
            order_id: order.id, order_number: order.order_number, order_status: order.status,
            payment_status: order.payment_status, total: String(order.total), currency: 'BRL',
            currency_source: 'store_policy', paid_at: order.paid_at,
            mp_order_id: order.mercado_pago_order_id, mp_payment_id: order.mercado_pago_payment_id,
            payment_attempt_started_at: order.payment_attempt_started_at,
            stock: stockItems, stock_restorations: evidence.restorations || [],
            coupon_code: order.coupon_code, coupon_usages: usages,
            audit, timeline,
        },
        provider: {
            mp_order_id: provider.mp_order_id, external_reference: provider.external_reference,
            total: provider.total_amount, currency: provider.currency_id,
            order_status: provider.order_status, order_status_detail: provider.order_status_detail,
            transaction_id: provider.mp_payment_id, transaction_amount: provider.transaction_amount,
            transaction_status: provider.transaction_status,
            transaction_status_detail: provider.transaction_status_detail,
        },
        checks,
        safe_to_reconcile: Object.values(checks).every(Boolean),
        proposed_changes: {
            payment_status: { from: order.payment_status, to: 'approved' },
            order_status: { from: order.status, to: 'pagamento_aprovado' },
            paid_at: 'set_on_commit', mp_order_id: provider.mp_order_id,
            mp_payment_id: provider.mp_payment_id, audit: 'payment_reconciled',
            timeline: 'payment_approved', changes_stock: false, charges_payment: false,
            consumes_coupon: false,
        },
    };
}

export async function loadPaymentReconciliationPreview(db, mercadoPago, orderId, candidateMpOrderId, lockedOrder = null) {
    if (mercadoPago.getMercadoPagoMode() !== 'test') {
        throw Object.assign(new Error('Prévia disponível somente em TEST'), { status: 409 });
    }
    if (typeof orderId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
        throw Object.assign(new Error('Pedido inválido'), { status: 400 });
    }
    const order = lockedOrder || (await db.query('SELECT * FROM orders WHERE id = $1', [orderId])).rows[0];
    if (!order) throw Object.assign(new Error('Pedido não encontrado'), { status: 404 });
    const mpOrderId = candidateMpOrderId || order.mercado_pago_order_id;
    if (typeof mpOrderId !== 'string' || !/^ORD[A-Z0-9]{10,60}$/.test(mpOrderId)) {
        throw Object.assign(new Error('MP order ID inválido'), { status: 400 });
    }
    const provider = await mercadoPago.getOrderStatus(mpOrderId);
    const evidence = await loadLocalPaymentEvidence(db, order);
    const preview = buildPaymentReconciliationPreview(order, provider, evidence,
        mercadoPago.getMercadoPagoReadiness().webhook_configured, mpOrderId);
    return { preview, order, provider };
}

/** Pin the approved Orders API transaction to the admin's explicit expectation. */
export function assertExpectedTransactionId(provider, expectedTransactionId) {
    if (typeof expectedTransactionId !== 'string' || !/^PAY[A-Z0-9]{10,60}$/.test(expectedTransactionId)) {
        throw Object.assign(new Error('ID esperado da transação inválido'), { status: 400 });
    }
    if (provider.mp_payment_id !== expectedTransactionId) {
        throw Object.assign(new Error('ID da transação divergiu da confirmação administrativa'), { status: 409 });
    }
}
