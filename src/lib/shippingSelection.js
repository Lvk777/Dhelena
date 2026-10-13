export function shippingContextKey(cep, cart, couponCode = '') {
    const digits = String(cep || '').replace(/\D/g, '');
    return JSON.stringify([digits, cart.map(({ productId, colorId, size, qty }) =>
        [productId, colorId, size, qty]), couponCode]);
}

export function selectedDelivery(selection, contextKey, pickupEnabled = true) {
    if (!selection) return null;
    if (selection.method === 'retirada') return pickupEnabled === true ? selection : null;
    if (selection.method !== 'melhor_envio' || selection.contextKey !== contextKey
        || !selection.quoteId || !Number.isFinite(Number(selection.cost)) || Number(selection.cost) < 0) return null;
    const [cep] = JSON.parse(contextKey);
    return cep.length === 8 ? selection : null;
}

export function selectedDeliveryCost(selection, contextKey, freeShipping, pickupEnabled = true) {
    const current = selectedDelivery(selection, contextKey, pickupEnabled);
    if (!current) return null;
    return current.method === 'retirada' || freeShipping ? 0 : Number(current.cost);
}
