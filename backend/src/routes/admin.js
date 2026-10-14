import { Router } from 'express';
import { pool } from '../config/db.js';
import { auth, requireAdmin } from '../middleware.js';
import { notificationSchemaReady } from '../services/notificationOutbox.js';
import { orderEmailReadiness } from '../services/orderEmail.js';
import { readAdminAccess, changeAdminAccess } from '../services/adminAccess.js';

const router = Router();
router.get('/admin/access', auth, requireAdmin, async (req,res,next) => {
    try { res.json(await readAdminAccess({ ...req.user, authProvider: req.authProvider, identityVerified: req.supabaseUserId === req.user.id || req.user.identity_linked === true })); } catch (error) { next(error); }
});
router.patch('/admin/access/:id', auth, requireAdmin, async (req,res,next) => {
    try { res.json(await changeAdminAccess({ ...req.user, authProvider: req.authProvider, identityVerified: req.supabaseUserId === req.user.id || req.user.identity_linked === true }, req.params.id, req.body)); } catch (error) { next(error); }
});
router.get('/notifications/readiness',auth,requireAdmin,async(req,res,next)=>{
    try {
        const {rows}=await pool.query("SELECT key,value FROM settings WHERE key IN ('emails','general')");
        res.json({...orderEmailReadiness(Object.fromEntries(rows.map(r=>[r.key,r.value]))),
            delivery_enabled:process.env.TRANSACTIONAL_EMAIL_ENABLED==='true',outbox_schema_ready:await notificationSchemaReady(),
            environment:process.env.TRANSACTIONAL_EMAIL_ENVIRONMENT||'production',auth_email_provider:'supabase_smtp_separate'});
    }catch(err){next(err);}
});

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
            'SELECT id,order_id,event,channel,recipient,status,attempts,error,sent_at,created_at as created_date FROM notification_logs ORDER BY created_at DESC LIMIT 200'
        );
        res.json(rows);
    } catch (err) { next(err); }
});

// POST /api/notifications/resend — resend (admin)
router.post('/notifications/resend', auth, requireAdmin, async (req, res, next) => {
    try {
        if(process.env.TRANSACTIONAL_EMAIL_ENABLED!=='true'||!await notificationSchemaReady())return res.status(403).json({error:'Envios desabilitados até homologação.'});
        const {order_id,event,channel,recipient}=req.body;
        const result=await pool.query(`UPDATE notification_logs SET status='pending',next_attempt_at=now()
            WHERE order_id=$1 AND event=$2 AND channel=$3 AND recipient=$4 AND status='failed'
            AND source_event_id IS NOT NULL AND delivery_payload IS NOT NULL
            AND COALESCE(error,'') NOT IN ('EMAIL_IDEMPOTENCY_EXPIRED','EMAIL_PAYLOAD_CONFLICT')
            AND (first_attempt_at IS NULL OR first_attempt_at>now()-interval '23 hours') RETURNING id`,[order_id,event,channel,recipient]);
        if(!result.rowCount)return res.status(409).json({error:'Mensagem entregue, legada ou pendente de análise; não será reenviada automaticamente.'});
        res.json({success:true});
    } catch (err) { next(err); }
});

export default router;
