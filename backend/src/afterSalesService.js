import { pool, withTransaction } from './config/db.js';
import * as mp from './services/mercadoPago.js';
import {
    afterSalesError, assertRefundableOrder, canCancelAfterRefund,
    findIdempotentRefund, moneyCents, nextReturnStatus, planRefund,
} from './lib/afterSalesPolicy.js';
import { isAuthorizedTestOrder, isAuthorizedTestRefund } from './lib/testRefundScope.js';
import { isRefundPhysicalBaseline, loadRefundPhysicalState } from './lib/refundPhysicalState.js';

const queryOne = async (client, sql, values) => (await client.query(sql, values)).rows[0];
const processedAmount = rows => rows.filter(row => row.status === 'processed')
    .reduce((sum, row) => sum + moneyCents(row.amount), 0);

function compareRefundLedger(provider, ledger) {
    const recorded = ledger.filter(row => row.status === 'processed');
    for (const row of recorded) {
        const match = provider.refunds.find(refund => refund.id === row.provider_refund_id);
        if (!match || row.provider_order_id !== provider.id
            || match.transaction_id !== row.provider_payment_id
            || moneyCents(match.amount) !== moneyCents(row.amount)
            || match.status !== 'processed') {
            throw afterSalesError('Reembolsos do provedor exigem conciliação manual');
        }
    }
    if (provider.refunds.length !== recorded.length) {
        throw afterSalesError('Há reembolso no provedor não conciliado localmente');
    }
}

function matchNewProviderRefund(provider, ledger, amountCents, paymentId) {
    const known = new Set(ledger.map(row => row.provider_refund_id).filter(Boolean));
    const matches = provider.refunds.filter(refund => !known.has(refund.id)
        && String(refund.transaction_id) === String(paymentId)
        && moneyCents(refund.amount) === amountCents);
    if (matches.length !== 1 || !matches[0].id) {
        throw afterSalesError('Reembolso não identificável no provedor; conciliação necessária');
    }
    return matches[0];
}

async function recordRefundOutcome(refundId, provider, existingLedger, transaction = withTransaction) {
    return transaction(async client => {
        const row = await queryOne(client, 'SELECT * FROM order_refunds WHERE id = $1 FOR UPDATE', [refundId]);
        if (!row) throw afterSalesError('Reembolso não encontrado', 404);
        if (row.status === 'processed') return row;
        const order = await queryOne(client, 'SELECT * FROM orders WHERE id = $1 FOR UPDATE', [row.order_id]);
        assertRefundableOrder(order, provider, processedAmount(existingLedger));
        const recorded = existingLedger.filter(entry => entry.status === 'processed');
        for (const prior of recorded) {
            const match = provider.refunds.find(refund => refund.id === prior.provider_refund_id);
            if (!match || String(match.transaction_id) !== String(prior.provider_payment_id)
                || match.status !== 'processed' || moneyCents(match.amount) !== moneyCents(prior.amount)) {
                throw afterSalesError('Histórico de reembolsos diverge do Mercado Pago');
            }
        }
        if (provider.refunds.length !== existingLedger.filter(entry => entry.status === 'processed').length + 1) {
            throw afterSalesError('Há reembolsos adicionais no provedor; conciliação necessária');
        }
        const matched = matchNewProviderRefund(provider, existingLedger, moneyCents(row.amount), row.provider_payment_id);
        if (processedAmount(existingLedger) + moneyCents(matched.amount) > moneyCents(order.total)) {
            throw afterSalesError('Reembolso acumulado excede o pagamento');
        }
        if (!['processed', 'processing', 'pending'].includes(matched.status)) {
            throw afterSalesError('Status de reembolso no provedor exige conciliação');
        }
        const status = matched.status === 'processed' ? 'processed' : 'processing';
        const updated = await queryOne(client,
            `UPDATE order_refunds SET status = $1, provider_refund_id = $2, provider_status = $3,
                processed_at = CASE WHEN $1 = 'processed' THEN now() ELSE processed_at END,
                updated_at = now() WHERE id = $4 RETURNING *`,
            [status, matched.id, matched.status, row.id]);
        if (status === 'processed') {
            const current = await client.query(
                "SELECT amount FROM order_refunds WHERE order_id = $1 AND status = 'processed'", [order.id]);
            const cents = current.rows.reduce((sum, entry) => sum + moneyCents(entry.amount), 0);
            if (cents > moneyCents(order.total)) throw afterSalesError('Reembolso acumulado excede o pagamento');
            const paymentStatus = cents === moneyCents(order.total) ? 'refunded' : 'partially_refunded';
            await client.query('UPDATE orders SET payment_status = $1, payment_updated_at = now(), updated_at = now() WHERE id = $2',
                [paymentStatus, order.id]);
            await client.query(
                `INSERT INTO order_events (order_id, event, description, metadata)
                 VALUES ($1, 'refund_processed', 'Reembolso confirmado no Mercado Pago', $2)`,
                [order.id, JSON.stringify({ refund_id: matched.id, amount: row.amount, actor_id: row.actor_id })]);
            await client.query(
                `INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, changes)
                 VALUES ($1, 'refund.processed', 'order', $2, $3)`,
                [row.actor_id, order.id, JSON.stringify({ refund_id: matched.id, amount: row.amount, reason: row.reason })]);
        }
        return updated;
    });
}

