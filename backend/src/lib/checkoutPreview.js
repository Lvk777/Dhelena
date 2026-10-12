import { pool } from '../config/db.js';
import { validateCoupon } from '../services.js';
import { checkoutCents, checkoutDiscount } from './checkoutDiscount.js';
import { resolveCatalogLine, calculateCheckoutShippingCost, calculateServerOrderTotal } from './orderPricing.js';
import { reserveVariantStock } from './variantStock.js';
import { buildShippingPackages, selectShippingQuote } from './shipping.js';
import * as melhorEnvio from '../services/melhorEnvio.js';

function invalid(message, status = 400) { return Object.assign(new Error(message), { status }); }

export async function previewCheckout(body, userId = null, { db = pool, quoteShipping = melhorEnvio.calculateShipping, env = process.env } = {}) {
    const { items, payment_method, coupon_code = '', shipping_method, shipping_quote_id, shipping_address } = body || {};
    if (!Array.isArray(items) || !items.length || items.length > 100 || items.some(item =>
        !item || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.productId || '')
        || !Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > 100)) throw invalid('Carrinho inválido');
    if (!['pix', 'credito', 'debito'].includes(payment_method)) throw invalid('Forma de pagamento inválida');
    if (typeof coupon_code !== 'string' || coupon_code.length > 100) throw invalid('Cupom inválido');
    const { rows: products } = await db.query("SELECT * FROM products WHERE id = ANY($1::uuid[]) AND status = 'published'", [[...new Set(items.map(i => i.productId))]]);
    const byId = new Map(products.map(p => [p.id.toLowerCase(), structuredClone(p)]));
    let subtotalCents = 0;
    const lines = items.map(item => {
        const product = byId.get(item.productId.toLowerCase());
        if (!product) throw invalid('Produto indisponível', 409);
        const resolved = resolveCatalogLine(product, item);
        // Mutate only the detached in-memory copy to validate aggregate stock
        // for repeated variants. This endpoint has no INSERT/UPDATE/reservation.
        reserveVariantStock(product, resolved.color, item.size, resolved.quantity);
        subtotalCents += checkoutCents(resolved.itemSubtotal);
        return { product_id: product.id, product_category: product.category || '', color_id: item.colorId, size: item.size,
            quantity: resolved.quantity, unit_price: resolved.unitPrice, subtotal: resolved.itemSubtotal,
            price_promotion: Number(product.sale_price) > 0 && Number(product.sale_price) < Number(product.price),
            weight: product.weight, height: product.package_height, width: product.package_width, length: product.package_length };
    });
    if (!Number.isSafeInteger(subtotalCents)) throw invalid('Carrinho inválido');
    const subtotal = subtotalCents / 100;
    const { rows: settingsRows } = await db.query('SELECT key,value FROM settings WHERE key = ANY($1::text[])', [['payments', 'shipping', 'address']]);
    const settings = Object.fromEntries(settingsRows.map(row => [row.key, row.value]));
    const coupon = coupon_code ? await validateCoupon(coupon_code, userId, subtotal, items, { db }) : null;
    if (coupon && !coupon.valid) throw invalid(coupon.error);
    const { rows: promotions } = await db.query(`SELECT * FROM look_promotions WHERE active = true
        AND (valid_until IS NULL OR valid_until > now()) AND (valid_from IS NULL OR valid_from <= now())
        ORDER BY priority DESC, created_at DESC`);
    const pricing = checkoutDiscount({ subtotal, lines, couponCode: coupon_code, couponDiscount: coupon?.discount || 0,
        promotions, paymentMethod: payment_method, paymentConfig: settings.payments, env });
    let shippingCost = 0;
    if (shipping_method === 'retirada') {
        if (settings.shipping?.pickup_enabled !== true) throw invalid('Retirada indisponível');
    } else {
        if (shipping_method !== 'melhor_envio' || !shipping_quote_id) throw invalid('Selecione uma entrega válida');
        const origin = String(settings.address?.cep || '').replace(/\D/g, '');
        const destination = String(shipping_address?.cep || shipping_address?.zip_code || '').replace(/\D/g, '');
        if (origin.length !== 8 || !settings.shipping?.melhor_envio_enabled) throw invalid('Entrega indisponível', 503);
        if (destination.length !== 8) throw invalid('CEP de entrega inválido');
        const options = await quoteShipping({ fromPostalCode: origin, toPostalCode: destination,
            products: buildShippingPackages(lines), totalValue: subtotal - pricing.discount });
        const quote = selectShippingQuote(options, shipping_quote_id);
        shippingCost = calculateCheckoutShippingCost(quote.price, subtotal, pricing.discount,
            settings.shipping.free_shipping_enabled, settings.shipping.free_shipping_threshold);
    }
    return { subtotal, discount: pricing.discount, discount_breakdown: pricing.discount_breakdown,
        pix_discount_reason: pricing.pix_discount_reason, pix_discount_percentage: pricing.pix_discount_percentage,
        shipping_cost: shippingCost, total: calculateServerOrderTotal(subtotal, pricing.discount, shippingCost),
        items: lines.map(({ product_id, color_id, size, quantity, unit_price, subtotal }) => ({ product_id, color_id, size, quantity, unit_price, subtotal })) };
}
