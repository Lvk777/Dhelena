export function afterSalesError(message, status = 409) {
    return Object.assign(new Error(message), { status });
}

export function moneyCents(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw afterSalesError('Valor monetário inválido', 400);
    return Math.round(number * 100);
}

export function canCancelWithoutRefund(order) {
    return !['enviado', 'em_transporte', 'saiu_entrega', 'entregue'].includes(order.status)
        && !order.melhor_envio_shipment_id
        && !order.tracking_code
        && !order.mercado_pago_order_id
        && !order.mercado_pago_payment_id
        && !order.payment_attempt_started_at
        && order.payment_status !== 'approved';
}

export function canCancelAfterRefund(order, refundedCents) {
    return !['enviado', 'em_transporte', 'saiu_entrega', 'entregue'].includes(order.status)
        && !order.melhor_envio_shipment_id
        && !order.tracking_code
        && order.payment_status === 'refunded'
        && refundedCents === moneyCents(order.total);
}

export function assertRefundableOrder(order, provider, refundedCents = 0) {
    if (order.status === 'cancelado' || !order.mercado_pago_order_id || !order.mercado_pago_payment_id
        || order.payment_provider !== 'mercado_pago' || !order.paid_at) {
        throw afterSalesError('Pedido incompatível com reembolso');
    }
    if (provider.id !== order.mercado_pago_order_id
        || provider.external_reference !== order.order_number
        || String(provider.payment?.id) !== String(order.mercado_pago_payment_id)
        || provider.currency !== 'BRL'
        || moneyCents(provider.total_amount) !== moneyCents(order.total)
        || !['approved', 'processed', 'partially_refunded', 'refunded'].includes(provider.payment?.status)) {
        throw afterSalesError('Dados do pagamento não correspondem ao pedido');
    }
    if (refundedCents > moneyCents(order.total)) throw afterSalesError('Reembolsos excedem o valor pago');
}

export function calculateItemRefundCents(order, orderItems, selectedItems, alreadyRefunded = []) {
    if (!Array.isArray(selectedItems) || selectedItems.length === 0) {
        throw afterSalesError('Itens do reembolso parcial são obrigatórios', 400);
    }
    const prior = new Map();
    for (const entry of alreadyRefunded) {
        for (const item of entry || []) prior.set(item.order_item_id, (prior.get(item.order_item_id) || 0) + item.quantity);
    }
    const seen = new Set();
    let amount = 0;
    for (const selection of selectedItems) {
        const item = orderItems.find(row => row.id === selection.order_item_id);
        if (!item || seen.has(selection.order_item_id) || !Number.isInteger(selection.quantity)
            || selection.quantity < 1 || selection.quantity > item.quantity - (prior.get(item.id) || 0)) {
            throw afterSalesError('Itens ou quantidades incompatíveis com o pedido', 400);
        }
        seen.add(item.id);
        const gross = moneyCents(item.unit_price) * selection.quantity;
        const subtotal = moneyCents(order.subtotal);
        const discount = moneyCents(order.discount || 0);
        if (!subtotal || discount > subtotal) throw afterSalesError('Base de cálculo do pedido inválida');
        amount += Math.round(gross * (subtotal - discount) / subtotal);
    }
    if (amount < 1) throw afterSalesError('Valor parcial calculado inválido', 400);
    return amount;
}

export function findIdempotentRefund(ledger, key, kind, reason, selected, returnId) {
    const previous = ledger.find(row => row.idempotency_key === key);
    if (!previous) return null;
    if (previous.kind !== kind || previous.reason !== reason || previous.return_id !== returnId
        || JSON.stringify(previous.selected_items || []) !== JSON.stringify(selected)) {
        throw afterSalesError('Chave de idempotência usada para outra solicitação');
    }
    return previous;
}

export function planRefund(order, provider, ledger, kind, selected, orderItems) {
    if (ledger.some(row => ['reserved', 'processing', 'reconciliation_required'].includes(row.status))) {
        throw afterSalesError('Existe reembolso pendente de conciliação');
    }
    const refunded = ledger.filter(row => row.status === 'processed')
        .reduce((sum, row) => sum + moneyCents(row.amount), 0);
    assertRefundableOrder(order, provider, refunded);
    const remaining = moneyCents(order.total) - refunded;
    if (remaining < 1) throw afterSalesError('Pedido já totalmente reembolsado');
    if (kind === 'full') {
        if (refunded > 0) throw afterSalesError('Após reembolso parcial, use saldo restante ou outra operação parcial');
        return remaining;
    }
    if (kind === 'remaining') {
        if (refunded === 0) throw afterSalesError('Use reembolso total quando ainda não há parciais');
        return remaining;
    }
    if (kind !== 'partial') throw afterSalesError('Tipo de reembolso inválido', 400);
    const amount = calculateItemRefundCents(order, orderItems, selected,
        ledger.filter(row => row.status === 'processed').map(row => row.selected_items));
    if (amount > remaining) throw afterSalesError('Valor acima do pagamento disponível');
    return amount;
}

export function nextReturnStatus(current, desired) {
    const allowed = {
        solicitada: ['autorizada', 'recusada', 'cancelada'],
        autorizada: ['aguardando_postagem', 'recebida', 'cancelada'],
        aguardando_postagem: ['em_transito_retorno', 'recebida', 'cancelada'],
        em_transito_retorno: ['recebida'],
        recebida: ['reembolso_processado'],
        reembolso_processado: [], recusada: [], cancelada: [],
    };
    if (current === desired) return false;
    if (!allowed[current]?.includes(desired)) throw afterSalesError('Transição de devolução inválida');
    return true;
}

export function shouldApplyProviderPayment(order, internalStatus, refundInFlight = false) {
    if (refundInFlight) return false;
    if (internalStatus === 'refunded' || internalStatus === 'partially_refunded') return false;
    if (order.status === 'cancelado' || order.payment_status === 'refunded') return false;
    if (order.payment_status === 'partially_refunded' && internalStatus === 'approved') return false;
    return true;
}

export function assertFulfillmentTransition(order, nextStatus) {
    if (!nextStatus || nextStatus === order.status) return;
    const allowed = {
        pagamento_aprovado: ['em_separacao'],
        em_separacao: ['enviado'],
        enviado: ['em_transporte', 'entregue'],
        em_transporte: ['saiu_entrega', 'entregue'],
        saiu_entrega: ['entregue'],
    };
    if (!allowed[order.status]?.includes(nextStatus)) {
        throw afterSalesError('Transição de expedição inválida');
    }
}