export async function requestRefund(orderId, actorId, request, idempotencyKey, provider = mp,
    { db = pool, transaction = withTransaction } = {}) {
    if (process.env.AFTER_SALES_REFUNDS_ENABLED !== 'true') {
        throw afterSalesError('Reembolsos desabilitados até validação operacional', 503);
    }
    if (mp.getMercadoPagoMode() !== 'test') {
        throw afterSalesError('Reembolso financeiro permitido somente no Mercado Pago TEST', 409);
    }
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey || '')) {
        throw afterSalesError('X-Idempotency-Key inválida', 400);
    }
    const kind = request?.kind;
    const reason = String(request?.reason || '').trim();
    if (!['full', 'partial', 'remaining'].includes(kind) || reason.length < 5 || reason.length > 500) {
        throw afterSalesError('Tipo ou motivo inválido', 400);
    }
    if (kind !== 'remaining' || Object.keys(request).some(key => !['kind', 'reason'].includes(key))) {
        throw afterSalesError('Esta liberação TEST aceita somente saldo restante calculado no servidor', 409);
    }
    const selected = [];
    const explicitCents = undefined;
    const returnId = null;
    // This GET is read-only; it cannot trigger a refund.
    const localOrder = await queryOne(db, 'SELECT * FROM orders WHERE id = $1', [orderId]);
    if (!localOrder) throw afterSalesError('Pedido não encontrado', 404);
    if (!isAuthorizedTestOrder(localOrder)) {
        throw afterSalesError('Pedido fora da liberação TEST do saldo restante', 409);
    }
    const reservation = await transaction(async client => {
        const order = await queryOne(client, 'SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
        const ledger = (await client.query('SELECT * FROM order_refunds WHERE order_id = $1 ORDER BY created_at FOR UPDATE', [orderId])).rows;
        const previous = findIdempotentRefund(ledger, idempotencyKey, kind, reason, selected, returnId, explicitCents);
        if (previous) {
            return { previous };
        }
        const providerOrder = await provider.getRefundableOrder(order.mercado_pago_order_id);
        assertRefundableOrder(order, providerOrder, processedAmount(ledger));
        compareRefundLedger(providerOrder, ledger);
        const paid = moneyCents(order.total);
        const alreadyRefunded = processedAmount(ledger);
        const remaining = paid - alreadyRefunded;
        if (!isAuthorizedTestRefund(order, kind, paid, alreadyRefunded, remaining, ledger.length)) {
            throw afterSalesError('Saldo ou histórico divergiu da liberação TEST', 409);
        }
        if (!isRefundPhysicalBaseline(await loadRefundPhysicalState(client, orderId))) {
            throw afterSalesError('Estado físico divergiu da liberação TEST', 409);
        }
        const amount = planRefund(order, providerOrder, ledger, kind, selected, [], explicitCents);
        const saved = await queryOne(client,
            `INSERT INTO order_refunds
             (order_id, idempotency_key, kind, amount, status, provider_order_id,
              provider_payment_id, reason, actor_id, selected_items, return_id)
             VALUES ($1, $2, $3, $4, 'reserved', $5, $6, $7, $8, $9, $10) RETURNING *`,
            [orderId, idempotencyKey, kind, (amount / 100).toFixed(2), order.mercado_pago_order_id,
                order.mercado_pago_payment_id, reason, actorId, JSON.stringify(selected), returnId]);
        await client.query(
            `INSERT INTO order_events (order_id, event, description, metadata)
             VALUES ($1, 'refund_requested', 'Reembolso reservado para envio ao Mercado Pago', $2)`,
            [orderId, JSON.stringify({ refund_request_id: saved.id, amount: saved.amount, actor_id: actorId })]);
        return { saved, ledger, amount };
    });
    if (reservation.previous) return reservation.previous; // Never replay a POST automatically.

    try {
        const result = await provider.refundOrder({
            mpOrderId: reservation.saved.provider_order_id,
            mpPaymentId: reservation.saved.provider_payment_id,
            amount: reservation.amount,
            full: kind === 'full', idempotencyKey: `refund-${reservation.saved.id}`,
        });
        if (result.id !== reservation.saved.provider_order_id) {
            throw afterSalesError('Resposta de reembolso pertence a outra order');
        }
        const refreshed = await provider.getRefundableOrder(reservation.saved.provider_order_id);
        return await recordRefundOutcome(reservation.saved.id, refreshed, reservation.ledger, transaction);
    } catch (error) {
        // A timeout or provider error may still have effected the refund. Never replay here.
        await db.query(
            `UPDATE order_refunds SET status = 'reconciliation_required', updated_at = now()
             WHERE id = $1 AND status = 'reserved'`, [reservation.saved.id]);
        throw afterSalesError('Resultado do Mercado Pago exige conciliação; não repita o reembolso', 503);
    }
}

