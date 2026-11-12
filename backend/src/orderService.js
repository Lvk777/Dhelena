import { notificationMetadata } from './services/notificationOutbox.js';
import { pool, withTransaction } from './config/db.js';
import { withDeliveryEstimate, assertDeliveryEstimateAcknowledged } from './lib/deliveryEstimate.js';
import { checkoutCents, checkoutDiscount, assertCheckoutPriceAcknowledged } from './lib/checkoutDiscount.js';
import { validateCoupon, logAudit, sendOrderNotifications } from './services.js';
import * as melhorEnvio from './services/melhorEnvio.js';
import { restoreStock } from './afterSalesService.js';
import { canCancelWithoutRefund } from './lib/afterSalesPolicy.js';
import { buildShippingPackages, getCheckoutShippingInput, selectShippingQuote } from './lib/shipping.js';
import { assertMatchingIdempotencyRequest, createOrderRequestFingerprint, normalizeIdempotencyKey } from './lib/idempotency.js';
import { calculateCheckoutShippingCost, calculateServerOrderTotal, resolveCatalogLine } from './lib/orderPricing.js';
import { reserveVariantStock } from './lib/variantStock.js';
import { getPixCapability } from './lib/pixAvailability.js';
import { getMercadoPagoReadiness } from './services/mercadoPago.js';
import { reservationExpiryAt } from './lib/orderReservationExpiry.js';
import { isDeferredStockOrder, releaseOrderStockInTransaction } from './lib/deferredStock.js';

