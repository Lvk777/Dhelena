import { pool } from './config/db.js';
import { effectiveSizes, stockForSize } from './lib/variantStock.js';
import { queueOrderEmails } from './services/notificationOutbox.js';
import { logSafeError } from './lib/safeErrorLog.js';

// ─── Audit Log ─────────────────────────────────────────────────────
export async function logAudit(adminId, action, entityType, entityId, changes, ip) {
    await pool.query(
        `INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, changes, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [adminId, action, entityType, entityId, changes ? JSON.stringify(changes) : null, ip]
    );
}

// ─── Coupon Validation (server-side) ───────────────────────────────
export async function couponPreviewSubtotal(items, db = pool) {
    const invalid = () => Object.assign(new Error('Carrinho inválido'), { status: 400 });
    if (!Array.isArray(items) || !items.length || items.length > 100) throw invalid();
    for (const item of items) {
        if (!item || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.productId)
            || !Number.isSafeInteger(item.qty) || item.qty <= 0) throw invalid();
    }
    const { rows } = await db.query('SELECT id, price, sale_price FROM products WHERE id = ANY($1::uuid[])',
        [[...new Set(items.map(item => item.productId))]]);
    const products = new Map(rows.map(product => [product.id.toLowerCase(), product]));
    let subtotal = 0;
    for (const item of items) {
        const product = products.get(item.productId.toLowerCase());
        if (!product) throw Object.assign(new Error('Produto não encontrado'), { status: 404 });
        const price = Number(product.sale_price || product.price);
        if (!Number.isFinite(price) || price < 0) throw Object.assign(new Error('Preço de catálogo inválido'), { status: 500 });
        subtotal += price * item.qty;
    }
    if (!Number.isFinite(subtotal) || subtotal > Number.MAX_SAFE_INTEGER / 100) throw invalid();
    return Number(subtotal.toFixed(2));
}

export async function validateCoupon(code, userId, cartSubtotal, items, { db = pool, lock = false } = {}) {
    const { rows } = await db.query(`SELECT * FROM coupons WHERE code = $1${lock ? ' FOR UPDATE' : ''}`, [code.toUpperCase().trim()]);
    if (rows.length === 0) return { valid: false, error: 'Cupom não encontrado' };

    const c = rows[0];
    if (!c.active) return { valid: false, error: 'Cupom inativo' };

    const now = new Date();
    if (c.valid_from && now < new Date(c.valid_from)) return { valid: false, error: 'Cupom ainda não é válido' };
    if (c.valid_until && now > new Date(c.valid_until)) return { valid: false, error: 'Cupom expirado' };

    if (cartSubtotal < Number(c.min_order_value)) {
        return { valid: false, error: `Valor mínimo do pedido: R$ ${Number(c.min_order_value).toFixed(2)}` };
    }

    if (c.max_uses != null) {
        const { rows: usageCount } = await db.query('SELECT COUNT(*) FROM coupon_usages WHERE coupon_id = $1', [c.id]);
        if (parseInt(usageCount[0].count) >= c.max_uses) return { valid: false, error: 'Cupom esgotado' };
    }

    if (c.max_uses_per_customer != null && userId) {
        const { rows: userUsage } = await db.query('SELECT COUNT(*) FROM coupon_usages WHERE coupon_id = $1 AND user_id = $2', [c.id, userId]);
        if (parseInt(userUsage[0].count) >= c.max_uses_per_customer) return { valid: false, error: 'Você já usou este cupom' };
    }

    if (c.first_purchase_only && userId) {
        const { rows: prevOrders } = await db.query('SELECT COUNT(*) FROM orders WHERE user_id = $1 AND status != $2', [userId, 'cancelado']);
        if (parseInt(prevOrders[0].count) > 0) return { valid: false, error: 'Cupom válido apenas para primeira compra' };
    }

    let discount = 0;
    if (c.discount_type === 'percentage') {
        discount = (cartSubtotal * Number(c.discount_value)) / 100;
    } else {
        discount = Number(c.discount_value);
    }
    discount = Math.min(discount, cartSubtotal);

    return {
        valid: true,
        ...(lock ? { couponId: c.id } : {}),
        code: c.code,
        discount_type: c.discount_type,
        discount_value: Number(c.discount_value),
        discount,
    };
}

// ─── Stock Adjust (admin manual) ───────────────────────────────────
export async function adjustStock(client, productId, colorId, size, newStock, reason, adminId, orderId = null, type = 'adjust') {
    const { rows: prodRows } = await client.query('SELECT colors, sizes FROM products WHERE id = $1 FOR UPDATE', [productId]);
    if (prodRows.length === 0) throw Object.assign(new Error('Produto não encontrado'), { status: 404 });

    const colors = prodRows[0].colors || [];
    const colorIdx = colors.findIndex(c => c.id === colorId);
    if (colorIdx === -1) throw Object.assign(new Error('Cor não encontrada'), { status: 404 });

    const product = prodRows[0];
    if (!effectiveSizes(product).includes(size)
        || !Number.isSafeInteger(newStock) || newStock < 0) {
        throw Object.assign(new Error('Tamanho ou quantidade de estoque inválidos'), { status: 400 });
    }
    const previousStock = stockForSize(product, colors[colorIdx], size);
    const delta = newStock - previousStock;

    if (!colors[colorIdx].stock) colors[colorIdx].stock = {};
    if (effectiveSizes(product).length === 1) colors[colorIdx].stock = { [size]: newStock };
    else colors[colorIdx].stock[size] = newStock;

    await client.query('UPDATE products SET colors = $1, updated_date = now() WHERE id = $2', [JSON.stringify(colors), productId]);

    await client.query(
        `INSERT INTO stock_movements (product_id, order_id, type, quantity, color_id, size, previous_stock, new_stock, reason, admin_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [productId, orderId, type, delta, colorId, size, previousStock, newStock, reason, adminId]
    );

    return { previousStock, newStock, delta };
}

// Future marked events only; dispatch is durable and disabled until authorized.
export async function sendOrderNotifications(orderId, event) {
    try { await queueOrderEmails(orderId, event); }
    catch (err) { logSafeError('notifications_dispatch_failed', err); }
}