export async function reconcileRefund(refundId, actorId, provider = mp) {
    const row = await queryOne(pool, 'SELECT * FROM order_refunds WHERE id = $1', [refundId]);
    if (!row) throw afterSalesError('Reembolso não encontrado', 404);
    if (row.status === 'processed') return row;
    const providerOrder = await provider.getRefundableOrder(row.provider_order_id);
    const ledger = (await pool.query('SELECT * FROM order_refunds WHERE order_id = $1 AND id <> $2',
        [row.order_id, row.id])).rows;
    const updated = await recordRefundOutcome(refundId, providerOrder, ledger);
    await pool.query(`INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, changes)
        VALUES ($1, 'refund.reconcile', 'order', $2, $3)`,
    [actorId, row.order_id, JSON.stringify({ refund_request_id: refundId, status: updated.status })]);
    return updated;
}

/** Webhook uses only a fresh official Orders API read; body values are ignored. */
export async function reconcileRefundFromWebhook(orderId, expectedProviderOrderId, provider = mp,
    db = pool, transaction = withTransaction) {
    const pending = (await db.query(
        `SELECT * FROM order_refunds WHERE order_id = $1
         AND status IN ('reserved', 'processing', 'reconciliation_required') ORDER BY created_at`, [orderId])).rows;
    if (!pending.length) return null;
    if (pending.length !== 1 || pending[0].provider_order_id !== expectedProviderOrderId) {
        throw afterSalesError('Reembolso do webhook exige conciliação manual');
    }
    const official = await provider.getRefundableOrder(expectedProviderOrderId);
    const ledger = (await db.query('SELECT * FROM order_refunds WHERE order_id = $1 AND id <> $2',
        [orderId, pending[0].id])).rows;
    if (official.refunds.length === ledger.filter(row => row.status === 'processed').length) {
        const order = await queryOne(db, 'SELECT * FROM orders WHERE id = $1', [orderId]);
        assertRefundableOrder(order, official, processedAmount(ledger));
        compareRefundLedger(official, ledger);
        return pending[0];
    }
    return recordRefundOutcome(pending[0].id, official, ledger, transaction);
}