// ─── placeOrder: atomic order creation ──────────────────────────────
export async function placeOrder(userId, body, idempotencyKey, {
    transaction = withTransaction, notify = sendOrderNotifications,
    quoteShipping = melhorEnvio.calculateShipping, pixReadiness = getMercadoPagoReadiness,
    env = process.env,
} = {}) {
    const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
    const idempotencyFingerprint = createOrderRequestFingerprint(body);
    const { items, coupon_code, payment_method, customer } = body;
    const { shipping_address, shipping_method, shipping_quote_id } = getCheckoutShippingInput(body);

    if (!items || !Array.isArray(items) || items.length === 0) {
        throw Object.assign(new Error('Carrinho vazio'), { status: 400 });
    }
    if (!['pix', 'credito', 'debito'].includes(payment_method)) {
        throw Object.assign(new Error('Forma de pagamento inválida'), { status: 400 });
    }

    return transaction(async (client) => {
        const { rows: paymentSettings } = await client.query("SELECT value FROM settings WHERE key = 'payments'");
        const paymentConfig = paymentSettings[0]?.value || {};
        if ((payment_method === 'pix' && paymentConfig.pix_enabled === false)
            || (payment_method !== 'pix' && paymentConfig.card_enabled === false)
            || (payment_method === 'debito' && paymentConfig.debit_card_enabled === false)) {
            throw Object.assign(new Error('Forma de pagamento indisponível'), { status: 409 });
        }
        if (payment_method === 'pix' && !getPixCapability(paymentConfig, pixReadiness()).enabled) {
            throw Object.assign(new Error('Pix indisponível no momento. Escolha outra forma de pagamento.'), { status: 409 });
        }
        // Serialize retries for this user/key before checking or applying stock
        // changes. The unique index is the final database-level safeguard.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`checkout:${userId}:${normalizedIdempotencyKey}`]);
        const { rows: existing } = await client.query(
            'SELECT * FROM orders WHERE idempotency_key = $1 AND user_id = $2',
            [normalizedIdempotencyKey, userId]
        );
        if (existing.length > 0) return { order: assertMatchingIdempotencyRequest(existing[0], idempotencyFingerprint), created: false };

        // Serialize this customer's first-purchase checks, including checkouts
        // with different coupons and idempotency keys.
        await client.query('SELECT id FROM profiles WHERE id = $1 FOR UPDATE', [userId]);

        let subtotal = 0;
        const orderItems = [];
        const lockedProducts = new Map();

        // Process each item: lock product, verify stock, calculate price
        for (const item of items) {
            const { productId, colorId, size, qty } = item;
            // Lock product row
            if (!lockedProducts.has(productId)) {
                const { rows: prodRows } = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
                if (prodRows.length === 0) throw Object.assign(new Error(`Produto não encontrado: ${productId}`), { status: 404 });
                lockedProducts.set(productId, structuredClone(prodRows[0]));
            }
            const product = lockedProducts.get(productId);

            // Resolve price and stock exclusively from the locked catalog row.
            const { color, quantity, unitPrice, itemSubtotal } = resolveCatalogLine(product, { colorId, size, qty });
            subtotal = (checkoutCents(subtotal) + checkoutCents(itemSubtotal)) / 100;

            // Validate repeated variants against a detached copy; checkout creates
            // no reservation, stock movement or sale before a payment attempt.
            reserveVariantStock(product, color, size, quantity);

            orderItems.push({
                product_id: productId,
                product_name: product.name,
                product_sku: product.sku,
                product_image: product.images?.[0] || null,
                product_category: product.category || '',
                price_promotion: Number(product.sale_price) > 0 && Number(product.sale_price) < Number(product.price),
                color_id: colorId,
                color_name: color.name,
                size,
                quantity,
                unit_price: unitPrice,
                subtotal: itemSubtotal,
                weight: Number(product.weight),
                height: Number(product.package_height),
                width: Number(product.package_width),
                length: Number(product.package_length),
            });
        }

        // Validate coupon
        let discount = 0;
        let couponId = null;
        if (coupon_code) {
            // The coupon row remains locked until COMMIT/ROLLBACK. Counts and
            // the eventual usage insert therefore share one transaction.
            const couponResult = await validateCoupon(coupon_code, userId, subtotal, items, { db: client, lock: true });
            if (!couponResult.valid) {
                throw Object.assign(new Error(couponResult.error), { status: 400 });
            }
            discount = couponResult.discount;

            couponId = couponResult.couponId;
        }

        const { rows: activePromos } = await client.query(
            `SELECT * FROM look_promotions
             WHERE active = true
               AND (valid_until IS NULL OR valid_until > now())
               AND (valid_from IS NULL OR valid_from <= now())
             ORDER BY priority DESC, created_at DESC`
        );
        const pricing = checkoutDiscount({ subtotal, lines: orderItems, couponCode: coupon_code,
            couponDiscount: discount, promotions: activePromos, paymentMethod: payment_method,
            paymentConfig, env });
        discount = pricing.discount;
        const appliedPromo = pricing.appliedPromo;

        // Calculate shipping exclusively from the server-side cart and product
        // dimensions.  Prices, carrier and delivery time supplied by the
        // browser are intentionally ignored.
        let shippingCost = 0;
        let shippingQuoteId = null;
        let shippingCarrier = null;
        let shippingServiceName = null;
        let shippingDeliveryTime = null;
        let deliveryEstimate = null;
        let shippingPackages = [];
        const { rows: shipSettings } = await client.query("SELECT value FROM settings WHERE key = 'shipping'");
        const shipConfig = shipSettings[0]?.value || {};
        const freeEnabled = shipConfig.free_shipping_enabled === true;

        if (shipping_method === 'retirada') {
            if (shipConfig.pickup_enabled !== true) {
                throw Object.assign(new Error('Retirada no estoque não está disponível'), { status: 400 });
            }
            shippingCost = 0;
        } else {
            if (shipping_method !== 'melhor_envio' || !shipping_quote_id) {
                throw Object.assign(new Error('Selecione uma opção de entrega válida'), { status: 400 });
            }
            const destinationPostalCode = String(shipping_address?.cep || shipping_address?.zip_code || '').replace(/\D/g, '');
            if (destinationPostalCode.length !== 8) {
                throw Object.assign(new Error('CEP de entrega inválido'), { status: 400 });
            }
            const { rows: addressRows } = await client.query("SELECT value FROM settings WHERE key = 'address'");
            const originPostalCode = String(addressRows[0]?.value?.cep || '').replace(/\D/g, '');
            if (originPostalCode.length !== 8) {
                throw Object.assign(new Error('CEP de origem não configurado'), { status: 503 });
            }
            if (!shipConfig.melhor_envio_enabled) {
                throw Object.assign(new Error('Melhor Envio não está ativado'), { status: 503 });
            }
            const packages = buildShippingPackages(orderItems);
            const options = await quoteShipping({
                fromPostalCode: originPostalCode,
                toPostalCode: destinationPostalCode,
                products: packages,
                totalValue: subtotal - discount,
            });
            const quote = withDeliveryEstimate(selectShippingQuote(options, shipping_quote_id), shipConfig, env);
            shippingQuoteId = String(quote.id);
            shippingCarrier = quote.company || null;
            shippingServiceName = quote.service || quote.name || null;
            deliveryEstimate = quote.delivery_estimate;
            assertDeliveryEstimateAcknowledged(body.expected_delivery_estimate, deliveryEstimate);
            shippingDeliveryTime = deliveryEstimate.total_business_days;
            shippingPackages = Array.isArray(quote.packages) ? quote.packages : [];
            shippingCost = calculateCheckoutShippingCost(quote.price, subtotal, discount, freeEnabled, shipConfig.free_shipping_threshold);
        }

        const total = calculateServerOrderTotal(subtotal, discount, shippingCost);
        assertCheckoutPriceAcknowledged(body.expected_pricing,
            { subtotal, discount, shipping_cost: shippingCost, total }, pricing.discount_breakdown.pix > 0);

        // Serialize numbering across distinct customers and coupons as well.
        await client.query("SELECT pg_advisory_xact_lock(hashtext('checkout:order-number'))");
        // Generate order number
        const year = new Date().getFullYear();
        const { rows: countRows } = await client.query(
            "SELECT COALESCE(MAX(split_part(order_number, '-', 3)::bigint), 0) AS last_number FROM orders WHERE order_number ~ $1",
            [`^DH-${year}-[0-9]+$`]
        );
        const orderNum = `DH-${year}-${String(Number(countRows[0].last_number) + 1).padStart(6, '0')}`;

        // Build snapshot
        const reservationExpiresAt = reservationExpiryAt(env);
        const snapshot = {
            order_number: orderNum,
            items: orderItems.map(i => ({ ...i, unit_price: Number(i.unit_price), subtotal: Number(i.subtotal) })),
            subtotal: Number(subtotal.toFixed(2)),
            discount: Number(discount.toFixed(2)),
            shipping_cost: Number(shippingCost.toFixed(2)),
            total: Number(total.toFixed(2)),
            discount_breakdown: pricing.discount_breakdown,
            pix_discount_percentage: pricing.pix_discount_percentage,
            pix_discount_reason: pricing.pix_discount_reason,
            coupon_code: coupon_code || null,
            promotion: appliedPromo ? { name: appliedPromo.name, title: appliedPromo.title, discount_percent: Number(appliedPromo.discount_percent) } : null,
            shipping_method,
            shipping_quote_id: shippingQuoteId,
            shipping_carrier: shippingCarrier,
            shipping_service_name: shippingServiceName,
            shipping_delivery_time: shippingDeliveryTime,
            delivery_estimate: deliveryEstimate,
            shipping_packages: shippingPackages,
            shipping_environment: shipping_method === 'melhor_envio' ? (env.MELHOR_ENVIO_MODE || (env.NODE_ENV === 'production' ? null : 'sandbox')) : null,
            payment_method,
            shipping_address,
            customer: customer || {},
            idempotency_fingerprint: idempotencyFingerprint,
            stock_model: 'deferred_sale_v1',
            ...(reservationExpiresAt ? { reservation_expires_at: reservationExpiresAt } : {}),
            created_at: new Date().toISOString(),
        };

        // Create order
        const { rows: orderRows } = await client.query(
            `INSERT INTO orders (order_number, user_id, status, payment_status, payment_method, shipping_method, shipping_cost, discount, coupon_code, subtotal, total, snapshot, shipping_address, idempotency_key, shipping_quote_id, shipping_carrier, shipping_service_name, shipping_delivery_time)
             VALUES ($1, $2, 'recebido', 'pending', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
             RETURNING *`,
            [orderNum, userId, payment_method || null, shipping_method || null, shippingCost, discount, coupon_code || null, subtotal, total, JSON.stringify(snapshot), JSON.stringify(shipping_address), normalizedIdempotencyKey,
              shippingQuoteId, shippingCarrier, shippingServiceName, shippingDeliveryTime]
        );
        const order = orderRows[0];

        // Create order items
        for (const item of orderItems) {
            await client.query(
                `INSERT INTO order_items (order_id, product_id, product_name, product_sku, product_image, color_id, color_name, size, quantity, unit_price, subtotal)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [order.id, item.product_id, item.product_name, item.product_sku, item.product_image, item.color_id, item.color_name, item.size, item.quantity, item.unit_price, item.subtotal]
            );
        }

        // Record coupon usage
        if (couponId) {
            await client.query(
                'INSERT INTO coupon_usages (coupon_id, order_id, user_id) VALUES ($1, $2, $3)',
                [couponId, order.id, userId]
            );
        }

        // Audit log
        await client.query(
            `INSERT INTO audit_logs (action, entity_type, entity_id, changes)
             VALUES ('order.create', 'order', $1, $2)`,
            [order.id, JSON.stringify({ order_number: orderNum, total: Number(total.toFixed(2)) })]
        );

        await client.query(`INSERT INTO order_events(order_id,event,description,metadata)
            VALUES($1,'order_created','Pedido recebido; aguardando confirmação de pagamento',$2)`,
            [order.id, JSON.stringify(notificationMetadata({}, env))]);
        return { order, created: true };
    }).then(async ({ order, created }) => {
        // Fire notifications (async — don't block or fail the order)
        if (created) notify(order.id, 'order_created').catch(() => {});
        return order;
    });
}

// ─── cancelOrder: idempotent cancellation with stock restoration ────
export async function cancelOrderInTransaction(client, order, userId = null, resolvedFailedPixAttempt = false) {
    if (order.status === 'cancelado') return order;
    const orderId = order.id;
    if (resolvedFailedPixAttempt) {
        const { rows: evidence } = await client.query(
            `SELECT 1 FROM order_events WHERE order_id = $1 AND event = 'payment_attempt_resolved' LIMIT 1`,
            [orderId]);
        if (!order.payment_attempt_started_at || order.payment_attempt_method !== 'pix'
            || order.payment_status !== 'pending' || order.paid_at || !evidence.length) {
            throw Object.assign(new Error('Resolução Pix sem evidência válida'), { status: 409 });
        }
    }
    const cancellable = resolvedFailedPixAttempt
        ? canCancelWithoutRefund({ ...order, payment_attempt_started_at: null })
        : canCancelWithoutRefund(order);
    if (!cancellable) {
        throw Object.assign(new Error('Pedido com pagamento no provedor exige conciliação antes do cancelamento'), { status: 409 });
    }
    if (isDeferredStockOrder(order)) await releaseOrderStockInTransaction(client, order);
    else {
        const { rows: items } = await client.query('SELECT * FROM order_items WHERE order_id = $1', [orderId]);
        for (const item of items) await restoreStock(client, order, item, item.quantity, 'cancellation', null, userId);
    }

    const { rows: updated } = await client.query(
        "UPDATE orders SET status = 'cancelado', updated_at = now() WHERE id = $1 RETURNING *",
        [orderId]
    );
    await client.query(
        `INSERT INTO order_events (order_id, event, description, metadata)
         VALUES ($1, 'order_cancelled', 'Pedido cancelado; reserva liberada quando aplicável', $2)`,
        [orderId, JSON.stringify(notificationMetadata())]
    );
    await client.query(
        `INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, changes) VALUES ($1, 'order.cancel', 'order', $2, $3)`,
        [userId, orderId, JSON.stringify({ previous_status: order.status })]
    );
    return updated[0];
}

export async function cancelOrder(orderId, userId, isAdmin = false) {
    return withTransaction(async (client) => {
        const query = isAdmin ? 'SELECT * FROM orders WHERE id = $1 FOR UPDATE' : 'SELECT * FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE';
        const params = isAdmin ? [orderId] : [orderId, userId];
        const { rows: orderRows } = await client.query(query, params);
        if (orderRows.length === 0) throw Object.assign(new Error('Pedido não encontrado'), { status: 404 });
        return cancelOrderInTransaction(client, orderRows[0], isAdmin ? userId : null);
    });
}
