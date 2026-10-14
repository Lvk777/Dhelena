import { withTransaction } from '../config/db.js';
import { checkoutCents, pixDiscountOffer, pixDiscountCents, assertCheckoutPriceAcknowledged } from './checkoutDiscount.js';
import { orderAttemptLockSql } from './orderAttemptLock.js';
import { normalizeIdempotencyKey } from './idempotency.js';
import * as mp from '../services/mercadoPago.js';
import { getPixCapability } from './pixAvailability.js';

const fail = (message, status = 409) => Object.assign(new Error(message), { status });

// Backend deploys independently of the storefront source tree. The frontend
// eligibility hint is tested against this authoritative decision.
export function canChangePaymentMethod(order) {
    return !!order && order.status === 'recebido' && order.payment_status === 'pending'
        && !order.paid_at && !order.payment_provider && !order.mercado_pago_order_id
        && !order.mercado_pago_payment_id && !order.payment_attempt_started_at
        && !order.payment_attempt_method && !(Number(order.refunded_amount) > 0);
}

// Purchased prices, freight, coupon and promotion reservations remain fixed.
// Only the method-dependent Pix component may change. Historical orders lacking
// a breakdown can change method only while the Pix offer is OFF.
export function changedPaymentPricing(order, method, config = {}, env = process.env) {
    const snapshot = order.snapshot || {};
    const breakdown = snapshot.discount_breakdown;
    const offer = pixDiscountOffer(config, env);
    if (!breakdown && (offer.enabled || Number(snapshot.pix_discount_percentage) > 0)) {
        throw fail('Este pedido antigo precisa de revisão antes de alterar o pagamento.');
    }
    const subtotal = checkoutCents(order.subtotal);
    const oldDiscount = checkoutCents(order.discount);
    const oldPix = checkoutCents(breakdown?.pix || 0);
    const fixedDiscount = oldDiscount - oldPix;
    if (fixedDiscount < 0 || oldDiscount > subtotal) throw fail('Descontos do pedido precisam de revisão.');
    const hasPromotion = (breakdown?.promotion || 0) > 0 || !!snapshot.promotion
        || !Array.isArray(snapshot.items) || snapshot.items.some(item => item.price_promotion);
    const reason = !offer.enabled ? 'offer_disabled' : method !== 'pix' ? 'payment_method'
        : order.coupon_code || snapshot.coupon_code ? 'coupon' : hasPromotion || fixedDiscount > 0 ? 'price_promotion' : null;
    const pix = reason ? 0 : pixDiscountCents(subtotal, offer.percentage);
    const discount = fixedDiscount + pix;
    const shipping = checkoutCents(order.shipping_cost);
    return { subtotal: subtotal / 100, discount: discount / 100, shipping_cost: shipping / 100,
        total: (subtotal - discount + shipping) / 100,
        discount_breakdown: breakdown ? { ...breakdown, pix: pix / 100 } : undefined,
        pix_discount_percentage: offer.percentage, pix_discount_reason: reason };
}

export async function changeOrderPaymentMethod(orderId, user, body, key, {
    transaction = withTransaction, provider = mp, env = process.env, preview = false,
} = {}) {
    const method = body?.payment_method;
    if (!['credito', 'debito', 'pix'].includes(method)) throw fail('Forma de pagamento inválida.', 400);
    const requestKey = preview ? null : normalizeIdempotencyKey(key);
    return transaction(async client => {
        // Same lock namespace as Pix/card creation. Then row lock protects cancel.
        await client.query(`SELECT pg_advisory_xact_lock(${orderAttemptLockSql})`, [orderId]);
        const { rows } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
        const order = rows[0];
        if (!order || (order.user_id !== user.id && user.role !== 'admin')) throw fail('Pedido não encontrado.', 404);
        const previous = order.snapshot?.payment_method_changes || [];
        const repeated = previous.find(change => change.key === requestKey);
        if (!preview && repeated) {
            if (repeated.method !== method) throw fail('Chave já utilizada para outro método.');
            return order;
        }
        if (!canChangePaymentMethod(order)) throw fail('Pagamento iniciado, existente ou em conciliação. A troca de método está bloqueada para evitar cobrança duplicada.');
        const { rows: settings } = await client.query("SELECT value FROM settings WHERE key = 'payments'");
        const config = settings[0]?.value || {};
        if (method === 'pix') {
            if (!getPixCapability(config, provider.getMercadoPagoReadiness()).enabled) throw fail('Pix indisponível.');
        } else {
            const type = method === 'credito' ? 'credit_card' : 'debit_card';
            const readiness = provider.getMercadoPagoReadiness();
            if (config.card_enabled === false || (method === 'debito' && config.debit_card_enabled === false)
                || !readiness.configured || !readiness.public_key_configured
                || !(await provider.getPaymentMethods()).some(item => item.payment_type_id === type)) throw fail('Método de cartão indisponível.');
        }
        const pricing = changedPaymentPricing(order, method, config, env);
        if (preview) return pricing;
        assertCheckoutPriceAcknowledged(body.expected_pricing, pricing, true);
        if (previous.length >= 50) throw fail('Limite de alterações alcançado. Entre em contato com o atendimento.');
        const snapshot = { ...order.snapshot, ...pricing, payment_method: method,
            payment_method_changes: [...previous, { key: requestKey, method, from: order.payment_method }] };
        const { rows: updated } = await client.query(
            `UPDATE orders SET payment_method = $1, discount = $2, total = $3, snapshot = $4,
                installments = NULL, updated_at = now() WHERE id = $5 RETURNING *`,
            [method, pricing.discount, pricing.total, JSON.stringify(snapshot), orderId]);
        await client.query("INSERT INTO order_events (order_id, event, description) VALUES ($1, 'payment_method_changed', $2)",
            [orderId, `Forma de pagamento alterada: ${order.payment_method} → ${method}`]);
        return updated[0];
    });
}
