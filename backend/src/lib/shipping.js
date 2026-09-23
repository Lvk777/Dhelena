function invalid(message) {
    return Object.assign(new Error(message), { status: 400 });
}

/** Melhor Envio expects a Brazilian DDD + number, without the optional +55. */
export function normalizeBrazilianPhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.startsWith('55') && [12, 13].includes(digits.length) ? digits.slice(2) : digits;
}

/** Build provider packages only from catalog records already read by the server. */
export function buildShippingPackages(items) {
    return items.map((item) => {
        const quantity = Number.parseInt(item.quantity ?? item.qty, 10);
        const dimensions = [item.weight, item.height, item.width, item.length].map(Number);
        const insuranceValue = Number(item.unit_price ?? item.insurance_value);
        if (!Number.isInteger(quantity) || quantity <= 0) throw invalid('Quantidade de item inválida');
        if (dimensions.some((value) => !Number.isFinite(value) || value <= 0)) {
            throw invalid(`Produto sem peso ou dimensões de envio: ${item.product_name || item.id || 'desconhecido'}`);
        }
        if (!Number.isFinite(insuranceValue) || insuranceValue < 0) throw invalid('Valor segurado do produto inválido');
        return { id: String(item.product_id || item.id), weight: dimensions[0], height: dimensions[1], width: dimensions[2], length: dimensions[3], insurance_value: insuranceValue, qty: quantity };
    });
}

/** Accept only a service returned by the provider during the server-side quote. */
export function selectShippingQuote(options, quoteId) {
    const quote = Array.isArray(options) && options.find((option) => String(option.id) === String(quoteId));
    if (!quote || !Number.isFinite(Number(quote.price)) || Number(quote.price) < 0) {
        throw Object.assign(new Error('A cotação de frete expirou ou não é válida para este pedido'), { status: 409 });
    }
    return quote;
}

/**
 * Whitelist the only checkout shipping fields a browser may influence. All
 * amounts, dimensions, service names and deadlines stay outside this object.
 */
export function getCheckoutShippingInput(body = {}) {
    return {
        shipping_method: body.shipping_method,
        shipping_quote_id: body.shipping_quote_id,
        shipping_address: body.shipping_address,
    };
}

/** A shipping label must use the quote persisted at checkout, never request input. */
export function getPersistedShippingService(order) {
    if (!order?.shipping_quote_id) {
        throw Object.assign(new Error('Pedido sem serviço de frete confirmado'), { status: 409 });
    }
    return String(order.shipping_quote_id);
}

export function assertLabelEligible(order) {
    if (order?.payment_status !== 'approved') {
        throw Object.assign(new Error('Pagamento não confirmado. Gere a etiqueta apenas após o pagamento ser aprovado.'), { status: 400 });
    }
    if (order.shipping_method !== 'melhor_envio') {
        throw Object.assign(new Error('Pedido não utiliza o Melhor Envio'), { status: 409 });
    }
    return order;
}
