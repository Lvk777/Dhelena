function invalid(message, status = 400) {
    return Object.assign(new Error(message), { status });
}

export function resolveCatalogLine(product, { colorId, size, qty }) {
    const quantity = Number.parseInt(qty, 10);
    if (!Number.isInteger(quantity) || quantity <= 0) throw invalid('Quantidade inválida');

    const color = (product.colors || []).find(candidate => candidate.id === colorId);
    if (!color) throw invalid(`Cor não encontrada: ${colorId}`, 404);

    const currentStock = Number(color.stock?.[size] ?? 0);
    if (currentStock < quantity) {
        throw invalid(`Estoque insuficiente para ${product.name} (${color.name}, ${size}). Disponível: ${currentStock}`, 409);
    }

    const unitPrice = Number(product.sale_price || product.price);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw invalid('Preço de catálogo inválido', 500);
    return { color, currentStock, quantity, unitPrice, itemSubtotal: unitPrice * quantity };
}

export function calculateServerOrderTotal(subtotal, discount, shippingCost) {
    const values = [subtotal, discount, shippingCost].map(Number);
    if (values.some(value => !Number.isFinite(value) || value < 0)) throw invalid('Totais do pedido inválidos', 500);
    return Number((values[0] - values[1] + values[2]).toFixed(2));
}
