function invalid(message) {
    return Object.assign(new Error(message), { status: 400 });
}

// Melhor Envio's Correios PAC/SEDEX limits are for the CLOSED parcel, in cm/kg.
export function assertCorreiosPackage(packageData) {
    const { height, width, length, weight } = packageData || {};
    const values = [height, width, length, weight].map(Number);
    if (values.some(value => !Number.isFinite(value) || value <= 0)) {
        throw invalid('Informe peso (kg) e dimensões (cm) reais da embalagem fechada.');
    }
    if (values[0] < 1 || values[1] < 8 || values[2] < 13 ||
        values.slice(0, 3).some(value => value > 100) ||
        values[0] + values[1] + values[2] > 200 || values[3] > 30) {
        throw invalid('Embalagem fora dos limites PAC/SEDEX: mínimo 1 × 8 × 13 cm; máximo 100 cm por lado, 200 cm na soma e 30 kg. Confira o pacote fechado.');
    }
    return { height: values[0], width: values[1], length: values[2], weight: values[3] };
}

export function fiscalKeyModel(value) {
    const key = String(value || '').replace(/\D/g, '');
    if (key.length !== 44) return null;
    const digits = key.slice(0, 43).split('').map(Number);
    const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 8 + 2), 0);
    const remainder = sum % 11;
    const check = remainder < 2 ? 0 : 11 - remainder;
    return check === Number(key[43]) ? key.slice(20, 22) : null;
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
    if (order?.status === 'cancelado' || Number(order?.refunded_amount) > 0) {
        throw Object.assign(new Error('Pedido cancelado ou reembolsado não aceita etiqueta'), { status: 409 });
    }
    if (order?.payment_status !== 'approved') {
        throw Object.assign(new Error('Pagamento não confirmado. Gere a etiqueta apenas após o pagamento ser aprovado.'), { status: 400 });
    }
    if (order.shipping_method !== 'melhor_envio') {
        throw Object.assign(new Error('Pedido não utiliza o Melhor Envio'), { status: 409 });
    }
    return order;
}

export function safeShippingPrintUrl(value) {
    try {
        const url=new URL(value);
        if(url.protocol!=='https:'||url.username||url.password||url.port
            || !['melhorenvio.com.br','www.melhorenvio.com.br','sandbox.melhorenvio.com.br'].includes(url.hostname))return null;
        return url.href;
    }catch{return null;}
}
