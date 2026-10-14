import { notificationMetadata } from '../services/notificationOutbox.js';
import { Router } from 'express';
import { withDeliveryEstimate } from '../lib/deliveryEstimate.js';
import { previewCheckout } from '../lib/checkoutPreview.js';
import { pixDiscountOffer } from '../lib/checkoutDiscount.js';
import { pool, withTransaction } from '../config/db.js';
import { auth, requireAdmin, requireSupabaseAdmin } from '../middleware.js';
import { placeOrder, cancelOrder } from '../orderService.js';
import { validateCoupon, couponPreviewSubtotal, adjustStock, logAudit } from '../services.js';
import { orderLimiter, couponLimiter } from '../middleware/rateLimiters.js';
import * as mp from '../services/mercadoPago.js';
import * as me from '../services/melhorEnvio.js';
import { operateShipping, shippingEnvironment } from '../services/shippingOperations.js';
import { buildShippingPackages } from '../lib/shipping.js';
import { getVerifiedPaymentForOrder } from '../lib/paymentVerification.js';
import { assertFulfillmentTransition } from '../lib/afterSalesPolicy.js';
import { applyVerifiedOrderInTransaction, recordVerifiedNonApprovedOrderInTransaction } from '../lib/paymentReconciliation.js';
import { createPaymentDiagnostic } from '../lib/paymentDiagnostics.js';
import { assertExpectedTransactionId, loadPaymentReconciliationPreview } from '../lib/paymentPreview.js';
import { validateCardPaymentChoice, creditInstallmentPolicy, assertSupportedInstallments } from '../lib/paymentChoice.js';
import { changeOrderPaymentMethod } from '../lib/paymentMethodChange.js';
import { getPixCapability } from '../lib/pixAvailability.js';
import { payerFromOrder } from '../lib/paymentPayer.js';
import { orderAttemptLockSql, withAttemptTransaction } from '../lib/orderAttemptLock.js';
import { paymentAttemptContext, bindPaymentAttempt } from '../lib/mercadoPagoContext.js';
import { logSafeError } from '../lib/safeErrorLog.js';
import installmentRoutes from './installments.js';
import { readInstallmentSettings, publicInstallmentPolicy } from '../lib/installmentSettings.js';
import { effectiveInstallmentPolicy, installmentOffers, confirmInstallmentOffer, installmentVersion, installmentSettingsLock, installmentError } from '../lib/installmentPolicy.js';

const router = Router();
router.use(installmentRoutes);
const publicError = error => Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
    ? (error.message || 'Requisição inválida') : 'Operação indisponível';
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
        if (req.user.role !== 'admin') {
            const { rows: maintenance } = await pool.query("SELECT value FROM settings WHERE key = 'maintenance'");
            if (maintenance[0]?.value?.maintenance_mode === true) {
                return res.status(503).json({ error: 'Loja em manutenção. Tente novamente após a reabertura.' });
            }
        }
        const idempotencyKey = req.headers['x-idempotency-key'] || req.headers['idempotency-key'];
        const order = await placeOrder(req.user.id, req.body, idempotencyKey);
        res.status(201).json(order);
    } catch (err) {
        res.status(err.status || 500).json({ error: publicError(err) });
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
        res.status(err.status || 500).json({ error: publicError(err) });
    }
});

// PATCH /api/orders/:id/status — update status (admin)
router.patch('/orders/:id/status', auth, requireAdmin, async (req, res, next) => {
    try {
        const { status, payment_status, tracking_code } = req.body;
        if (payment_status !== undefined || (status !== undefined
            && !['em_separacao', 'enviado', 'em_transporte', 'saiu_entrega', 'entregue'].includes(status))) {
            return res.status(400).json({ error: 'Pagamento e cancelamento exigem os fluxos próprios' });
        }
        if (tracking_code !== undefined && (typeof tracking_code !== 'string' || tracking_code.length > 100)) {
            return res.status(400).json({ error: 'Rastreio inválido' });
        }
        const updated = await withTransaction(async client => {
            const { rows } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [req.params.id]);
            if (!rows.length) return null;
            if (rows[0].status === 'cancelado' || rows[0].payment_status !== 'approved') {
                throw Object.assign(new Error('Pedido não elegível à expedição'), { status: 409 });
            }
            assertFulfillmentTransition(rows[0], status);
            const result = await client.query(
                `UPDATE orders SET status = COALESCE($1, status), tracking_code = COALESCE($2, tracking_code),
                 updated_at = now() WHERE id = $3 RETURNING *`,
                [status, tracking_code, req.params.id]);
            if (status && status !== rows[0].status) {
                const event = { em_separacao:'order_separation',enviado:'order_shipped',entregue:'order_delivered' }[status] || 'shipping_updated';
                await client.query('INSERT INTO order_events(order_id,event,description,metadata) VALUES($1,$2,$3,$4)',
                    [req.params.id,event,'Etapa de entrega atualizada',JSON.stringify(notificationMetadata())]);
            }
            return result.rows[0];
        });
        if (!updated) return res.status(404).json({ error: 'Pedido não encontrado' });
        await logAudit(req.user.id, 'order.update_status', 'order', req.params.id, { status }, req.ip);
        res.json(updated);
    } catch (err) { next(err); }
});

