import { Router } from 'express';
import { pool } from '../config/db.js';
import { auth, requireAdmin } from '../middleware.js';
import { placeOrder, cancelOrder } from '../orderService.js';
import { validateCoupon, adjustStock, logAudit } from '../services.js';
import { orderLimiter, couponLimiter } from '../middleware/rateLimiters.js';
import * as mp from '../services/mercadoPago.js';
import * as me from '../services/melhorEnvio.js';
import { assertLabelEligible, buildShippingPackages, getPersistedShippingService } from '../lib/shipping.js';
import { getVerifiedPaymentForOrder, hasPaymentStateChanged } from '../lib/paymentVerification.js';

const router = Router();
const COUPON_MUTABLE_FIELDS = new Set([
    'code', 'description', 'discount_type', 'discount_value', 'min_order_value',
    'max_uses', 'max_uses_per_customer', 'first_purchase_only', 'active',
    'valid_from', 'valid_until',
]);

// Every order endpoint is private.  Individual handlers still distinguish
// owner from admin, but anonymous requests must consistently receive 401
// rather than a null-user exception.
router.use('/orders', auth, (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Autenticação necessária' });
    next();
});

// ─── ORDERS ────────────────────────────────────────────────────────

// POST /api/orders — placeOrder
router.post('/orders', auth, orderLimiter, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'É necessário estar autenticado para criar um pedido' });
    try {
        const idempotencyKey = req.headers['x-idempotency-key'] || req.headers['idempotency-key'];
        const order = await placeOrder(req.user.id, req.body, idempotencyKey);
        res.status(201).json(order);
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// GET /api/orders — list (own for customer, all for admin)
router.get('/orders', auth, async (req, res, next) => {
    try {
        let query, params;
        if (req.user.role === 'admin') {
            query = 'SELECT *, created_at as created_date FROM orders ORDER BY created_at DESC';
            params = [];
        } else {
            query = 'SELECT *, created_at as created_date FROM orders WHERE user_id = $1 ORDER BY created_at DESC';
            params = [req.user.id];
        }
        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (err) { next(err); }
});

// GET /api/orders/:id
router.get('/orders/:id', auth, async (req, res, next) => {
    try {
        let query, params;
        if (req.user.role === 'admin') {
            query = 'SELECT *, created_at as created_date FROM orders WHERE id = $1';
            params = [req.params.id];
        } else {
            query = 'SELECT *, created_at as created_date FROM orders WHERE id = $1 AND user_id = $2';
            params = [req.params.id, req.user.id];
        }
        const { rows } = await pool.query(query, params);
        if (rows.length === 0) return res.status(404).json({ error: 'Pedido não encontrado' });

        const order = rows[0];
        const { rows: items } = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
        order.items = items;
        res.json(order);
    } catch (err) { next(err); }
});

// DELETE /api/orders/:id — cancelOrder
router.delete('/orders/:id', auth, async (req, res) => {
    try {
        const isAdmin = req.user.role === 'admin';
        const order = await cancelOrder(req.params.id, req.user.id, isAdmin);
        res.json(order);
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// PATCH /api/orders/:id/status — update status (admin)
router.patch('/orders/:id/status', auth, requireAdmin, async (req, res, next) => {
    try {
        const { status, payment_status, tracking_code } = req.body;
        const { rows } = await pool.query(
            `UPDATE orders SET status = COALESCE($1, status), payment_status = COALESCE($2, payment_status),
             tracking_code = COALESCE($3, tracking_code), updated_at = now() WHERE id = $4 RETURNING *`,
            [status, payment_status, tracking_code, req.params.id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Pedido não encontrado' });
        await logAudit(req.user.id, 'order.update_status', 'order', req.params.id, { status, payment_status }, req.ip);

        if (payment_status === 'approved') {
            const { sendOrderNotifications } = await import('../services.js');
            sendOrderNotifications(req.params.id, 'payment_approved').catch(() => {});
        }
        res.json(rows[0]);
    } catch (err) { next(err); }
});

// ─── COUPONS ───────────────────────────────────────────────────────

// POST /api/coupons/validate
router.post('/coupons/validate', couponLimiter, async (req, res, next) => {
    try {
        const { code, items } = req.body;
        const subtotal = (items || []).reduce((sum, i) => sum + (Number(i.price || 0) * (i.qty || 1)), 0);
        const userId = req.user?.id || null;
        const result = await validateCoupon(code, userId, subtotal, items);
        res.json(result);
    } catch (err) { next(err); }
});

// GET /api/coupons/:id — get single coupon (admin)
router.get('/coupons/:id', auth, requireAdmin, async (req, res, next) => {
    try {
        const { rows } = await pool.query('SELECT *, created_at as created_date FROM coupons WHERE id = $1', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Cupom não encontrado' });
        res.json(rows[0]);
    } catch (err) { next(err); }
});

// GET /api/coupons — list (admin)
router.get('/coupons', auth, requireAdmin, async (req, res, next) => {
    try {
        const { rows } = await pool.query('SELECT *, created_at as created_date FROM coupons ORDER BY created_at DESC');
        res.json(rows);
    } catch (err) { next(err); }
});

router.post('/coupons', auth, requireAdmin, async (req, res, next) => {
    try {
        const { code, description, discount_type, discount_value, min_order_value, max_uses, max_uses_per_customer, first_purchase_only, active, valid_from, valid_until } = req.body;
        const { rows } = await pool.query(
            `INSERT INTO coupons (code, description, discount_type, discount_value, min_order_value, max_uses, max_uses_per_customer, first_purchase_only, active, valid_from, valid_until)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [code.toUpperCase(), description, discount_type, discount_value, min_order_value || 0, max_uses, max_uses_per_customer || 1, first_purchase_only || false, active !== false, valid_from, valid_until]
        );
        await logAudit(req.user.id, 'coupon.create', 'coupon', rows[0].id, { code }, req.ip);
        res.status(201).json(rows[0]);
    } catch (err) { next(err); }
});

router.patch('/coupons/:id', auth, requireAdmin, async (req, res, next) => {
    try {
        const keys = Object.keys(req.body).filter(k => COUPON_MUTABLE_FIELDS.has(k));
        if (keys.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar' });
        const setParts = keys.map((k, i) => `${k} = $${i + 1}`);
        const values = keys.map(k => req.body[k]);
        values.push(req.params.id);
        const { rows } = await pool.query(`UPDATE coupons SET ${setParts.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING *`, values);
        if (rows.length === 0) return res.status(404).json({ error: 'Cupom não encontrado' });
        res.json(rows[0]);
    } catch (err) { next(err); }
});

router.delete('/coupons/:id', auth, requireAdmin, async (req, res, next) => {
    try {
        await pool.query('UPDATE coupons SET active = false WHERE id = $1', [req.params.id]);
        res.json({ id: req.params.id });
    } catch (err) { next(err); }
});

// ─── STOCK ─────────────────────────────────────────────────────────

router.post('/stock/adjust', auth, requireAdmin, async (req, res) => {
    try {
        const { product_id, color_id, size, new_stock, reason } = req.body;
        const result = await adjustStock(pool, product_id, color_id, size, parseInt(new_stock), reason, req.user.id);
        await logAudit(req.user.id, 'stock.adjust', 'product', product_id, { color_id, size, ...result }, req.ip);
        res.json(result);
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

router.get('/stock-movements', auth, requireAdmin, async (req, res, next) => {
    try {
        const { product_id } = req.query;
        let query = 'SELECT sm.*, p.name as product_name, sm.created_at as created_date FROM stock_movements sm JOIN products p ON sm.product_id = p.id';
        const params = [];
        if (product_id) { query += ' WHERE sm.product_id = $1'; params.push(product_id); }
        query += ' ORDER BY sm.created_at DESC LIMIT 200';
        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (err) { next(err); }
});

// ─── PAYMENTS ──────────────────────────────────────────────────────

// GET /api/payments/methods — list available payment methods from MP
router.get('/payments/methods', auth, async (req, res) => {
    try {
        const methods = await mp.getPaymentMethods();
        const types = await mp.getAvailablePaymentTypes();

        // Check admin settings for enabled methods
        const { rows: settingRows } = await pool.query("SELECT value FROM settings WHERE key = 'payments'");
        const payConfig = settingRows[0]?.value || {};
        const pixEnabled = payConfig.pix_enabled !== false;
        const cardEnabled = payConfig.card_enabled !== false;
        const boletoEnabled = payConfig.boleto_enabled === true;

        res.json({
            available: types,
            enabled: {
                pix: pixEnabled && types.pix,
                credit_card: cardEnabled && types.credit_card,
                debit_card: cardEnabled && types.debit_card,
                boleto: boletoEnabled && types.boleto,
            },
            methods,
            public_key: process.env.MERCADO_PAGO_PUBLIC_KEY || null,
            environment: mp.getMercadoPagoEnvironment(),
        });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// GET /api/payments/test — test MP connection (admin)
router.get('/payments/test', auth, requireAdmin, async (req, res) => {
    try {
        const result = await mp.testConnection();
        res.json(result);
    } catch (err) {
        res.status(500).json({ connected: false, error: err.message });
    }
});

router.get('/payments/test-orders/:orderNumber', auth, requireAdmin, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT order_number, created_at FROM orders WHERE order_number = $1',
            [req.params.orderNumber]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Pedido não encontrado' });
        const orders = await mp.findTestOrdersByReference(rows[0].order_number, rows[0].created_at);
        res.json({ orders });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// POST /api/orders/:id/payment/pix — create Pix payment
router.post('/orders/:id/payment/pix', auth, async (req, res) => {
    try {
        // Fetch order and verify ownership
        let query, params;
        if (req.user.role === 'admin') {
            query = 'SELECT * FROM orders WHERE id = $1';
            params = [req.params.id];
        } else {
            query = 'SELECT * FROM orders WHERE id = $1 AND user_id = $2';
            params = [req.params.id, req.user.id];
        }
        const { rows } = await pool.query(query, params);
        if (rows.length === 0) return res.status(404).json({ error: 'Pedido não encontrado' });

        const order = rows[0];

        // Idempotency: if already has MP order, return existing
        if (order.status === 'cancelado') return res.status(409).json({ error: 'Pedido cancelado' });
        if (order.mercado_pago_order_id && order.pix_qr_code) {
            return res.json({
                order_id: order.id,
                pix_qr_code: order.pix_qr_code,
                pix_qr_code_base64: order.pix_qr_code_base64,
                pix_expiration_at: order.pix_expiration_at,
                payment_status: order.payment_status,
            });
        }

        // Get payer info from snapshot
        const snapshot = order.snapshot || {};
        const customer = snapshot.customer || {};
        const payer = {
            email: customer.email || req.user.email,
            first_name: (customer.name || req.user.full_name || '').split(' ')[0],
            last_name: (customer.name || req.user.full_name || '').split(' ').slice(1).join(' ') || 'Cliente',
            identification: { type: 'CPF', number: (customer.cpf || '').replace(/\D/g, '') },
        };

        const idempotencyKey = `pix-${order.id}`;
        const result = await mp.createPixPayment({
            orderId: order.id,
            orderNumber: order.order_number,
            total: order.total,
            payer,
            idempotencyKey,
        });

        // Save MP data to order
        await pool.query(
            `UPDATE orders SET
                payment_provider = 'mercado_pago',
                mercado_pago_order_id = $1,
                mercado_pago_payment_id = $2,
                mercado_pago_status = $3,
                mercado_pago_status_detail = $4,
                mercado_pago_external_reference = $5,
                pix_qr_code = $6,
                pix_qr_code_base64 = $7,
                pix_expiration_at = $8,
                payment_status = 'pending',
                payment_updated_at = now(),
                updated_at = now()
             WHERE id = $9`,
            [result.mp_order_id, result.mp_payment_id, result.mp_status, result.mp_status_detail,
             result.external_reference, result.pix_qr_code, result.pix_qr_code_base64,
             result.pix_expiration_at, order.id]
        );

        // Audit log
        await pool.query(
            `INSERT INTO audit_logs (action, entity_type, entity_id, changes)
             VALUES ('payment_created', 'order', $1, $2)`,
            [order.id, JSON.stringify({ method: 'pix', mp_order_id: result.mp_order_id })]
        );

        // Timeline event
        await pool.query(
            `INSERT INTO order_events (order_id, event, description)
             VALUES ($1, 'payment_pending', 'Pagamento Pix criado — aguardando pagamento')`,
            [order.id]
        );

        res.json({
            order_id: order.id,
            pix_qr_code: result.pix_qr_code,
            pix_qr_code_base64: result.pix_qr_code_base64,
            pix_expiration_at: result.pix_expiration_at,
            payment_status: 'pending',
        });
    } catch (err) {
        console.error('[Payment Pix] Error:', err.message);
        res.status(err.status || 500).json({ error: err.message });
    }
});

// POST /api/orders/:id/payment/card — create card payment
router.post('/orders/:id/payment/card', auth, async (req, res) => {
    try {
        const { card_token, installments, payment_method_id, issuer_id } = req.body;

        if (!card_token) return res.status(400).json({ error: 'Token do cartão é obrigatório' });
        if (!payment_method_id) return res.status(400).json({ error: 'Método de pagamento é obrigatório' });

        // Fetch order and verify ownership
        let query, params;
        if (req.user.role === 'admin') {
            query = 'SELECT * FROM orders WHERE id = $1';
            params = [req.params.id];
        } else {
            query = 'SELECT * FROM orders WHERE id = $1 AND user_id = $2';
            params = [req.params.id, req.user.id];
        }
        const { rows } = await pool.query(query, params);
        if (rows.length === 0) return res.status(404).json({ error: 'Pedido não encontrado' });

        const order = rows[0];

        // Idempotency: if already has MP order with card, return status
        if (order.mercado_pago_order_id && order.payment_provider === 'mercado_pago' && order.payment_status !== 'pending') {
            return res.json({
                order_id: order.id,
                payment_status: order.payment_status,
                mp_status: order.mercado_pago_status,
                mp_status_detail: order.mercado_pago_status_detail,
            });
        }

        // Get payer info
        const snapshot = order.snapshot || {};
        const customer = snapshot.customer || {};
        const payer = {
            email: customer.email || req.user.email,
            first_name: (customer.name || req.user.full_name || '').split(' ')[0],
            last_name: (customer.name || req.user.full_name || '').split(' ').slice(1).join(' ') || 'Cliente',
            identification: { type: 'CPF', number: (customer.cpf || '').replace(/\D/g, '') },
        };

        const idempotencyKey = `card-${order.id}`;
        const result = await mp.createCardPayment({
            orderId: order.id,
            orderNumber: order.order_number,
            total: order.total,
            payer,
            cardToken: card_token,
            installments: installments || 1,
            paymentMethodId: payment_method_id,
            issuerId,
            idempotencyKey,
        });

        const internalStatus = mp.mapPaymentStatus(result.mp_status);

        // Save MP data to order
        await pool.query(
            `UPDATE orders SET
                payment_provider = 'mercado_pago',
                mercado_pago_order_id = $1,
                mercado_pago_payment_id = $2,
                mercado_pago_status = $3,
                mercado_pago_status_detail = $4,
                mercado_pago_external_reference = $5,
                installments = $6,
                payment_status = $7,
                payment_updated_at = now(),
                paid_at = CASE WHEN $7 = 'approved' THEN now() ELSE paid_at END,
                status = CASE WHEN $7 = 'approved' AND status = 'recebido' THEN 'pagamento_aprovado' ELSE status END,
                updated_at = now()
             WHERE id = $8`,
            [result.mp_order_id, result.mp_payment_id, result.mp_status, result.mp_status_detail,
             result.external_reference, result.installments, internalStatus, order.id]
        );

        // Audit log
        await pool.query(
            `INSERT INTO audit_logs (action, entity_type, entity_id, changes)
             VALUES ('payment_${internalStatus}', 'order', $1, $2)`,
            [order.id, JSON.stringify({ method: 'credit_card', mp_status: result.mp_status })]
        );

        // Timeline event
        await pool.query(
            `INSERT INTO order_events (order_id, event, description)
             VALUES ($1, $2, $3)`,
            [order.id, `payment_${internalStatus}`, `Pagamento via cartão: ${result.mp_status}`]
        );

        res.json({
            order_id: order.id,
            payment_status: internalStatus,
            mp_status: result.mp_status,
            mp_status_detail: result.mp_status_detail,
            installments: result.installments,
        });
    } catch (err) {
        console.error('[Payment Card] Error:', err.message);
        res.status(err.status || 500).json({ error: err.message });
    }
});

// GET /api/orders/:id/payment/status — check payment status
router.get('/orders/:id/payment/status', auth, async (req, res) => {
    try {
        let query, params;
        if (req.user.role === 'admin') {
            query = 'SELECT * FROM orders WHERE id = $1';
            params = [req.params.id];
        } else {
            query = 'SELECT * FROM orders WHERE id = $1 AND user_id = $2';
            params = [req.params.id, req.user.id];
        }
        const { rows } = await pool.query(query, params);
        if (rows.length === 0) return res.status(404).json({ error: 'Pedido não encontrado' });

        const order = rows[0];

        const mpData = await getVerifiedPaymentForOrder(order, mp);
        const internalStatus = mp.mapPaymentStatus(mpData.mp_status);

        if (hasPaymentStateChanged(order, mpData, internalStatus)) {
            await pool.query(
                `UPDATE orders SET
                    mercado_pago_status = $1,
                    mercado_pago_status_detail = $2,
                    mercado_pago_payment_id = COALESCE($3, mercado_pago_payment_id),
                    payment_status = $4,
                    payment_updated_at = now(),
                    paid_at = CASE WHEN $4 = 'approved' AND paid_at IS NULL THEN now() ELSE paid_at END,
                    status = CASE WHEN $4 = 'approved' AND status = 'recebido' THEN 'pagamento_aprovado' ELSE status END,
                    updated_at = now()
                 WHERE id = $5`,
                [mpData.mp_status, mpData.mp_status_detail, mpData.mp_payment_id, internalStatus, order.id]
            );
        }

        res.json({
            payment_status: internalStatus,
            mp_status: mpData.mp_status,
            mp_status_detail: mpData.mp_status_detail,
            payment_method: order.payment_method,
        });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// GET /api/orders/:id/events — get order timeline events
router.get('/orders/:id/events', auth, async (req, res) => {
    try {
        let query, params;
        if (req.user.role === 'admin') {
            query = 'SELECT id FROM orders WHERE id = $1';
            params = [req.params.id];
        } else {
            query = 'SELECT id FROM orders WHERE id = $1 AND user_id = $2';
            params = [req.params.id, req.user.id];
        }
        const { rows: orderRows } = await pool.query(query, params);
        if (orderRows.length === 0) return res.status(404).json({ error: 'Pedido não encontrado' });

        const { rows: events } = await pool.query(
            'SELECT * FROM order_events WHERE order_id = $1 ORDER BY created_at ASC',
            [req.params.id]
        );
        res.json(events);
    } catch (err) { next(err); }
});

// ─── SHIPPING (Melhor Envio) ───────────────────────────────────────

// POST /api/shipping/quote — calculate freight
router.post('/shipping/quote', async (req, res) => {
    try {
        const { to_postal_code, items } = req.body;
        if (!to_postal_code) return res.status(400).json({ error: 'CEP de destino é obrigatório' });

        // Get origin CEP from settings
        const { rows: addrRows } = await pool.query("SELECT value FROM settings WHERE key = 'address'");
        const address = addrRows[0]?.value || {};
        const fromPostalCode = (address.cep || '').replace(/\D/g, '');

        if (!fromPostalCode) {
            return res.status(400).json({ error: 'CEP de origem não configurado. Configure em Admin > Configurações > Endereço.' });
        }

        // Check if Melhor Envio is enabled
        const { rows: shipRows } = await pool.query("SELECT value FROM settings WHERE key = 'shipping'");
        const shipConfig = shipRows[0]?.value || {};
        if (!shipConfig.melhor_envio_enabled) {
            return res.status(400).json({ error: 'Melhor Envio não está ativado' });
        }

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Itens do carrinho são obrigatórios' });
        }

        // Resolve package data from the catalog. The browser may only choose
        // product IDs and quantities; it must never define dimensions/value.
        const productIds = [...new Set(items.map((item) => item.productId))];
        if (productIds.some((id) => typeof id !== 'string' || !id)) {
            return res.status(400).json({ error: 'Itens de carrinho inválidos' });
        }
        const { rows: catalogProducts } = await pool.query(
            `SELECT id, weight, package_height, package_width, package_length, price, sale_price
             FROM products WHERE id = ANY($1::uuid[]) AND status = 'published'`,
            [productIds]
        );
        if (catalogProducts.length !== productIds.length) {
            return res.status(400).json({ error: 'Um ou mais produtos não estão disponíveis' });
        }
        const productsById = new Map(catalogProducts.map((product) => [product.id, product]));
        let totalValue = 0;
        const catalogItems = items.map((item) => {
            const quantity = Number.parseInt(item.qty, 10);
            const product = productsById.get(item.productId);
            if (!Number.isInteger(quantity) || quantity <= 0 || !product) {
                throw Object.assign(new Error('Quantidade de item inválida'), { status: 400 });
            }
            totalValue += Number(product.sale_price || product.price) * quantity;
            return {
                id: product.id,
                quantity,
                weight: product.weight,
                height: product.package_height,
                width: product.package_width,
                length: product.package_length,
                unit_price: Number(product.sale_price || product.price),
            };
        });
        const packages = buildShippingPackages(catalogItems);

        const options = await me.calculateShipping({
            fromPostalCode,
            toPostalCode: to_postal_code.replace(/\D/g, ''),
            products: packages,
            totalValue,
        });

        res.json({ options });
    } catch (err) {
        console.error('[Shipping Quote] Error:', err.message);
        res.status(err.status || 500).json({ error: err.message });
    }
});

// GET /api/shipping/test — test Melhor Envio connection (admin)
router.get('/shipping/test', auth, requireAdmin, async (req, res) => {
    try {
        const result = await me.testConnection();
        res.json(result);
    } catch (err) {
        res.status(500).json({ connected: false, error: err.message });
    }
});

// POST /api/orders/:id/shipping/label — generate shipping label (admin)
router.post('/orders/:id/shipping/label', auth, requireAdmin, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT pg_advisory_lock(hashtext($1))', [`shipping-label:${req.params.id}`]);

        const { rows } = await client.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Pedido não encontrado' });

        let order = assertLabelEligible(rows[0]);

        // A completed label is returned without purchasing or generating again.
        if (order.melhor_envio_shipment_id && order.shipping_status === 'generated') {
            return res.json({
                shipment_id: order.melhor_envio_shipment_id,
                tracking_code: order.tracking_code,
                message: 'Etiqueta já gerada',
            });
        }

        // Get origin address from settings
        const { rows: addrRows } = await client.query("SELECT value FROM settings WHERE key = 'address'");
        const address = addrRows[0]?.value || {};
        const { rows: senderRows } = await client.query("SELECT value FROM settings WHERE key = 'shipping_sender' AND is_public = false");
        const sender = senderRows[0]?.value || {};

        const shippingAddress = order.shipping_address || {};
        const snapshot = order.snapshot || {};
        const customer = snapshot.customer || {};
        const products = (snapshot.items || []).map(item => ({
            name: item.product_name,
            qty: item.quantity,
            price: Number(item.unit_price),
        }));

        let shipmentId = order.melhor_envio_shipment_id;
        if (!shipmentId) {
            const originPostalCode = (address.cep || '').replace(/\D/g, '');
            const senderDocument = (sender.document || '').replace(/\D/g, '');
            const senderPhone = (sender.phone || '').replace(/\D/g, '');
            if (!sender.name || !sender.email || ![10, 11].includes(senderPhone.length)
                || ![11, 14].includes(senderDocument.length) || originPostalCode.length !== 8
                || !address.street || !address.number || !address.district || !address.city
                || !/^[A-Z]{2}$/.test(address.state || '')) {
                return res.status(422).json({ error: 'Dados reais do remetente incompletos ou inválidos' });
            }
            const shipment = await me.addShipmentToCart({
                from: {
                    name: sender.name,
                    phone: senderPhone,
                    email: sender.email,
                    document: senderDocument,
                    state_register: sender.state_register || '',
                    address: address.street,
                    number: address.number,
                    complement: address.complement || '',
                    district: address.district,
                    city: address.city,
                    state: address.state,
                    postal_code: originPostalCode,
                },
                to: {
                    name: customer.name || '',
                    phone: customer.phone || '',
                    email: customer.email || '',
                    document: (customer.cpf || '').replace(/\D/g, ''),
                    address: shippingAddress.street || '',
                    number: shippingAddress.number || '',
                    district: shippingAddress.district || '',
                    city: shippingAddress.city || '',
                    state: shippingAddress.state || 'SP',
                    postal_code: (shippingAddress.cep || '').replace(/\D/g, ''),
                },
                serviceId: getPersistedShippingService(order),
                products,
                volumes: snapshot.shipping_packages,
                orderNumber: order.order_number,
                totalValue: Number(order.subtotal) - Number(order.discount),
            });
            shipmentId = shipment.shipment_id;
            await client.query(
                `UPDATE orders SET melhor_envio_shipment_id = $1, shipping_status = 'cart_created', updated_at = now() WHERE id = $2`,
                [shipmentId, order.id]
            );
            order = { ...order, melhor_envio_shipment_id: shipmentId, shipping_status: 'cart_created' };
        }

        if (order.shipping_status === 'cart_created') {
            await me.checkoutShipments([shipmentId]);
            await client.query("UPDATE orders SET shipping_status = 'purchased', updated_at = now() WHERE id = $1", [order.id]);
            order = { ...order, shipping_status: 'purchased' };
        }

        if (order.shipping_status === 'purchased') {
            await me.generateShipments([shipmentId]);
            await client.query("UPDATE orders SET shipping_status = 'generated', updated_at = now() WHERE id = $1", [order.id]);
            order = { ...order, shipping_status: 'generated' };
        }

        if (order.shipping_status !== 'generated') {
            throw Object.assign(new Error('Estado da etiqueta não permite continuar'), { status: 409 });
        }

        const printed = await me.printShipments([shipmentId]);
        const tracking = await me.getTracking(shipmentId).catch(() => ({}));
        if (tracking.tracking_code) {
            await client.query('UPDATE orders SET tracking_code = $1, updated_at = now() WHERE id = $2', [tracking.tracking_code, order.id]);
        }

        // Timeline event
        await client.query(
            `INSERT INTO order_events (order_id, event, description, metadata)
             SELECT $1, 'label_generated', 'Etiqueta gerada via Melhor Envio', $2
             WHERE NOT EXISTS (SELECT 1 FROM order_events WHERE order_id = $1 AND event = 'label_generated')`,
            [order.id, JSON.stringify({ shipment_id: shipmentId, tracking_code: tracking.tracking_code || null })]
        );

        // Audit log
        await logAudit(req.user.id, 'shipping.label_generated', 'order', order.id, { shipment_id: shipmentId }, req.ip);

        res.json({
            shipment_id: shipmentId,
            tracking_code: tracking.tracking_code || null,
            print_url: printed.print_url,
        });
    } catch (err) {
        console.error('[Shipping Label] Error:', err.message);
        res.status(err.status || 500).json({ error: err.message });
    } finally {
        if (client) {
            await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`shipping-label:${req.params.id}`]).catch(() => {});
            client.release();
        }
    }
});

// GET /api/orders/:id/tracking — get tracking info (admin or owner)
router.get('/orders/:id/tracking', auth, async (req, res) => {
    try {
        let query, params;
        if (req.user.role === 'admin') {
            query = 'SELECT * FROM orders WHERE id = $1';
            params = [req.params.id];
        } else {
            query = 'SELECT * FROM orders WHERE id = $1 AND user_id = $2';
            params = [req.params.id, req.user.id];
        }
        const { rows } = await pool.query(query, params);
        if (rows.length === 0) return res.status(404).json({ error: 'Pedido não encontrado' });

        const order = rows[0];
        if (!order.melhor_envio_shipment_id) {
            return res.json({ tracking_code: order.tracking_code, status: order.shipping_status });
        }

        const tracking = await me.getTracking(order.melhor_envio_shipment_id);
        res.json(tracking);
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

export default router;
