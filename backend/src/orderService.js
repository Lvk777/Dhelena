import { pool, withTransaction } from './config/db.js';
import { validateCoupon, logAudit, sendOrderNotifications } from './services.js';
import * as melhorEnvio from './services/melhorEnvio.js';
import { buildShippingPackages, selectShippingQuote } from './lib/shipping.js';

// ─── placeOrder: atomic order creation ──────────────────────────────
export async function placeOrder(userId, body, idempotencyKey) {
    const { items, shipping_address, shipping_method, coupon_code, payment_method, customer,
            shipping_quote_id } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
        throw Object.assign(new Error('Carrinho vazio'), { status: 400 });
    }

    return withTransaction(async (client) => {
        // Idempotency check
        if (idempotencyKey) {
            const { rows: existing } = await client.query('SELECT * FROM orders WHERE idempotency_key = $1 AND user_id = $2', [idempotencyKey, userId]);
            if (existing.length > 0) return existing[0];
        }

        let subtotal = 0;
        const orderItems = [];

        // Process each item: lock product, verify stock, calculate price
        for (const item of items) {
            const { productId, colorId, size, qty } = item;
            const quantity = parseInt(qty);
            if (!quantity || quantity <= 0) throw Object.assign(new Error('Quantidade inválida'), { status: 400 });

            // Lock product row
            const { rows: prodRows } = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
            if (prodRows.length === 0) throw Object.assign(new Error(`Produto não encontrado: ${productId}`), { status: 404 });

            const product = prodRows[0];

            // Find color and check stock
            const colors = product.colors || [];
            const color = colors.find(c => c.id === colorId);
            if (!color) throw Object.assign(new Error(`Cor não encontrada: ${colorId}`), { status: 404 });

            const currentStock = color.stock?.[size] ?? 0;
            if (currentStock < quantity) {
                throw Object.assign(new Error(`Estoque insuficiente para ${product.name} (${color.name}, ${size}). Disponível: ${currentStock}`), { status: 409 });
            }

            // Use sale_price if available, otherwise regular price
            const unitPrice = product.sale_price ? Number(product.sale_price) : Number(product.price);
            const itemSubtotal = unitPrice * quantity;
            subtotal += itemSubtotal;

            // Update stock in colors JSONB
            color.stock[size] = currentStock - quantity;
            await client.query('UPDATE products SET colors = $1, sold_count = sold_count + $2, updated_date = now() WHERE id = $3', [JSON.stringify(colors), quantity, productId]);

            // Record stock movement
            await client.query(
                `INSERT INTO stock_movements (product_id, type, quantity, color_id, size, previous_stock, new_stock)
                 VALUES ($1, 'sale', $2, $3, $4, $5, $6)`,
                [productId, -quantity, colorId, size, currentStock, currentStock - quantity]
            );

            orderItems.push({
                product_id: productId,
                product_name: product.name,
                product_sku: product.sku,
                product_image: product.images?.[0] || null,
                product_category: product.category || '',
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
            const couponResult = await validateCoupon(coupon_code, userId, subtotal, items);
            if (!couponResult.valid) {
                throw Object.assign(new Error(couponResult.error), { status: 400 });
            }
            discount = couponResult.discount;

            // Get coupon ID for usage tracking
            const { rows: couponRows } = await client.query('SELECT id FROM coupons WHERE code = $1', [coupon_code.toUpperCase().trim()]);
            if (couponRows.length > 0) couponId = couponRows[0].id;
        }

        // ── Server-side promotion validation (highest priority active promo) ──
        // The frontend cannot be trusted for the final discount. Backend recalculates.
        let promoDiscount = 0;
        let appliedPromo = null;
        const { rows: activePromos } = await client.query(
            `SELECT * FROM look_promotions
             WHERE active = true
               AND (valid_until IS NULL OR valid_until > now())
               AND (valid_from IS NULL OR valid_from <= now())
             ORDER BY priority DESC, created_at DESC`
        );

        for (const promo of activePromos) {
            let eligible = false;

            // Check min_items (for look discounts)
            if (promo.min_items && promo.min_items > 0) {
                eligible = items.length >= promo.min_items;
            } else {
                eligible = true;
            }

            // Check min_value
            if (eligible && promo.min_value && Number(promo.min_value) > 0) {
                eligible = subtotal >= Number(promo.min_value);
            }

            // Check applicable_category
            if (eligible && promo.applicable_category) {
                eligible = orderItems.some(item => {
                    const prodCats = item.product_category || '';
                    return prodCats.toLowerCase().includes(promo.applicable_category.toLowerCase());
                });
            }

            if (eligible) {
                appliedPromo = promo;
                if (Number(promo.discount_percent) > 0) {
                    promoDiscount = (subtotal * Number(promo.discount_percent)) / 100;
                } else if (Number(promo.discount_fixed) > 0) {
                    promoDiscount = Number(promo.discount_fixed);
                }
                break; // Only apply highest priority promo
            }
        }

        // Add promo discount (promotions don't stack with each other, but may stack with coupon)
        if (appliedPromo && !appliedPromo.stacks_with_coupon) {
            // If promo doesn't stack, use the larger of the two
            if (promoDiscount > discount) {
                discount = promoDiscount;
            }
        } else if (appliedPromo) {
            discount += promoDiscount;
        }
        discount = Math.min(discount, subtotal); // Never exceed subtotal

        // Calculate shipping exclusively from the server-side cart and product
        // dimensions.  Prices, carrier and delivery time supplied by the
        // browser are intentionally ignored.
        let shippingCost = 0;
        let shippingQuoteId = null;
        let shippingCarrier = null;
        let shippingServiceName = null;
        let shippingDeliveryTime = null;
        const { rows: shipSettings } = await client.query("SELECT value FROM settings WHERE key = 'shipping'");
        const shipConfig = shipSettings[0]?.value || {};
        const freeThreshold = shipConfig.free_shipping_threshold || 499;
        const freeEnabled = shipConfig.free_shipping_enabled !== false;

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
            const options = await melhorEnvio.calculateShipping({
                fromPostalCode: originPostalCode,
                toPostalCode: destinationPostalCode,
                products: packages,
                totalValue: subtotal - discount,
            });
            const quote = selectShippingQuote(options, shipping_quote_id);
            shippingQuoteId = String(quote.id);
            shippingCarrier = quote.company || null;
            shippingServiceName = quote.service || quote.name || null;
            shippingDeliveryTime = Number.isInteger(Number(quote.delivery_time)) ? Number(quote.delivery_time) : null;
            shippingCost = freeEnabled && subtotal - discount >= freeThreshold ? 0 : Number(quote.price);
        }

        const total = subtotal - discount + shippingCost;

        // Generate order number
        const year = new Date().getFullYear();
        const { rows: countRows } = await client.query('SELECT COUNT(*) as cnt FROM orders WHERE order_number LIKE $1', [`DH-${year}-%`]);
        const orderNum = `DH-${year}-${String(parseInt(countRows[0].cnt) + 1).padStart(6, '0')}`;

        // Build snapshot
        const snapshot = {
            order_number: orderNum,
            items: orderItems.map(i => ({ ...i, unit_price: Number(i.unit_price), subtotal: Number(i.subtotal) })),
            subtotal: Number(subtotal.toFixed(2)),
            discount: Number(discount.toFixed(2)),
            shipping_cost: Number(shippingCost.toFixed(2)),
            total: Number(total.toFixed(2)),
            coupon_code: coupon_code || null,
            promotion: appliedPromo ? { name: appliedPromo.name, title: appliedPromo.title, discount_percent: Number(appliedPromo.discount_percent) } : null,
            shipping_method,
            shipping_quote_id: shippingQuoteId,
            shipping_carrier: shippingCarrier,
            shipping_service_name: shippingServiceName,
            shipping_delivery_time: shippingDeliveryTime,
            payment_method,
            shipping_address,
            customer: customer || {},
            created_at: new Date().toISOString(),
        };

        // Create order
        const { rows: orderRows } = await client.query(
            `INSERT INTO orders (order_number, user_id, status, payment_status, payment_method, shipping_method, shipping_cost, discount, coupon_code, subtotal, total, snapshot, shipping_address, idempotency_key, shipping_quote_id, shipping_carrier, shipping_service_name, shipping_delivery_time)
             VALUES ($1, $2, 'recebido', 'pending', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
             RETURNING *`,
            [orderNum, userId, payment_method || null, shipping_method || null, shippingCost, discount, coupon_code || null, subtotal, total, JSON.stringify(snapshot), JSON.stringify(shipping_address), idempotencyKey,
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

        return order;
    }).then(async (order) => {
        // Fire notifications (async — don't block or fail the order)
        sendOrderNotifications(order.id, 'order_created').catch(() => {});
        return order;
    });
}

// ─── cancelOrder: idempotent cancellation with stock restoration ────
export async function cancelOrder(orderId, userId, isAdmin = false) {
    return withTransaction(async (client) => {
        const query = isAdmin ? 'SELECT * FROM orders WHERE id = $1 FOR UPDATE' : 'SELECT * FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE';
        const params = isAdmin ? [orderId] : [orderId, userId];

        const { rows: orderRows } = await client.query(query, params);
        if (orderRows.length === 0) throw Object.assign(new Error('Pedido não encontrado'), { status: 404 });

        const order = orderRows[0];
        if (order.status === 'cancelado') return order; // Idempotent — already cancelled

        // Get order items
        const { rows: items } = await client.query('SELECT * FROM order_items WHERE order_id = $1', [orderId]);

        // Restore stock for each item
        for (const item of items) {
            const { rows: prodRows } = await client.query('SELECT colors FROM products WHERE id = $1 FOR UPDATE', [item.product_id]);
            if (prodRows.length === 0) continue;

            const colors = prodRows[0].colors || [];
            const color = colors.find(c => c.id === item.color_id);
            if (!color) continue;

            const currentStock = color.stock?.[item.size] ?? 0;
            if (!color.stock) color.stock = {};
            color.stock[item.size] = currentStock + item.quantity;

            await client.query('UPDATE products SET colors = $1, sold_count = GREATEST(0, sold_count - $2), updated_date = now() WHERE id = $3', [JSON.stringify(colors), item.quantity, item.product_id]);

            await client.query(
                `INSERT INTO stock_movements (product_id, order_id, type, quantity, color_id, size, previous_stock, new_stock)
                 VALUES ($1, $2, 'cancel', $3, $4, $5, $6, $7)`,
                [item.product_id, orderId, item.quantity, item.color_id, item.size, currentStock, currentStock + item.quantity]
            );
        }

        // Update order status
        const { rows: updated } = await client.query(
            "UPDATE orders SET status = 'cancelado', payment_status = 'refunded', updated_at = now() WHERE id = $1 RETURNING *",
            [orderId]
        );

        // Audit log
        await client.query(
            `INSERT INTO audit_logs (action, entity_type, entity_id, changes) VALUES ('order.cancel', 'order', $1, $2)`,
            [orderId, JSON.stringify({ previous_status: order.status })]
        );

        return updated[0];
    });
}