// Read-only pricing: catalog, discounts and provider quote are recalculated.
// No order, payment, coupon usage or stock movement is created here.
router.post('/checkout/preview', auth, couponLimiter, async (req, res, next) => {
    try { res.json(await previewCheckout(req.body, req.user?.id || null)); }
    catch (error) { next(error); }
});

// ─── COUPONS ───────────────────────────────────────────────────────

// POST /api/coupons/validate
router.post('/coupons/validate', couponLimiter, async (req, res, next) => {
    try {
        const { code, items } = req.body;
        if (typeof code !== 'string' || !code.trim() || code.length > 100) {
            return res.status(400).json({ error: 'Cupom inválido' });
        }
        const subtotal = await couponPreviewSubtotal(items);
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
        const { rows } = await pool.query(`
            SELECT c.*, c.created_at AS created_date,
                   (SELECT COUNT(*)::int FROM coupon_usages cu WHERE cu.coupon_id = c.id) AS uses
            FROM coupons c
            ORDER BY c.created_at DESC
        `);
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
        const result = await withTransaction(client => adjustStock(client, product_id, color_id, size, Number(new_stock), reason, req.user.id));
        await logAudit(req.user.id, 'stock.adjust', 'product', product_id, { color_id, size, ...result }, req.ip);
        res.json(result);
    } catch (err) {
        res.status(err.status || 500).json({ error: publicError(err) });
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

// GET /api/payments/methods — Orders API Pix readiness plus optional card listing
router.get('/payments/methods', auth, async (req, res) => {
    try {
        let methods = [];
        let methodListingStatus = 'available';
        try {
            methods = await mp.getPaymentMethods();
        } catch {
            // This auxiliary listing is not an Orders API Pix capability check.
            // Keep cards disabled until their current methods can be listed.
            methodListingStatus = 'unavailable';
        }
        const types = await mp.getAvailablePaymentTypes(methods);
        // Check admin settings for enabled methods
        const { rows: settingRows } = await pool.query("SELECT value FROM settings WHERE key = 'payments'");
        const payConfig = settingRows[0]?.value || {};
        const cardEnabled = payConfig.card_enabled !== false;
        const readiness = mp.getMercadoPagoReadiness();
        const pix = getPixCapability(payConfig, readiness);
        const cardConfigured = readiness.configured && readiness.public_key_configured;
        const installmentConfig = await readInstallmentSettings();

        res.json({
            available: { ...types, pix: pix.available },
            pix_discount: pixDiscountOffer(payConfig),
            pix_capability: { source: pix.source, reason: pix.reason, listed_by_payment_methods: types.pix },
            method_listing_status: methodListingStatus,
            enabled: {
                pix: pix.enabled,
                credit_card: cardConfigured && cardEnabled && types.credit_card,
                debit_card: cardConfigured && cardEnabled && payConfig.debit_card_enabled !== false && types.debit_card,
                boleto: false,
            },
            methods,
            ...(installmentConfig ? publicInstallmentPolicy(installmentConfig) : creditInstallmentPolicy(payConfig)),
            public_key: process.env.MERCADO_PAGO_PUBLIC_KEY || null,
            environment: mp.getMercadoPagoEnvironment(),
        });
    } catch (err) {
        res.status(503).json({ error: 'Não foi possível consultar as formas de pagamento no momento.' });
    }
});

// Preview and update an unstarted payment on the SAME reserved order.
for (const preview of [true, false]) {
    router.post(`/orders/:id/payment/method${preview ? '/preview' : ''}`, auth, async (req, res) => {
        try {
            const result = await changeOrderPaymentMethod(req.params.id, req.user, req.body,
                req.headers['x-idempotency-key'], { preview });
            res.json(result);
        } catch (error) { res.status(error.status || 500).json({ error: publicError(error) }); }
    });
}

// GET /api/payments/test — test MP connection (admin)
router.get('/payments/test', auth, requireAdmin, async (req, res) => {
    try {
        const result = await mp.testConnection();
        res.json(result);
    } catch (err) {
        res.status(500).json({ connected: false, error: 'Conexão indisponível' });
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
        res.status(err.status || 500).json({ error: publicError(err) });
    }
});

// POST /api/orders/:id/payment/pix — create Pix payment
router.post('/orders/:id/payment/pix', auth, async (req, res) => {
    const diagnostic = createPaymentDiagnostic(req);
    let attemptLock = null;
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
        diagnostic.setReference(order.order_number);
        if (order.payment_method !== 'pix') return res.status(409).json({ error: 'Este pedido não aceita Pix' });

        // Idempotency: if already has MP order, return existing
        if (order.status === 'cancelado') return res.status(409).json({ error: 'Pedido cancelado' });
        if (order.mercado_pago_order_id && (order.payment_attempt_method === 'pix' || order.payment_method === 'pix')) {
            return res.status(order.payment_status === 'pending' && !order.pix_qr_code ? 202 : 200).json({
                order_id: order.id,
                pix_qr_code: order.pix_qr_code,
                pix_qr_code_base64: order.pix_qr_code_base64,
                pix_expiration_at: order.pix_expiration_at,
                payment_status: order.payment_status,
                qr_unavailable: order.payment_status === 'pending' && !order.pix_qr_code,
            });
        }
        if (order.mercado_pago_order_id || order.payment_attempt_started_at || order.payment_status !== 'pending') {
            return res.status(409).json({ error: 'Pagamento existente ou em conciliação; não criar outra cobrança' });
        }
        const { rows: pixSettings } = await pool.query("SELECT value FROM settings WHERE key = 'payments'");
        if (!getPixCapability(pixSettings[0]?.value || {}, mp.getMercadoPagoReadiness()).enabled) {
            return res.status(409).json({ error: 'Pix indisponível no momento. Escolha outra forma de pagamento.' });
        }
        // Validate locally before reserving the financial attempt.
        const payer = payerFromOrder(order, req.user);
        const paymentContext = paymentAttemptContext();
        attemptLock = await pool.connect();
        await attemptLock.query(`SELECT pg_advisory_lock(${orderAttemptLockSql})`, [order.id]);
        const { rows: reserved } = await attemptLock.query(
            `UPDATE orders SET payment_attempt_started_at = now(), payment_attempt_method = 'pix'
             WHERE id = $1 AND status <> 'cancelado' AND payment_status = 'pending'
               AND mercado_pago_order_id IS NULL AND payment_attempt_started_at IS NULL
               AND payment_method = 'pix' AND total = $2 RETURNING id`,
            [order.id, order.total]);
        if (!reserved.length) return res.status(409).json({ error: 'Pagamento existente ou pedido em cancelamento' });
        await attemptLock.query("UPDATE orders SET snapshot = jsonb_set(COALESCE(snapshot,'{}'::jsonb),'{payment_context}',$2::jsonb) WHERE id = $1", [order.id, JSON.stringify(paymentContext)]);

        diagnostic.setStage('build_payload');
        const idempotencyKey = `pix-${order.id}`;
        const result = await mp.createPixPayment({
            orderId: order.id,
            orderNumber: order.order_number,
            total: order.total,
            payer,
            idempotencyKey,
            onStage: (stage, mpOrderId) => diagnostic.setStage(stage, mpOrderId),
        });
        diagnostic.setStage('validate_response', result.mp_order_id);
        if (!result.mp_order_id || result.external_reference !== order.order_number) {
            throw Object.assign(new Error('Resposta do provedor exige conciliação'), { status: 502 });
        }
        diagnostic.setStage('mp_order_readback', result.mp_order_id);
        const verified = await getVerifiedPaymentForOrder(order, mp, null, result.mp_order_id);
        const internalStatus = mp.mapPaymentStatus(verified.mp_status, verified.mp_status_detail);
        diagnostic.setStage('persist_provider_ids', result.mp_order_id);
        const outcome = await withAttemptTransaction(attemptLock, async client => {
            await bindPaymentAttempt(client, order, verified);
            const { rows: locked } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [order.id]);
            const current = locked[0];
            if (current.mercado_pago_order_id && current.mercado_pago_order_id !== result.mp_order_id) {
                throw Object.assign(new Error('Outra order MP já vinculada'), { status: 409 });
            }
            if (current.payment_status === 'approved') return 'approved';
            if (internalStatus === 'approved') {
                diagnostic.setStage('persist_payment_status', result.mp_order_id);
                const applied = await applyVerifiedOrderInTransaction(client, order.id, verified, 'pix_response');
                diagnostic.setStage('commit_transaction', result.mp_order_id);
                return applied.payment_status;
            }
            await client.query(
                `UPDATE orders SET payment_provider = 'mercado_pago', mercado_pago_order_id = $1,
                    mercado_pago_payment_id = $2, mercado_pago_status = $3, mercado_pago_status_detail = $4,
                    mercado_pago_external_reference = $5, pix_qr_code = $6, pix_qr_code_base64 = $7,
                    pix_expiration_at = $8, payment_status = $9, payment_attempt_started_at = NULL,
                    payment_updated_at = now(), updated_at = now() WHERE id = $10`,
                [verified.mp_order_id, verified.mp_payment_id, verified.mp_status, verified.mp_status_detail,
                    verified.external_reference, result.pix_qr_code, result.pix_qr_code_base64,
                    result.pix_expiration_at, internalStatus, order.id]
            );
            await client.query(
                `INSERT INTO audit_logs (action, entity_type, entity_id, changes)
                 VALUES ('payment_created', 'order', $1, $2)`,
                [order.id, JSON.stringify({ method: 'pix', mp_order_id: verified.mp_order_id })]
            );
            await client.query(
                `INSERT INTO order_events (order_id, event, description)
                 VALUES ($1, 'payment_pending', 'Pagamento Pix criado — aguardando pagamento')`,
                [order.id]
            );
            diagnostic.setStage('persist_payment_status', result.mp_order_id);
            return internalStatus;
        });
        diagnostic.setStage('response_to_client', result.mp_order_id);
        res.status(outcome === 'pending' && !result.pix_qr_code ? 202 : 200).json({
            order_id: order.id,
            pix_qr_code: result.pix_qr_code,
            pix_qr_code_base64: result.pix_qr_code_base64,
            pix_expiration_at: result.pix_expiration_at,
            payment_status: outcome,
            qr_unavailable: outcome === 'pending' && !result.pix_qr_code,
        });
    } catch (err) {
        diagnostic.logError(err);
        res.status(err.status || 500).json({ error: 'Não foi possível confirmar o pagamento; solicite conciliação' });
    } finally {
        if (attemptLock) {
            let unlockError;
            try { await attemptLock.query(`SELECT pg_advisory_unlock(${orderAttemptLockSql})`, [req.params.id]); }
            catch (error) { unlockError = error; diagnostic.logError(error); }
            finally { attemptLock.release(unlockError); }
        }
    }
});

// POST /api/orders/:id/payment/card — create card payment
router.post('/orders/:id/payment/card', auth, async (req, res) => {
    let attemptLock = null;
    let attemptReserved = false, financialExists = false;
    try {
        const { card_token, installments, payment_method_id, issuer_id, payment_type_id, bin } = req.body;

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
        financialExists = !!order.mercado_pago_order_id || !!order.payment_attempt_started_at;
        if (!['credito', 'debito'].includes(order.payment_method)) return res.status(409).json({ error: 'Este pedido não aceita pagamento com cartão' });
        if (order.status === 'cancelado') return res.status(409).json({ error: 'Pedido cancelado' });

        // Idempotency: if already has MP order with card, return status
        if (order.mercado_pago_order_id && order.payment_provider === 'mercado_pago') {
            return res.json({
                order_id: order.id,
                payment_status: order.payment_status,
                mp_status: order.mercado_pago_status,
                mp_status_detail: order.mercado_pago_status_detail,
                challenge_url: (await getVerifiedPaymentForOrder(order, mp)).challenge_url,
            });
        }
        if (order.status === 'cancelado' || order.mercado_pago_order_id
            || order.payment_attempt_started_at || order.payment_status !== 'pending') {
            return res.status(409).json({ error: 'Pagamento existente ou em conciliação; não criar outra cobrança' });
        }
        const cardReadiness = mp.getMercadoPagoReadiness();
        if (!cardReadiness.configured || !cardReadiness.public_key_configured) {
            return res.status(409).json({ error: 'Pagamento com cartão indisponível no momento.' });
        }
        const methods = await mp.getPaymentMethods();
        const { rows: paymentSettings } = await pool.query("SELECT value FROM settings WHERE key = 'payments'");
        const paymentConfig = paymentSettings[0]?.value || {};
        const managedConfig = await readInstallmentSettings();
        const managedPolicy = managedConfig ? effectiveInstallmentPolicy(managedConfig, mp.getMercadoPagoEnvironment()) : null;
        const { paymentType, installments: requestedInstallments } = validateCardPaymentChoice(
            order.payment_method, methods, payment_method_id, installments, { ...paymentConfig, ...(managedPolicy ? { max_installments: managedPolicy.max_installments } : {}) }, order.total);
        if (payment_type_id !== paymentType) return res.status(400).json({ error: 'O cartão informado não corresponde à forma de pagamento escolhida.' });
        let confirmedOffer = null;
        if (paymentType === 'credit_card' && managedConfig && requestedInstallments > 1) {
            const plans = await mp.getInstallmentPlans({ bin, amount: order.total, paymentMethodId: payment_method_id, issuerId: issuer_id });
            confirmedOffer = confirmInstallmentOffer(installmentOffers(plans, managedConfig, order.total), req.body.expected_offer, payment_method_id, issuer_id, requestedInstallments);
        } else if (paymentType === 'credit_card' && requestedInstallments > 1) {
            if (requestedInstallments > creditInstallmentPolicy(paymentConfig).max_installments) {
                return res.status(409).json({ error: 'Parcelamento sem juros ainda não aprovado para esta loja.' });
            }
            const plans = await mp.getInstallmentPlans({ bin, amount: order.total, paymentMethodId: payment_method_id, issuerId: issuer_id });
            assertSupportedInstallments(plans, requestedInstallments, order.total, { paymentMethodId: payment_method_id, issuerId: issuer_id });
        }
        const payer = payerFromOrder(order, req.user);
        const paymentContext = paymentAttemptContext();
        attemptLock = await pool.connect();
        await attemptLock.query(`SELECT pg_advisory_lock(${orderAttemptLockSql})`, [order.id]);
        if (managedConfig && paymentType === 'credit_card') {
            // Serialize policy changes with reservation; persist the immutable provider offer before any financial request.
            const reserved = await withAttemptTransaction(attemptLock, async client => {
                await client.query(`SELECT pg_advisory_xact_lock(${installmentSettingsLock})`);
                const current = await readInstallmentSettings(client);
                if (!current || installmentVersion(current) !== installmentVersion(managedConfig)
                    || (requestedInstallments > 1 && effectiveInstallmentPolicy(current, mp.getMercadoPagoEnvironment()).max_installments < requestedInstallments)) throw installmentError('As condições de parcelamento mudaram. Consulte novamente antes de confirmar.');
                const { rows: currentMethods } = await client.query("SELECT value FROM settings WHERE key = 'payments' FOR SHARE");
                validateCardPaymentChoice(order.payment_method, methods, payment_method_id, requestedInstallments,
                    { ...(currentMethods[0]?.value || {}), max_installments: effectiveInstallmentPolicy(current, mp.getMercadoPagoEnvironment()).max_installments }, order.total);
                return client.query(`UPDATE orders SET payment_attempt_started_at = now(), payment_attempt_method = 'card',
                    snapshot = jsonb_set(COALESCE(snapshot,'{}'::jsonb),'{card_installment_offer}',$4::jsonb)
                    WHERE id = $1 AND status <> 'cancelado' AND payment_status = 'pending'
                    AND mercado_pago_order_id IS NULL AND payment_attempt_started_at IS NULL
                    AND payment_method = $2 AND total = $3 RETURNING id`, [order.id, order.payment_method, order.total, JSON.stringify(confirmedOffer)]);
            });
            if (!reserved.rows.length) return res.status(409).json({ error: 'Pagamento existente ou pedido em cancelamento' });
            order.snapshot = { ...order.snapshot, card_installment_offer: confirmedOffer };
        } else {
            const { rows: reserved } = await attemptLock.query(
                `UPDATE orders SET payment_attempt_started_at = now(), payment_attempt_method = 'card'
                 WHERE id = $1 AND status <> 'cancelado' AND payment_status = 'pending'
                   AND mercado_pago_order_id IS NULL AND payment_attempt_started_at IS NULL
                   AND payment_method = $2 AND total = $3 RETURNING id`,
                [order.id, order.payment_method, order.total]);
            if (!reserved.length) return res.status(409).json({ error: 'Pagamento existente ou pedido em cancelamento' });
        }

        const idempotencyKey = `card-${order.id}`;
        await attemptLock.query("UPDATE orders SET snapshot = jsonb_set(COALESCE(snapshot,'{}'::jsonb),'{payment_context}',$2::jsonb) WHERE id = $1", [order.id, JSON.stringify(paymentContext)]);
        attemptReserved = true;
        const result = await mp.createCardPayment({
            orderId: order.id,
            orderNumber: order.order_number,
            total: order.total,
            payer,
            cardToken: card_token,
            installments: requestedInstallments,
            paymentMethodId: payment_method_id,
            paymentType,
            issuerId: issuer_id,
            idempotencyKey,
        });
        if (!result.mp_order_id || result.external_reference !== order.order_number) {
            return res.status(502).json({ error: 'Resposta do provedor exige conciliação manual' });
        }

        const verified = await getVerifiedPaymentForOrder(order, mp, null, result.mp_order_id);
        if (verified.payment_method_type && verified.payment_method_type !== paymentType) {
            throw Object.assign(new Error('Tipo de pagamento do provedor exige conciliação'), { status: 409 });
        }
        const internalStatus = mp.mapPaymentStatus(verified.mp_status, verified.mp_status_detail);
        const persisted = await withAttemptTransaction(attemptLock, async client => {
            await bindPaymentAttempt(client, order, verified);
            const applied = internalStatus === 'approved'
                ? await applyVerifiedOrderInTransaction(client, order.id, verified, 'card_response')
                : await recordVerifiedNonApprovedOrderInTransaction(client, order.id, verified, 'card_response');
            if (applied.outcome === 'applied') {
                await client.query('UPDATE orders SET installments = $1 WHERE id = $2', [result.installments, order.id]);
            }
            return applied;
        });

        res.json({
            order_id: order.id,
            payment_status: persisted.payment_status,
            mp_status: verified.mp_status,
            mp_status_detail: verified.mp_status_detail,
            installments: result.installments,
            challenge_url: verified.challenge_url,
        });
    } catch (err) {
        console.error('[Payment Card] Provider status:', err.status || 500);
        res.status(err.status || 500).json({ attempt_started: attemptReserved || financialExists,
            error: Number.isInteger(err.status) && err.status >= 400 && err.status < 500 && !err.mpError ? err.message : 'Não foi possível confirmar o pagamento; solicite conciliação' });
    } finally {
        if (attemptLock) {
            let unlockError;
            try { await attemptLock.query(`SELECT pg_advisory_unlock(${orderAttemptLockSql})`, [req.params.id]); }
            catch (error) { unlockError = error; logSafeError('payment_card_unlock_failed', error); }
            finally { attemptLock.release(unlockError); }
        }
    }
});

// TEST-only preview. This path never writes to the store or Mercado Pago.
async function paymentReconciliationPreview(req, res) {
    try {
        const { preview } = await loadPaymentReconciliationPreview(
            pool, mp, req.params.orderId || req.params.id, req.query.mp_order_id);
        res.json(preview);
    } catch (err) {
        const status = err.mpError ? 502 : (err.status || 500);
        res.status(status).json({ error: [400, 404, 409].includes(status) ? err.message : 'Prévia de conciliação indisponível' });
    }
}
router.get('/admin/orders/:orderId/payment-reconciliation-preview', auth, requireSupabaseAdmin, paymentReconciliationPreview);
router.get('/orders/:id/payment/reconciliation-preview', auth, requireSupabaseAdmin, paymentReconciliationPreview);

// Explicit admin action; never creates a payment or changes stock.
router.post('/orders/:id/payment/reconcile', auth, requireSupabaseAdmin, async (req, res) => {
    try {
        const result = await withTransaction(async client => {
            const { rows } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [req.params.id]);
            if (!rows.length) throw Object.assign(new Error('Pedido não encontrado'), { status: 404 });
            const { preview, provider } = await loadPaymentReconciliationPreview(
                client, mp, req.params.id, req.body?.mp_order_id, rows[0]);
            assertExpectedTransactionId(provider, req.body?.expected_mp_payment_id);
            if (!preview.safe_to_reconcile) {
                if (rows[0].payment_status === 'approved' && rows[0].paid_at
                    && rows[0].status === 'pagamento_aprovado'
                    && rows[0].mercado_pago_order_id === provider.mp_order_id
                    && rows[0].mercado_pago_payment_id === provider.mp_payment_id
                    && ['reference_match', 'amount_match', 'currency_match', 'provider_order_id_match',
                        'single_transaction', 'approved_at_provider', 'ids_compatible',
                        'no_refund_in_flight'].every(check => preview.checks[check])) {
                    return { outcome: 'already_reconciled', payment_status: 'approved' };
                }
                throw Object.assign(new Error('Prévia atual não autoriza conciliação'), { status: 409 });
            }
            return applyVerifiedOrderInTransaction(client, rows[0].id, provider, 'admin');
        });
        res.json(result);
    } catch (err) {
        const status = err.mpError ? 502 : (err.status || 500);
        res.status(status).json({ error: [400, 404, 409].includes(status) ? err.message : 'Conciliação indisponível' });
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
        const internalStatus = mp.mapPaymentStatus(mpData.mp_status, mpData.mp_status_detail);

        const result = await withTransaction(client => internalStatus === 'approved'
            ? applyVerifiedOrderInTransaction(client, order.id, mpData, 'status_poll')
            : recordVerifiedNonApprovedOrderInTransaction(client, order.id, mpData, 'status_poll'));

        res.json({
            payment_status: result.payment_status,
            mp_status: mpData.mp_status,
            mp_status_detail: mpData.mp_status_detail,
            payment_method: order.payment_method,
            challenge_url: mpData.challenge_url,
        });
    } catch (err) {
        res.status(err.status || 500).json({ error: publicError(err) });
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
        if (String(to_postal_code || '').replace(/\D/g, '').length !== 8) return res.status(400).json({ error: 'CEP de destino inválido' });

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
            const quantity = Number(item.qty);
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

        res.json({ options: options.map(option => withDeliveryEstimate(option, shipConfig)) });
    } catch (err) {
        logSafeError('shipping_quote_failed', err);
        res.status(err.status || 500).json({ error: publicError(err) });
    }
});