export async function restoreStock(client, order, item, quantity, source, returnItemId = null, actorId = null) {
    const restored = await queryOne(client,
        `INSERT INTO stock_restorations (order_id, order_item_id, return_item_id, source, quantity)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING id`,
        [order.id, item.id, returnItemId, source, quantity]);
    if (!restored) return false;
    const priorRestored = await queryOne(client,
        `SELECT COALESCE(SUM(quantity), 0)::integer AS quantity FROM stock_restorations
         WHERE order_item_id = $1 AND id <> $2`, [item.id, restored.id]);
    if (priorRestored.quantity + quantity > item.quantity) {
        throw afterSalesError('Reposição excede quantidade comprada');
    }
    const product = await queryOne(client, 'SELECT colors FROM products WHERE id = $1 FOR UPDATE', [item.product_id]);
    if (!product) throw afterSalesError('Produto ausente; estoque exige reconciliação');
    const colors = product.colors || [];
    const color = colors.find(value => value.id === item.color_id);
    if (!color) throw afterSalesError('Variação ausente; estoque exige reconciliação');
    const prior = Number(color.stock?.[item.size] || 0);
    color.stock ||= {};
    color.stock[item.size] = prior + quantity;
    await client.query(
        'UPDATE products SET colors = $1, sold_count = GREATEST(0, sold_count - $2), updated_date = now() WHERE id = $3',
        [JSON.stringify(colors), quantity, item.product_id]);
    await client.query(
        `INSERT INTO stock_movements
         (product_id, order_id, type, quantity, color_id, size, previous_stock, new_stock, reason, admin_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [item.product_id, order.id, source === 'return' ? 'return' : 'cancel', quantity,
            item.color_id, item.size, prior, prior + quantity, source, actorId]);
    return true;
}

export async function cancelPaidOrder(orderId, actorId) {
    return withTransaction(async client => {
        const order = await queryOne(client, 'SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
        if (!order) throw afterSalesError('Pedido não encontrado', 404);
        if (order.order_number === 'DH-2026-000006') throw afterSalesError('Pedido de homologação encerrado');
        if (order.status === 'cancelado') return order;
        const refunds = (await client.query(
            "SELECT amount FROM order_refunds WHERE order_id = $1 AND status = 'processed'", [orderId])).rows;
        if (!canCancelAfterRefund(order, refunds.reduce((sum, row) => sum + moneyCents(row.amount), 0))) {
            throw afterSalesError('Cancelamento pago exige reembolso total confirmado e ausência de envio');
        }
        const items = (await client.query('SELECT * FROM order_items WHERE order_id = $1', [orderId])).rows;
        for (const item of items) await restoreStock(client, order, item, item.quantity, 'cancellation', null, actorId);
        const updated = await queryOne(client,
            "UPDATE orders SET status = 'cancelado', updated_at = now() WHERE id = $1 RETURNING *", [orderId]);
        await client.query(`INSERT INTO order_events (order_id, event, description)
            VALUES ($1, 'order_cancelled', 'Pedido cancelado após reembolso integral; estoque reposto')`, [orderId]);
        await client.query(`INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, changes)
            VALUES ($1, 'order.cancel_after_refund', 'order', $2, $3)`,
        [actorId, orderId, JSON.stringify({ previous_status: order.status })]);
        return updated;
    });
}

export async function cancelPendingProviderOrder(orderId, actorId, provider = mp) {
    if (process.env.AFTER_SALES_CANCELLATIONS_ENABLED !== 'true') {
        throw afterSalesError('Cancelamento no provedor desabilitado até validação operacional', 503);
    }
    return withTransaction(async client => {
        const order = await queryOne(client, 'SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
        if (!order) throw afterSalesError('Pedido não encontrado', 404);
        if (order.status === 'cancelado') return order;
        if (!order.mercado_pago_order_id || !['pending', 'rejected'].includes(order.payment_status)
            || ['enviado', 'em_transporte', 'saiu_entrega', 'entregue'].includes(order.status)
            || order.melhor_envio_shipment_id || order.tracking_code) {
            throw afterSalesError('Pedido não elegível a cancelamento de pagamento pendente');
        }
        let remote = await provider.getRefundableOrder(order.mercado_pago_order_id);
        const matches = value => value.id === order.mercado_pago_order_id
            && value.external_reference === order.order_number
            && moneyCents(value.total_amount) === moneyCents(order.total)
            && value.currency === 'BRL'
            && (!order.mercado_pago_payment_id
                || String(value.payment?.id) === String(order.mercado_pago_payment_id));
        if (!matches(remote)) throw afterSalesError('Order do provedor não corresponde ao pedido');
        if (['created', 'action_required'].includes(remote.status)) {
            const canceled = await provider.cancelPendingOrder(remote.id, `cancel-${order.id}`);
            if (canceled.id !== remote.id || canceled.external_reference !== order.order_number) {
                throw afterSalesError('Cancelamento retornou outra order');
            }
            remote = await provider.getRefundableOrder(remote.id);
            if (!matches(remote)) throw afterSalesError('Order cancelada não corresponde ao pedido');
        }
        if (!['canceled', 'cancelled', 'failed'].includes(remote.status)
            || ['approved', 'processed', 'refunded'].includes(remote.payment?.status)) {
            throw afterSalesError('Pagamento não foi confirmado como cancelado no provedor');
        }
        const items = (await client.query('SELECT * FROM order_items WHERE order_id = $1', [orderId])).rows;
        for (const item of items) await restoreStock(client, order, item, item.quantity, 'cancellation', null, actorId);
        const updated = await queryOne(client,
            `UPDATE orders SET status = 'cancelado', payment_status = 'rejected',
             mercado_pago_status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
            [remote.status, orderId]);
        await client.query(`INSERT INTO order_events (order_id, event, description, metadata)
            VALUES ($1, 'order_cancelled', 'Pagamento pendente cancelado no Mercado Pago; estoque reposto', $2)`,
        [orderId, JSON.stringify({ mp_status: remote.status, actor_id: actorId })]);
        await client.query(`INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, changes)
            VALUES ($1, 'order.cancel_pending_provider', 'order', $2, $3)`,
        [actorId, orderId, JSON.stringify({ previous_status: order.status, mp_status: remote.status })]);
        return updated;
    });
}

