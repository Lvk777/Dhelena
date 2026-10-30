import { withTransaction } from './config/db.js';
import { cancelOrderInTransaction } from './orderService.js';
import { canCancelWithoutRefund } from './lib/afterSalesPolicy.js';
import { orderAttemptLockSql } from './lib/orderAttemptLock.js';
import { findTestOrdersByReference, getMercadoPagoMode } from './services/mercadoPago.js';

const conflict = message => Object.assign(new Error(message), { status: 409 });

export function assertFailedPixAttempt(order) {
    if (order.status === 'cancelado' || order.payment_status !== 'pending'
        || !order.payment_attempt_started_at || order.payment_attempt_method !== 'pix'
        || order.mercado_pago_order_id || order.mercado_pago_payment_id || order.paid_at
        || !canCancelWithoutRefund({ ...order, payment_attempt_started_at: null })) {
        throw conflict('Pedido incompatível com resolução da tentativa Pix; exige conciliação');
    }
    // A recently reserved marker can still represent an in-flight provider request.
    const attemptAge = Date.now() - new Date(order.payment_attempt_started_at).getTime();
    if (!Number.isFinite(attemptAge) || attemptAge < 15 * 60 * 1000) {
        throw conflict('Tentativa Pix recente ou sem data válida; aguarde a conciliação');
    }
}

export async function resolveFailedPixAttemptInTransaction(client, orderId, actorId, provider = {
    findTestOrdersByReference, getMercadoPagoMode,
}) {
    // This is acquired before the row lock, matching the Pix creation lock order.
    await client.query(`SELECT pg_advisory_xact_lock(${orderAttemptLockSql})`, [orderId]);
    const { rows } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (!rows.length) throw Object.assign(new Error('Pedido não encontrado'), { status: 404 });
    const order = rows[0];
    if (order.status === 'cancelado') {
        const { rows: resolution } = await client.query(
            `SELECT 1 FROM order_events WHERE order_id = $1 AND event = 'payment_attempt_resolved' LIMIT 1`,
            [orderId]);
        if (resolution.length) return { outcome: 'already_resolved', order };
        throw conflict('Pedido cancelado sem resolução desta tentativa Pix');
    }
    assertFailedPixAttempt(order);
    if (provider.getMercadoPagoMode() !== 'test') throw conflict('Resolução disponível somente no modo TEST');
    const providerOrders = await provider.findTestOrdersByReference(order.order_number, order.created_at);
    if (!Array.isArray(providerOrders)) throw conflict('Consulta ao provedor inconclusiva');
    if (providerOrders.length) throw conflict('Order encontrada no provedor; pedido exige conciliação');

    const metadata = {
        reason: 'provider_order_not_found', payment_method: 'pix', provider_lookup_count: 0,
        attempt_started_at: order.payment_attempt_started_at,
        resolved_at: new Date().toISOString(),
    };
    await client.query(
        `INSERT INTO order_events (order_id, event, description, metadata)
         VALUES ($1, 'payment_attempt_resolved', 'Tentativa Pix encerrada após consulta sem Order no provedor', $2)`,
        [orderId, JSON.stringify(metadata)]);
    await client.query(
        `INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, changes)
         VALUES ($1, 'payment_attempt_resolved', 'order', $2, $3)`,
        [actorId, orderId, JSON.stringify(metadata)]);
    const cancelled = await cancelOrderInTransaction(client, order, actorId, true);
    return { outcome: 'resolved_and_cancelled', order: cancelled };
}

export function resolveFailedPixAttempt(orderId, actorId) {
    return withTransaction(client => resolveFailedPixAttemptInTransaction(client, orderId, actorId));
}
