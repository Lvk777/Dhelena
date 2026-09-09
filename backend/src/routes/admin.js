import { Router } from 'express';
import { pool } from '../config/db.js';
import { auth, requireAdmin } from '../middleware.js';

const router = Router();

// GET /api/users — list customers (admin)
router.get('/users', auth, requireAdmin, async (req, res, next) => {
    try {
        const { rows } = await pool.query(
            'SELECT id, email, full_name, phone, role, created_at as created_date FROM profiles ORDER BY created_at DESC'
        );
        res.json(rows);
    } catch (err) { next(err); }
});

// GET /api/audit-logs — list (admin)
router.get('/audit-logs', auth, requireAdmin, async (req, res, next) => {
    try {
        const { rows } = await pool.query(
            'SELECT *, created_at as created_date FROM audit_logs ORDER BY created_at DESC LIMIT 200'
        );
        res.json(rows);
    } catch (err) { next(err); }
});

// GET /api/notifications — list (admin)
router.get('/notifications', auth, requireAdmin, async (req, res, next) => {
    try {
        const { rows } = await pool.query(
            'SELECT *, created_at as created_date FROM notification_logs ORDER BY created_at DESC LIMIT 200'
        );
        res.json(rows);
    } catch (err) { next(err); }
});

// POST /api/notifications/resend — resend (admin)
router.post('/notifications/resend', auth, requireAdmin, async (req, res, next) => {
    try {
        const { order_id, event, channel, recipient } = req.body;
        await pool.query(
            `UPDATE notification_logs SET status = 'pending', error = NULL
             WHERE order_id = $1 AND event = $2 AND channel = $3 AND recipient = $4 AND status != 'sent'`,
            [order_id, event, channel, recipient]
        );
        // Trigger retry
        const { sendOrderNotifications } = await import('../services.js');
        sendOrderNotifications(order_id, event).catch(() => {});
        res.json({ success: true });
    } catch (err) { next(err); }
});

export default router;
