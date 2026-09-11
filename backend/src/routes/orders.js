import { Router } from 'express';
import { pool } from '../config/db.js';
import { auth, requireAdmin } from '../middleware.js';
import { placeOrder, cancelOrder } from '../orderService.js';
import { validateCoupon, adjustStock, logAudit } from '../services.js';
import { orderLimiter, couponLimiter } from '../middleware/rateLimiters.js';
import * as mp from '../services/mercadoPago.js';
import * as me from '../services/melhorEnvio.js';

const router = Router();

// ─── ORDERS ────────────────────────────────────────────────────────

// POST /api/orders — placeOrder
router.post('/orders', auth, orderLimiter, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'É necessário estar autenticado para criar um pedido' });
    try {
        const idempotencyKey = req.headers['idempotency-key'] || null;
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
        const reserved = ['id', 'created_at', 'updated_at'];
        const keys = Object.keys(req.body).filter(k => !reserved.includes(k));
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
            environment: process.env.MERCADO_PAGO_ACCESS_TOKEN?.startsWith('TEST-') ? 'Teste' : 'Produção',
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
            paymentMethodId,
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

        // If we have MP order ID, query MP for latest status
        if (order.mercado_pago_order_id) {
            try {
                const mpData = await mp.getOrderStatus(order.mercado_pago_order_id);
                const internalStatus = mp.mapPaymentStatus(mpData.mp_status);

                // Update if status changed
                if (mpData.mp_status !== order.mercado_pago_status) {
                    await pool.query(
                        `UPDATE orders SET
                            mercado_pago_status = $1,
                            payment_status = $2,
                            payment_updated_at = now(),
                            paid_at = CASE WHEN $2 = 'approved' AND paid_at IS NULL THEN now() ELSE paid_at END,
                            status = CASE WHEN $2 = 'approved' AND status = 'recebido' THEN 'pagamento_aprovado' ELSE status END,
                            updated_at = now()
                         WHERE id = $3`,
                        [mpData.mp_status, internalStatus, order.id]
                    );
                }

                return res.json({
                    payment_status: internalStatus,
                    mp_status: mpData.mp_status,
                    mp_status_detail: order.mercado_pago_status_detail,
                    payment_method: order.payment_method,
                });
            } catch (e) {
                // Fall back to stored status
            }
        }

        res.json({
            payment_status: order.payment_status,
            mp_status: order.mercado_pago_status,
            mp_status_detail: order.mercado_pago_status_detail,
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
        const { to_postal_code, products, total_value } = req.body;
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

        const options = await me.calculateShipping({
            fromPostalCode,
            toPostalCode: to_postal_code.replace(/\D/g, ''),
            products: products || [],
            totalValue: total_value || 0,
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
    try {
        const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Pedido não encontrado' });

        const order = rows[0];

        // Verify payment is approved
        if (order.payment_status !== 'approved') {
            return res.status(400).json({ error: 'Pagamento não confirmado. Gere a etiqueta apenas após o pagamento ser aprovado.' });
        }

        // Idempotency: if already has shipment ID, return existing
        if (order.melhor_envio_shipment_id) {
            return res.json({
                shipment_id: order.melhor_envio_shipment_id,
                tracking_code: order.tracking_code,
                message: 'Etiqueta já gerada',
            });
        }

        // Get origin address from settings
        const { rows: addrRows } = await pool.query("SELECT value FROM settings WHERE key = 'address'");
        const address = addrRows[0]?.value || {};
        const { rows: genRows } = await pool.query("SELECT value FROM settings WHERE key = 'general'");
        const general = genRows[0]?.value || {};

        // Get order items
        const { rows: items } = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);

        const shippingAddress = order.shipping_address || {};
        const snapshot = order.snapshot || {};
        const customer = snapshot.customer || {};

        const labels = await me.generateLabel({
            from: {
                name: general.store_name || 'D\'Helenas',
                phone: general.phone || '',
                email: general.email || '',
                document: general.cnpj || general.cpf || '',
                address: address.street || '',
                number: address.number || '',
                district: address.district || '',
                city: address.city || '',
                state: address.state || 'SP',
                postal_code: (address.cep || '').replace(/\D/g, ''),
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
            serviceId: req.body.service_id || order.shipping_quote_id,
            products: items.map(i => ({ name: i.product_name, qty: i.quantity, price: Number(i.unit_price) })),
            orderNumber: order.order_number,
            totalValue: Number(order.total),
        });

        if (labels.length === 0) throw new Error('Nenhuma etiqueta gerada');

        const label = labels[0];

        // Save shipping info to order
        await pool.query(
            `UPDATE orders SET
                melhor_envio_shipment_id = $1,
                tracking_code = $2,
                shipping_status = 'generated',
                posted_at = CASE WHEN $2 IS NOT NULL THEN now() ELSE posted_at END,
                updated_at = now()
             WHERE id = $3`,
            [label.shipment_id, label.tracking_code, order.id]
        );

        // Timeline event
        await pool.query(
            `INSERT INTO order_events (order_id, event, description, metadata)
             VALUES ($1, 'label_generated', 'Etiqueta gerada via Melhor Envio', $2)`,
            [order.id, JSON.stringify({ shipment_id: label.shipment_id, tracking_code: label.tracking_code })]
        );

        // Audit log
        await logAudit(req.user.id, 'shipping.label_generated', 'order', order.id, { shipment_id: label.shipment_id }, req.ip);

        res.json({
            shipment_id: label.shipment_id,
            tracking_code: label.tracking_code,
            print_url: label.print_url,
        });
    } catch (err) {
        console.error('[Shipping Label] Error:', err.message);
        res.status(err.status || 500).json({ error: err.message });
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