// GET /api/shipping/test — test Melhor Envio connection (admin)
router.get('/shipping/test', auth, requireAdmin, async (req, res) => {
    try {
        const result = await me.testConnection();
        res.json(result);
    } catch (err) {
        res.status(500).json({ connected: false, error: 'Conexão indisponível' });
    }
});

// Each operation is explicit; preparing never purchases a label.
router.post('/orders/:id/shipping/label', auth, requireSupabaseAdmin, async (req, res) => {
    try {
        res.json(await operateShipping(req.params.id, req.body?.action || 'prepare', req.body || {}, req.user.id));
    } catch (err) {
        logSafeError('shipping_label_failed', err);
        res.status(err.status || 500).json({ error: publicError(err) });
    }
});

router.get('/orders/:id/shipping/readiness', auth, requireSupabaseAdmin, async (req, res, next) => {
    try {
        const { rows } = await pool.query('SELECT snapshot, shipping_status FROM orders WHERE id=$1', [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'Pedido não encontrado' });
        res.json({ environment: rows[0].snapshot?.shipping_environment || null,
            status: rows[0].shipping_status, price: rows[0].snapshot?.shipping_operation?.price ?? null,
            purchase_enabled: process.env.SHIPPING_LABEL_PURCHASE_ENABLED === 'true' });
    } catch (err) { next(err); }
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

        const tracking = await me.getTracking(order.melhor_envio_shipment_id, shippingEnvironment(order));
        res.json(tracking);
    } catch (err) {
        res.status(err.status || 500).json({ error: publicError(err) });
    }
});

export default router;
