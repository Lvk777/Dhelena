import { Router } from 'express';
import { pool } from '../config/db.js';
import { auth, requireAdmin } from '../middleware.js';
import {
    advanceReturn, cancelPaidOrder, cancelPendingProviderOrder, createReturn, reconcileRefund, requestRefund,
} from '../afterSalesService.js';

const router = Router();
router.use('/orders', auth, (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Autenticação necessária' });
    next();
});

const replyError = (res, error) => res.status(error.status || 500).json({
    error: error.status ? error.message : 'Falha no processamento de pós-venda',
});

router.get('/orders/:id/after-sales', async (req, res) => {
    try {
        const own = req.user.role === 'admin' ? '' : ' AND user_id = $2';
        const params = req.user.role === 'admin' ? [req.params.id] : [req.params.id, req.user.id];
        const { rows } = await pool.query(`SELECT id FROM orders WHERE id = $1${own}`, params);
        if (!rows.length) return res.status(404).json({ error: 'Pedido não encontrado' });
        const returns = await pool.query(
            `SELECT r.id, r.status, r.reason, r.created_at, r.received_at,
                COALESCE(json_agg(json_build_object('order_item_id', ri.order_item_id,
                'quantity', ri.quantity, 'restockable', ri.restockable,
                'return_item_id', ri.id)) FILTER (WHERE ri.id IS NOT NULL), '[]') AS items
             FROM order_returns r LEFT JOIN order_return_items ri ON ri.return_id = r.id
             WHERE r.order_id = $1 GROUP BY r.id ORDER BY r.created_at`, [req.params.id]);
        const refundReason = req.user.role === 'admin' ? 'reason' : 'NULL::text AS reason';
        const refunds = await pool.query(
            `SELECT id, kind, amount, status, provider_refund_id, provider_status,
                    ${refundReason}, created_at, processed_at
             FROM order_refunds WHERE order_id = $1 ORDER BY created_at`, [req.params.id]);
        res.json({ returns: returns.rows, refunds: refunds.rows,
            ...(req.user.role === 'admin' ? {
                refunds_enabled: process.env.AFTER_SALES_REFUNDS_ENABLED === 'true',
                pending_cancellation_enabled: process.env.AFTER_SALES_CANCELLATIONS_ENABLED === 'true',
            } : {}) });
    } catch (error) { replyError(res, error); }
});

router.post('/orders/:id/returns', async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            const { rows } = await pool.query('SELECT id FROM orders WHERE id = $1 AND user_id = $2',
                [req.params.id, req.user.id]);
            if (!rows.length) return res.status(404).json({ error: 'Pedido não encontrado' });
        }
        const result = await createReturn(req.params.id, req.user.id, req.body?.items, req.body?.reason);
        res.status(201).json(result);
    } catch (error) { replyError(res, error); }
});

router.patch('/orders/:id/returns/:returnId', requireAdmin, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT id FROM order_returns WHERE id = $1 AND order_id = $2',
            [req.params.returnId, req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'Devolução não encontrada' });
        const result = await advanceReturn(req.params.returnId, req.user.id,
            req.body?.status, req.body?.restockable || {});
        res.json(result);
    } catch (error) { replyError(res, error); }
});

router.post('/orders/:id/refunds', requireAdmin, async (req, res) => {
    try {
        const result = await requestRefund(req.params.id, req.user.id, req.body,
            req.get('X-Idempotency-Key'));
        res.status(result.status === 'processed' ? 200 : 202).json(result);
    } catch (error) { replyError(res, error); }
});

router.post('/orders/:id/refunds/:refundId/reconcile', requireAdmin, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT id FROM order_refunds WHERE id = $1 AND order_id = $2',
            [req.params.refundId, req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'Reembolso não encontrado' });
        const result = await reconcileRefund(req.params.refundId, req.user.id);
        res.json(result);
    } catch (error) { replyError(res, error); }
});

router.post('/orders/:id/cancel-after-refund', requireAdmin, async (req, res) => {
    try { res.json(await cancelPaidOrder(req.params.id, req.user.id)); }
    catch (error) { replyError(res, error); }
});

router.post('/orders/:id/cancel-pending-payment', requireAdmin, async (req, res) => {
    try { res.json(await cancelPendingProviderOrder(req.params.id, req.user.id)); }
    catch (error) { replyError(res, error); }
});

export default router;
