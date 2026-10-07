export async function loadRefundPhysicalState(db, orderId) {
    const [returns, restorations, items] = await Promise.all([
        db.query('SELECT id, status FROM order_returns WHERE order_id = $1 ORDER BY created_at', [orderId]),
        db.query('SELECT id, quantity, source FROM stock_restorations WHERE order_id = $1', [orderId]),
        db.query('SELECT product_id, color_id, size FROM order_items WHERE order_id = $1', [orderId]),
    ]);
    const stock = [];
    for (const item of items.rows) {
        const product = (await db.query('SELECT colors FROM products WHERE id = $1', [item.product_id])).rows[0];
        const colors = typeof product?.colors === 'string' ? JSON.parse(product.colors) : product?.colors;
        const color = (Array.isArray(colors) ? colors : []).find(entry => String(entry.id) === String(item.color_id));
        stock.push({ product_id: item.product_id, color_id: item.color_id,
            size: item.size, quantity: color?.stock?.[item.size] ?? null });
    }
    return { returns: returns.rows, restorations: restorations.rows, stock };
}

export function isRefundPhysicalBaseline({ returns, restorations, stock }) {
    return returns.length === 0 && restorations.length === 0
        && stock.length === 1 && Number(stock[0].quantity) === 7;
}
