import { Router } from 'express';
import { pool } from '../config/db.js';
import { auth, requireAdmin } from '../middleware.js';
import { placeOrder, cancelOrder } from '../orderService.js';
import { validateCoupon, adjustStock, logAudit } from '../services.js';

const router = Router();

// ─── ORDERS ────────────────────────────────────────────────────────

// POST /api/orders — placeOrder
router.post('/orders', auth, async (req, res) => {
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
router.post('/coupons/validate', async (req, res, next) => {
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

export default router;
