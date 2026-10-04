import { Router } from 'express';
import { pool } from '../config/db.js';
import { auth, requireAdmin } from '../middleware.js';
import {
    advanceReturn, cancelPaidOrder, cancelPendingProviderOrder, createReturn, reconcileRefund, requestRefund,
} from '../afterSalesService.js';
import { loadRefundPreview } from '../lib/refundPreview.js';

const router = Router();
router.use('/orders', auth, (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Autenticação necessária' });
    next();
});

const replyError = (res, error) => res.status(error.status || 500).json({
    error: error.status ? error.message : 'Falha no processamento de pós-venda',
});

async function physicalSchemaReady() {
    try {
        await Promise.all([
            pool.query('SELECT authorized_at FROM order_returns LIMIT 0'),
            pool.query('SELECT condition_note FROM order_return_items LIMIT 0'),
        ]);
        return true;
    } catch (error) {
        if (error.code === '42703') return false;
        throw error;
    }
}

router.get('/orders/:id/after-sales', async (req, res) => {
    try {
        const own = req.user.role === 'admin' ? '' : ' AND user_id = $2';
        const params = req.user.role === 'admin' ? [req.params.id] : [req.params.id, req.user.id];
        const { rows } = await pool.query(`SELECT id FROM orders WHERE id = $1${own}`, params);
        if (!rows.length) return res.status(404).json({ error: 'Pedido não encontrado' });
        const schemaReady = await physicalSchemaReady();
        const returns = schemaReady ? await pool.query(
            `SELECT r.id, r.status, r.reason, r.created_at, r.updated_at, r.authorized_at,
                r.awaiting_post_at, r.posted_at, r.in_transit_at, r.received_at, r.closed_at,
                r.posting_instructions, r.reverse_tracking_code, r.reverse_posting_code,
                ${req.user.role === 'admin' ? 'r.reverse_shipment_id,' : ''}
                COALESCE((SELECT json_agg(json_build_object(
                    'order_item_id', ri.order_item_id, 'quantity', ri.quantity,
                    'restockable', ${req.user.role === 'admin' ? 'ri.restockable' : 'NULL::boolean'},
                    'condition_note', ${req.user.role === 'admin' ? 'ri.condition_note' : 'NULL::text'},
                    'return_item_id', ri.id, 'stock_restored', ${req.user.role === 'admin'
                        ? 'EXISTS (SELECT 1 FROM stock_restorations sr WHERE sr.return_item_id = ri.id)'
                        : 'NULL::boolean'}))
                    FROM order_return_items ri WHERE ri.return_id = r.id), '[]'::json) AS items,
                COALESCE((SELECT json_agg(json_build_object('id', rf.id, 'status', rf.status,
                    'amount', rf.amount, 'provider_refund_id', rf.provider_refund_id))
                    FROM order_refunds rf WHERE rf.return_id = r.id), '[]'::json) AS related_refunds
             FROM order_returns r WHERE r.order_id = $1 ORDER BY r.created_at`, [req.params.id])
            : await pool.query(
                `SELECT r.id, r.status, r.reason, r.created_at, r.updated_at, r.received_at,
                    COALESCE(json_agg(json_build_object('order_item_id', ri.order_item_id,
                    'quantity', ri.quantity, 'restockable', ri.restockable,
                    'return_item_id', ri.id, 'stock_restored', EXISTS (
                        SELECT 1 FROM stock_restorations sr WHERE sr.return_item_id = ri.id)))
                    FILTER (WHERE ri.id IS NOT NULL), '[]') AS items
                 FROM order_returns r LEFT JOIN order_return_items ri ON ri.return_id = r.id
                 WHERE r.order_id = $1 GROUP BY r.id ORDER BY r.created_at`, [req.params.id]);
        const refundReason = req.user.role === 'admin' ? 'reason' : 'NULL::text AS reason';
        const refunds = await pool.query(
            `SELECT id, kind, amount, status, provider_refund_id, provider_status,
                    ${refundReason}, created_at, processed_at
             FROM order_refunds WHERE order_id = $1 ORDER BY created_at`, [req.params.id]);
        res.json({ returns: returns.rows, refunds: refunds.rows, physical_schema_ready: schemaReady,
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
        if (!await physicalSchemaReady()) return res.status(503).json({ error: 'Migração física 012 pendente' });
        const result = await createReturn(req.params.id, req.user.id, req.body?.items, req.body?.reason);
        res.status(201).json(result);
    } catch (error) { replyError(res, error); }
});

router.patch('/orders/:id/returns/:returnId', requireAdmin, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT id FROM order_returns WHERE id = $1 AND order_id = $2',
            [req.params.returnId, req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'Devolução não encontrada' });
        if (!await physicalSchemaReady()) return res.status(503).json({ error: 'Migração física 012 pendente' });
        const result = await advanceReturn(req.params.returnId, req.user.id,
            req.body?.status, req.body?.restockable || {}, {
                expectedOrderId: req.params.id,
                conditionNotes: req.body?.conditionNotes,
                postingInstructions: req.body?.postingInstructions,
                reverseTrackingCode: req.body?.reverseTrackingCode,
                reversePostingCode: req.body?.reversePostingCode,
            });
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

router.get('/orders/:id/refunds/preview', requireAdmin, async (req, res) => {
    try {
        if (Object.keys(req.query).length) return res.status(400).json({ error: 'A prévia calcula o saldo no servidor' });
        const result = await loadRefundPreview(req.params.id);
        res.json(result);
    } catch (error) {
        if (error.mpError) return res.status(502).json({ error: 'Prévia Mercado Pago indisponível' });
        replyError(res, error);
    }
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
