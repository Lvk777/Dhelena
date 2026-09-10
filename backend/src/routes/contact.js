import { Router } from 'express';
import { pool } from '../config/db.js';
import { contactLimiter } from '../middleware/rateLimiters.js';
import { logSecurityEvent } from '../middleware/securityLog.js';

const router = Router();

// ─── Sanitization helper ──────────────────────────────────────────
function sanitize(str, maxLen = 1000) {
    if (typeof str !== 'string') return '';
    // Strip HTML tags
    return str.replace(/<[^>]*>/g, '').trim().slice(0, maxLen);
}

// ─── Validate email ───────────────────────────────────────────────
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 256;
}

// ─── POST /api/contact ────────────────────────────────────────────
router.post('/contact', contactLimiter, async (req, res, next) => {
    try {
        const { name, email, subject, message, website } = req.body;

        // ── Honeypot: if "website" field is filled, it's a bot ──
        if (website && website.trim() !== '') {
            // Pretend success to not tip off the bot
            logSecurityEvent(req, 'suspicious_request', { reason: 'honeypot_triggered' });
            return res.status(201).json({ success: true });
        }

        // ── Server-side validation ──
        if (!name || !email || !message) {
            return res.status(400).json({ error: 'Nome, e-mail e mensagem são obrigatórios' });
        }

        const safeName = sanitize(name, 256);
        const safeEmail = sanitize(email, 256);
        const safeSubject = sanitize(subject, 256);
        const safeMessage = sanitize(message, 5000);

        if (!isValidEmail(safeEmail)) {
            return res.status(400).json({ error: 'E-mail inválido' });
        }

        if (safeMessage.length < 10) {
            return res.status(400).json({ error: 'Mensagem muito curta (mínimo 10 caracteres)' });
        }

        // ── Per-email cooldown: 1 message per email per 5 minutes ──
        const { rows: recent } = await pool.query(
            `SELECT created_at FROM contact_messages
             WHERE email = $1 AND created_at > now() - interval '5 minutes'
             ORDER BY created_at DESC LIMIT 1`,
            [safeEmail]
        );
        if (recent.length > 0) {
            return res.status(429).json({ error: 'Você enviou uma mensagem recentemente. Aguarde alguns minutos.' });
        }

        // ── Store message ──
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
        const { rows } = await pool.query(
            `INSERT INTO contact_messages (name, email, subject, message, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
            [safeName, safeEmail, safeSubject, safeMessage, ip, (req.headers['user-agent'] || '').slice(0, 512)]
        );

        res.status(201).json({ success: true, id: rows[0].id });
    } catch (err) { next(err); }
});

// ─── GET /api/contact/messages (admin) ────────────────────────────
router.get('/contact/messages', async (req, res, next) => {
    // Inline admin check — requires auth
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Acesso restrito' });
    }
    try {
        const { rows } = await pool.query(
            'SELECT id, name, email, subject, message, created_at FROM contact_messages ORDER BY created_at DESC LIMIT 100'
        );
        res.json(rows);
    } catch (err) { next(err); }
});

export default router;
