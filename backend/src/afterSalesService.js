import { pool, withTransaction } from './config/db.js';
import * as mp from './services/mercadoPago.js';
import {
    afterSalesError, assertRefundableOrder, canCancelAfterRefund,
    findIdempotentRefund, moneyCents, nextReturnStatus, planRefund,
} from './lib/afterSalesPolicy.js';

const queryOne = async (client, sql, values) => (await client.query(sql, values)).rows[0];
const normalizedSelections = (items) => Array.isArray(items)
    ? items.map(item => ({ order_item_id: item.order_item_id, quantity: item.quantity })) : [];
const processedAmount = rows => rows.filter(row => row.status === 'processed')
    .reduce((sum, row) => sum + moneyCents(row.amount), 0);

function compareRefundLedger(provider, ledger) {
    const recorded = ledger.filter(row => row.status === 'processed');
    for (const row of recorded) {
        const match = provider.refunds.find(refund => refund.id === row.provider_refund_id);
        if (!match || match.transaction_id !== row.provider_payment_id
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

async function recordRefundOutcome(refundId, provider, existingLedger) {
    return withTransaction(async client => {
        const row = await queryOne(client, 'SELECT * FROM order_refunds WHERE id = $1 FOR UPDATE', [refundId]);
        if (!row) throw afterSalesError('Reembolso não encontrado', 404);
        if (row.status === 'processed') return row;
        const order = await queryOne(client, 'SELECT * FROM orders WHERE id = $1 FOR UPDATE', [row.order_id]);
        assertRefundableOrder(order, provider, processedAmount(existingLedger));
        if (provider.refunds.length !== existingLedger.filter(entry => entry.status === 'processed').length + 1) {
            throw afterSalesError('Há reembolsos adicionais no provedor; conciliação necessária');
        }
        const matched = matchNewProviderRefund(provider, existingLedger, moneyCents(row.amount), row.provider_payment_id);
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

export async function requestRefund(orderId, actorId, request, idempotencyKey, provider = mp) {
    if (process.env.AFTER_SALES_REFUNDS_ENABLED !== 'true') {
        throw afterSalesError('Reembolsos desabilitados até validação operacional', 503);
    }
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey || '')) {
        throw afterSalesError('X-Idempotency-Key inválida', 400);
    }
    const kind = request?.kind;
    const reason = String(request?.reason || '').trim();
    if (!['full', 'partial', 'remaining'].includes(kind) || reason.length < 5 || reason.length > 500) {
        throw afterSalesError('Tipo ou motivo inválido', 400);
    }
    const selected = kind === 'partial' ? normalizedSelections(request.items) : [];
    const returnId = request?.return_id || null;
    // This GET is read-only; it cannot trigger a refund.
    const localOrder = await queryOne(pool, 'SELECT * FROM orders WHERE id = $1', [orderId]);
    if (!localOrder) throw afterSalesError('Pedido não encontrado', 404);
    if (!localOrder.mercado_pago_order_id) throw afterSalesError('Pedido sem order Mercado Pago');
    const providerOrder = await provider.getRefundableOrder(localOrder.mercado_pago_order_id);

    const reservation = await withTransaction(async client => {
        const order = await queryOne(client, 'SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
        const ledger = (await client.query('SELECT * FROM order_refunds WHERE order_id = $1 ORDER BY created_at FOR UPDATE', [orderId])).rows;
        const previous = findIdempotentRefund(ledger, idempotencyKey, kind, reason, selected, returnId);
        if (previous) {
            return { previous };
        }
        assertRefundableOrder(order, providerOrder, processedAmount(ledger));
        compareRefundLedger(providerOrder, ledger);
        if (returnId) {
            const associatedReturn = await queryOne(client,
                'SELECT * FROM order_returns WHERE id = $1 AND order_id = $2 FOR UPDATE', [returnId, orderId]);
            if (!associatedReturn || associatedReturn.status !== 'recebida') {
                throw afterSalesError('Devolução não recebida para este pedido');
            }
            if (kind === 'partial') {
                const returned = (await client.query(
                    'SELECT order_item_id, quantity FROM order_return_items WHERE return_id = $1', [returnId])).rows;
                if (selected.some(entry => !returned.some(item => item.order_item_id === entry.order_item_id
                    && entry.quantity <= item.quantity))) {
                    throw afterSalesError('Itens do reembolso não correspondem à devolução recebida');
                }
            }
        }
        const orderItems = kind === 'partial'
            ? (await client.query('SELECT * FROM order_items WHERE order_id = $1', [orderId])).rows : [];
        const amount = planRefund(order, providerOrder, ledger, kind, selected, orderItems);
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
        return await recordRefundOutcome(reservation.saved.id, refreshed, reservation.ledger);
    } catch (error) {
        // A timeout or provider error may still have effected the refund. Never replay here.
        await pool.query(
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

export async function createReturn(orderId, actorId, items, reason) {
    if (!Array.isArray(items) || !items.length || String(reason || '').trim().length < 5) {
        throw afterSalesError('Itens e motivo são obrigatórios', 400);
    }
    return withTransaction(async client => {
        const order = await queryOne(client, 'SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
        if (!order) throw afterSalesError('Pedido não encontrado', 404);
        if (!['approved', 'partially_refunded', 'refunded'].includes(order.payment_status)
            || order.status === 'cancelado') throw afterSalesError('Pedido não elegível à devolução');
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
            [orderId, String(reason).trim().slice(0, 500), actorId]);
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

export async function advanceReturn(returnId, actorId, desired, restockable = {}) {
    return withTransaction(async client => {
        const pre = await queryOne(client, 'SELECT order_id FROM order_returns WHERE id = $1', [returnId]);
        if (!pre) throw afterSalesError('Devolução não encontrada', 404);
        const order = await queryOne(client, 'SELECT * FROM orders WHERE id = $1 FOR UPDATE', [pre.order_id]);
        const row = await queryOne(client, 'SELECT * FROM order_returns WHERE id = $1 FOR UPDATE', [returnId]);
        if (!nextReturnStatus(row.status, desired)) return row;
        if (desired === 'reembolso_processado') {
            const processed = await queryOne(client,
                `SELECT EXISTS(SELECT 1 FROM order_refunds
                 WHERE order_id = $1 AND return_id = $2 AND status = 'processed') AS yes`,
                [order.id, returnId]);
            if (!processed.yes) throw afterSalesError('Nenhum reembolso confirmado para o pedido');
        }
        if (desired === 'recebida') {
            const items = (await client.query(
                `SELECT ri.id AS return_item_id, ri.quantity AS return_quantity, oi.* FROM order_return_items ri
                 JOIN order_items oi ON oi.id = ri.order_item_id WHERE ri.return_id = $1`, [returnId])).rows;
            if (Object.keys(restockable).length !== items.length
                || items.some(item => typeof restockable[item.return_item_id] !== 'boolean')) {
                throw afterSalesError('Admin deve classificar cada item recebido como revendável ou não', 400);
            }
            for (const item of items) {
                await client.query('UPDATE order_return_items SET restockable = $1 WHERE id = $2',
                    [restockable[item.return_item_id], item.return_item_id]);
                if (restockable[item.return_item_id]) {
                    await restoreStock(client, order, item, item.return_quantity, 'return', item.return_item_id, actorId);
                }
            }
        }
        const updated = await queryOne(client,
            `UPDATE order_returns SET status = $1, reviewed_by = $2,
             received_by = CASE WHEN $1 = 'recebida' THEN $2 ELSE received_by END,
             received_at = CASE WHEN $1 = 'recebida' THEN now() ELSE received_at END,
             updated_at = now() WHERE id = $3 RETURNING *`, [desired, actorId, returnId]);
        await client.query(`INSERT INTO order_events (order_id, event, description, metadata)
            VALUES ($1, $2, $3, $4)`, [order.id, `return_${desired}`, `Devolução: ${desired}`,
            JSON.stringify({ return_id: returnId, actor_id: actorId })]);
        await client.query(`INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, changes)
            VALUES ($1, 'return.transition', 'order', $2, $3)`,
        [actorId, order.id, JSON.stringify({ return_id: returnId, from: row.status, to: desired })]);
        return updated;
    });
}
