import { reserveVariantStock, restoreVariantStock } from './variantStock.js';

export const isDeferredStockOrder = order => order?.snapshot?.stock_model === 'deferred_sale_v1';
const conflict = message => Object.assign(new Error(message), { status: 409 });

async function itemsForOrder(client, orderId) {
    const { rows } = await client.query(
        'SELECT * FROM order_items WHERE order_id = $1 ORDER BY product_id, id', [orderId]);
    if (!rows.length) throw conflict('Pedido sem itens; estoque exige análise');
    return rows;
}

async function ledgerForOrder(client, orderId) {
    return (await client.query(
        'SELECT * FROM stock_reservations WHERE order_id = $1 ORDER BY product_id, order_item_id FOR UPDATE', [orderId])).rows;
}

function assertComplete(items, ledger, status) {
    if (ledger.length !== items.length || ledger.some((entry, index) =>
        entry.order_item_id !== items[index].id || entry.status !== status
        || entry.product_id !== items[index].product_id || entry.color_id !== items[index].color_id
        || entry.size !== items[index].size || Number(entry.quantity) !== Number(items[index].quantity))) {
        throw conflict('Reserva do pedido incompleta; exige conciliação');
    }
}

// Caller must already hold the order row lock. Product locks serialize the last unit.
export async function reserveOrderStockInTransaction(client, order) {
    if (!isDeferredStockOrder(order)) return false;
    const items = await itemsForOrder(client, order.id);
    const existing = await ledgerForOrder(client, order.id);
    if (existing.length) { assertComplete(items, existing, 'active'); return false; }
    let productId = null, product, colors;
    async function saveProduct() {
        if (productId) await client.query('UPDATE products SET colors = $1, updated_date = now() WHERE id = $2',
            [JSON.stringify(colors), productId]);
    }
    for (const item of items) {
        if (item.product_id !== productId) {
            await saveProduct();
            const { rows } = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [item.product_id]);
            product = rows[0]; productId = item.product_id;
            if (!product || product.status !== 'published') throw conflict('Produto indisponível');
            colors = product.colors || [];
        }
        const color = colors.find(value => value.id === item.color_id);
        if (!color) throw conflict('Variação indisponível');
        reserveVariantStock(product, color, item.size, Number(item.quantity));
        await client.query(
            `INSERT INTO stock_reservations
             (order_item_id, order_id, product_id, color_id, size, quantity, status)
             VALUES ($1,$2,$3,$4,$5,$6,'active')`,
            [item.id, order.id, item.product_id, item.color_id, item.size, item.quantity]);
    }
    await saveProduct();
    return true;
}

// Official approval only: the stock was removed from available at reservation.
export async function confirmOrderStockInTransaction(client, order) {
    if (!isDeferredStockOrder(order)) return false;
    const items = await itemsForOrder(client, order.id);
    const ledger = await ledgerForOrder(client, order.id);
    if (ledger.length && ledger.every(entry => entry.status === 'sold')) {
        assertComplete(items, ledger, 'sold'); return false;
    }
    assertComplete(items, ledger, 'active');
    const totals = new Map();
    for (const entry of ledger) totals.set(entry.product_id,
        (totals.get(entry.product_id) || 0) + Number(entry.quantity));
    for (const [productId, quantity] of totals) {
        await client.query('UPDATE products SET sold_count = sold_count + $1, updated_date = now() WHERE id = $2',
            [quantity, productId]);
    }
    await client.query("UPDATE stock_reservations SET status = 'sold', updated_at = now() WHERE order_id = $1 AND status = 'active'", [order.id]);
    return true;
}

// Only an unconverted active reservation can be released. Historical orders are untouched.
export async function releaseOrderStockInTransaction(client, order) {
    if (!isDeferredStockOrder(order)) return false;
    const items = await itemsForOrder(client, order.id);
    const ledger = await ledgerForOrder(client, order.id);
    if (!ledger.length) return false; // Order created without a payment attempt.
    if (ledger.every(entry => entry.status === 'released')) {
        assertComplete(items, ledger, 'released'); return false;
    }
    assertComplete(items, ledger, 'active');
    let productId = null, product, colors;
    async function saveProduct() {
        if (productId) await client.query('UPDATE products SET colors = $1, updated_date = now() WHERE id = $2',
            [JSON.stringify(colors), productId]);
    }
    for (const entry of ledger) {
        if (entry.product_id !== productId) {
            await saveProduct();
            const { rows } = await client.query('SELECT colors, sizes FROM products WHERE id = $1 FOR UPDATE', [entry.product_id]);
            product = rows[0]; productId = entry.product_id;
            if (!product) throw conflict('Produto ausente; estoque exige conciliação');
            colors = product.colors || [];
        }
        const color = colors.find(value => value.id === entry.color_id);
        if (!color) throw conflict('Variação ausente; estoque exige conciliação');
        restoreVariantStock(product, color, entry.size, Number(entry.quantity));
    }
    await saveProduct();
    await client.query("UPDATE stock_reservations SET status = 'released', updated_at = now() WHERE order_id = $1 AND status = 'active'", [order.id]);
    return true;
}