export async function createReturn(orderId, actorId, items, reason, transaction = withTransaction) {
    if (!Array.isArray(items) || !items.length || typeof reason !== 'string'
        || reason.trim().length < 5 || reason.trim().length > 500) {
        throw afterSalesError('Itens e motivo são obrigatórios', 400);
    }
    return transaction(async client => {
        const order = await queryOne(client, 'SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
        if (!order) throw afterSalesError('Pedido não encontrado', 404);
        if (order.order_number === 'DH-2026-000006') throw afterSalesError('Pedido de homologação encerrado');
        if (!['approved', 'partially_refunded', 'refunded'].includes(order.payment_status)
            || !['enviado', 'em_transporte', 'saiu_entrega', 'entregue'].includes(order.status)) {
            throw afterSalesError('Pedido não elegível à devolução física');
        }
        const purchased = (await client.query('SELECT * FROM order_items WHERE order_id = $1', [orderId])).rows;
        const existing = (await client.query(
            `SELECT ri.order_item_id, SUM(ri.quantity)::integer AS quantity FROM order_return_items ri
             JOIN order_returns r ON r.id = ri.return_id
             WHERE r.order_id = $1 AND r.status NOT IN ('recusada', 'cancelada')
             GROUP BY ri.order_item_id`, [orderId])).rows;
        const previous = new Map(existing.map(row => [row.order_item_id, row.quantity]));
        const seen = new Set();
        for (const selected of items) {
            const item = purchased.find(row => row.id === selected.order_item_id);
            if (!item || seen.has(item.id) || !Number.isInteger(selected.quantity) || selected.quantity < 1
                || selected.quantity > item.quantity - (previous.get(item.id) || 0)) {
                throw afterSalesError('Itens da devolução incompatíveis com o pedido', 400);
            }
            seen.add(item.id);
        }
        const created = await queryOne(client,
            `INSERT INTO order_returns (order_id, reason, requested_by) VALUES ($1, $2, $3) RETURNING *`,
            [orderId, reason.trim(), actorId]);
        for (const selected of items) {
            await client.query(
                `INSERT INTO order_return_items (return_id, order_item_id, quantity) VALUES ($1, $2, $3)`,
                [created.id, selected.order_item_id, selected.quantity]);
        }
        await client.query(`INSERT INTO order_events (order_id, event, description, metadata)
            VALUES ($1, 'return_solicitada', 'Devolução solicitada', $2)`,
        [orderId, JSON.stringify({ return_id: created.id, actor_id: actorId })]);
        return created;
    });
}

export async function advanceReturn(returnId, actorId, desired, restockable = {}, options = {},
    transaction = withTransaction) {
    return transaction(async client => {
        const pre = await queryOne(client, 'SELECT order_id FROM order_returns WHERE id = $1', [returnId]);
        if (!pre) throw afterSalesError('Devolução não encontrada', 404);
        if (options.expectedOrderId && pre.order_id !== options.expectedOrderId) {
            throw afterSalesError('Devolução não pertence ao pedido', 404);
        }
        const order = await queryOne(client, 'SELECT * FROM orders WHERE id = $1 FOR UPDATE', [pre.order_id]);
        if (!order) throw afterSalesError('Pedido não encontrado', 404);
        if (order.order_number === 'DH-2026-000006') throw afterSalesError('Pedido de homologação encerrado');
        const row = await queryOne(client, 'SELECT * FROM order_returns WHERE id = $1 FOR UPDATE', [returnId]);
        if (!nextReturnStatus(row.status, desired)) return row;
        for (const value of [options.postingInstructions, options.reverseTrackingCode, options.reversePostingCode]) {
            if (value !== undefined && value !== null && typeof value !== 'string') {
                throw afterSalesError('Dados de postagem inválidos', 400);
            }
        }
        const instructions = options.postingInstructions?.trim();
        const tracking = options.reverseTrackingCode?.trim();
        const postingCode = options.reversePostingCode?.trim();
        if (desired === 'aguardando_postagem' && (!instructions || instructions.length < 10 || instructions.length > 2000)) {
            throw afterSalesError('Informe instruções de postagem para a cliente', 400);
        }
        if (instructions && instructions.length > 2000 || tracking && tracking.length > 100
            || postingCode && postingCode.length > 100) {
            throw afterSalesError('Dados de postagem inválidos', 400);
        }
        if (desired === 'recebida') {
            const items = (await client.query(
                `SELECT ri.id AS return_item_id, ri.quantity AS return_quantity, oi.* FROM order_return_items ri
                 JOIN order_items oi ON oi.id = ri.order_item_id WHERE ri.return_id = $1`, [returnId])).rows;
            if (!restockable || typeof restockable !== 'object' || Array.isArray(restockable)
                || Object.keys(restockable).length !== items.length
                || items.some(item => typeof restockable[item.return_item_id] !== 'boolean'
                    || typeof options.conditionNotes?.[item.return_item_id] !== 'string'
                    || options.conditionNotes[item.return_item_id].trim().length < 3
                    || options.conditionNotes[item.return_item_id].trim().length > 500)) {
                throw afterSalesError('Classifique e descreva a condição de cada item recebido', 400);
            }
            for (const item of items) {
                await client.query('UPDATE order_return_items SET restockable = $1, condition_note = $2 WHERE id = $3',
                    [restockable[item.return_item_id], options.conditionNotes[item.return_item_id].trim(), item.return_item_id]);
                if (restockable[item.return_item_id]) {
                    await restoreStock(client, order, item, item.return_quantity, 'return', item.return_item_id, actorId);
                }
            }
        }
        const updated = await queryOne(client,
            `UPDATE order_returns SET status = $1, reviewed_by = $2,
             authorized_at = CASE WHEN $1 = 'autorizada' THEN now() ELSE authorized_at END,
             awaiting_post_at = CASE WHEN $1 = 'aguardando_postagem' THEN now() ELSE awaiting_post_at END,
             posted_at = CASE WHEN $1 = 'em_transito_retorno' THEN now() ELSE posted_at END,
             in_transit_at = CASE WHEN $1 = 'em_transito_retorno' THEN now() ELSE in_transit_at END,
             closed_at = CASE WHEN $1 IN ('recusada', 'cancelada') THEN now() ELSE closed_at END,
             posting_instructions = CASE WHEN $1 = 'aguardando_postagem' THEN $4 ELSE posting_instructions END,
             reverse_tracking_code = CASE WHEN $1 = 'em_transito_retorno' THEN $5 ELSE reverse_tracking_code END,
             reverse_posting_code = CASE WHEN $1 IN ('aguardando_postagem', 'em_transito_retorno')
                 THEN COALESCE($6, reverse_posting_code) ELSE reverse_posting_code END,
             received_by = CASE WHEN $1 = 'recebida' THEN $2 ELSE received_by END,
             received_at = CASE WHEN $1 = 'recebida' THEN now() ELSE received_at END,
             updated_at = now() WHERE id = $3 RETURNING *`,
            [desired, actorId, returnId, instructions || null, tracking || null, postingCode || null]);
        await client.query(`INSERT INTO order_events (order_id, event, description, metadata)
            VALUES ($1, $2, $3, $4)`, [order.id, `return_${desired}`, `Devolução: ${desired}`,
            JSON.stringify({ return_id: returnId, actor_id: actorId })]);
        await client.query(`INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, changes)
            VALUES ($1, 'return.transition', 'order', $2, $3)`,
        [actorId, order.id, JSON.stringify({ return_id: returnId, from: row.status, to: desired })]);
        return updated;
    });
}
