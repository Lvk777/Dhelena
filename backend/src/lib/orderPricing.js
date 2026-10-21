import { effectiveSizes, stockForSize } from './variantStock.js';
import { checkoutCents } from './checkoutDiscount.js';

function invalid(message, status = 400) {
    return Object.assign(new Error(message), { status });
}

export function resolveCatalogLine(product, { colorId, size, qty }) {
    if (product?.status !== 'published') throw invalid('Produto indisponível', 409);
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

    const catalogPrice = Number(product.sale_price || product.price);
    if (!Number.isFinite(catalogPrice) || catalogPrice < 0) throw invalid('Preço de catálogo inválido', 500);
    const unitPrice = checkoutCents(catalogPrice) / 100;
    const lineCents = checkoutCents(unitPrice) * quantity;
    if (!Number.isSafeInteger(lineCents)) throw invalid('Preço de catálogo inválido', 500);
    return { color, currentStock, quantity, unitPrice, itemSubtotal: lineCents / 100 };
}

export function calculateServerOrderTotal(subtotal, discount, shippingCost) {
    const values = [subtotal, discount, shippingCost].map(Number);
    if (values.some(value => !Number.isFinite(value) || value < 0)) throw invalid('Totais do pedido inválidos', 500);
    const cents = checkoutCents(subtotal) - checkoutCents(discount) + checkoutCents(shippingCost);
    if (!Number.isSafeInteger(cents) || cents < 0) throw invalid('Totais do pedido inválidos', 500);
    return cents / 100;
}

export function calculateCheckoutShippingCost(quotePrice, subtotal, discount, freeEnabled, freeThreshold) {
    const values = [quotePrice, subtotal, discount].map(Number);
    if (values.some(value => !Number.isFinite(value) || value < 0)) throw invalid('Cotação ou subtotal inválido');
    const threshold = Number(freeThreshold);
    return freeEnabled === true && Number.isFinite(threshold) && threshold > 0
        && checkoutCents(subtotal) - checkoutCents(discount) >= checkoutCents(threshold) ? 0 : checkoutCents(quotePrice) / 100;
}
