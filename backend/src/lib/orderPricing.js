import { effectiveSizes, stockForSize } from './variantStock.js';

function invalid(message, status = 400) {
    return Object.assign(new Error(message), { status });
}

export function resolveCatalogLine(product, { colorId, size, qty }) {
    const quantity = Number(qty);
    if (!Number.isInteger(quantity) || quantity <= 0) throw invalid('Quantidade inválida');

    if (!effectiveSizes(product).includes(size)) throw invalid('Tamanho indisponível', 409);

    const color = (product.colors || []).find(candidate => candidate.id === colorId);
    if (!color) throw invalid(`Cor não encontrada: ${colorId}`, 404);

    const currentStock = stockForSize(product, color, size);
    if (!Number.isInteger(currentStock) || currentStock < 0) throw invalid('Estoque de catálogo inválido', 500);
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

export function calculateCheckoutShippingCost(quotePrice, subtotal, discount, freeEnabled) {
    const values = [quotePrice, subtotal, discount].map(Number);
    if (values.some(value => !Number.isFinite(value) || value < 0)) throw invalid('Cotação ou subtotal inválido');
    return freeEnabled && values[1] - values[2] >= 499 ? 0 : values[0];
}
