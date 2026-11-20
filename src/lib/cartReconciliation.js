import { stockFor } from '../data/products.js';

// Keep the stored cart intact until the customer removes unavailable entries.
// A temporary catalog load failure must never silently discard valid items.
export function reconcileCart(cart, products) {
    const byId = new Map(products.filter((product) => product.status === 'published')
        .map((product) => [product.id, product]));
    const lines = [];
    const unavailableItems = [];
    const invalidLines = [];

    for (const item of cart) {
        const product = byId.get(item.productId);
        if (!product) {
            unavailableItems.push(item);
            continue;
        }
        const line = { ...item, product };
        lines.push(line);
        if (!Number.isInteger(item.qty) || item.qty <= 0
            || stockFor(product, item.colorId, item.size) < item.qty) invalidLines.push(line);
    }
    return { lines, unavailableItems, invalidLines };
}
