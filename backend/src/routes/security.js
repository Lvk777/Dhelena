import { Router } from 'express';
import { pool } from '../config/db.js';
import { auth, requireAdmin } from '../middleware.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { logSecurityEvent } from '../middleware/securityLog.js';
import crypto from 'crypto';

const router = Router();

// Helper: log admin actions to audit_logs
async function logAdminAction(req, action, entityType, entityId, entityName, details) {
    try {
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
        await pool.query(
            `INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, changes, ip_address)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [req.user?.id || null, action, entityType, entityId, JSON.stringify({ entity_name: entityName, details }), ip]
        );
    } catch (err) {
        console.error('[AuditLog] Failed:', err.message);
    }
}

// ─── TOTP helpers ─────────────────────────────────────────────────
function generateTotpSecret() {
    return crypto.randomBytes(20).toString('base64url');
}

function generateQrUrl(secret, email) {
    const issuer = encodeURIComponent("D'Helenas");
    const label = encodeURIComponent(`${issuer}:${email}`);
    // Use otpauth URI format — authenticator apps understand this
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`)}`;
}

function generateRecoveryCodes() {
    const codes = [];
    for (let i = 0; i < 8; i++) {
        codes.push(crypto.randomBytes(5).toString('hex').toUpperCase().match(/.{4}/g).join('-'));
    }
    return codes;
}

function verifyTotpCode(secret, token) {
    // Simple TOTP verification using HMAC-SHA1
    const window = 1; // Allow 1 step before/after
    const step = 30;
    const counter = Math.floor(Date.now() / 1000 / step);
    for (let i = -window; i <= window; i++) {
        const testCounter = counter + i;
        const buf = Buffer.alloc(8);
        buf.writeBigUInt64BE(BigInt(testCounter));
        const key = Buffer.from(secret, 'base64url');
        const hmac = crypto.createHmac('sha1', key).update(buf).digest();
        const offset = hmac[hmac.length - 1] & 0xf;
        const code = ((hmac[offset] & 0x7f) << 24 | (hmac[offset + 1] & 0xff) << 16 | (hmac[offset + 2] & 0xff) << 8 | (hmac[offset + 3] & 0xff)).toString().padStart(6, '0').slice(-6);
        if (code === token) return true;
    }
    return false;
}

// ─── Parse device info from user-agent ────────────────────────────
function parseUserAgent(ua) {
    const uaLower = (ua || '').toLowerCase();
    let device_type = 'desktop';
    if (/mobile|android.*mobile|iphone|ipod/.test(uaLower)) device_type = 'mobile';
    else if (/ipad|tablet|android(?!.*mobile)/.test(uaLower)) device_type = 'tablet';
    let browser = 'other';
    if (/edg/.test(uaLower)) browser = 'edge';
    else if (/chrome|crios/.test(uaLower)) browser = 'chrome';
    else if (/safari/.test(uaLower)) browser = 'safari';
    else if (/firefox/.test(uaLower)) browser = 'firefox';
    let os = 'other';
    if (/windows/.test(uaLower)) os = 'windows';
    else if (/mac os|macintosh|iphone|ipad/.test(uaLower)) os = 'macos';
    else if (/android/.test(uaLower)) os = 'android';
    else if (/linux/.test(uaLower)) os = 'linux';
    return { device_type, browser, os };
}

function maskIp(ip) {
    if (!ip) return 'unknown';
    if (ip.includes('.')) {
        const parts = ip.split('.');
        if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
    }
    if (ip.includes(':')) return ip.split(':').slice(0, 2).join(':') + ':xxxx';
    return 'unknown';
}

// ─── GET /api/security/status ─────────────────────────────────────
router.get('/security/status', auth, async (req, res, next) => {
    try {
        const { rows } = await pool.query(
            'SELECT totp_enabled, require_2fa FROM profiles WHERE id = $1',
            [req.user.id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json({
            enabled: rows[0].totp_enabled,
            require_2fa_admin: rows[0].require_2fa,
        });
    } catch (err) { next(err); }
});

// ─── POST /api/security/setup-2fa ──────────────────────────────────
router.post('/security/setup-2fa', auth, async (req, res, next) => {
    try {
        const secret = generateTotpSecret();
        const encrypted = encrypt(secret);
        // Store temporarily (not yet enabled)
        await pool.query(
            'UPDATE profiles SET totp_secret_encrypted = $1 WHERE id = $2',
            [encrypted, req.user.id]
        );
        const { rows } = await pool.query('SELECT email FROM profiles WHERE id = $1', [req.user.id]);
        const qrUrl = generateQrUrl(secret, rows[0]?.email || 'user');
        res.json({ qr_url: qrUrl, secret });
    } catch (err) { next(err); }
});

// ─── POST /api/security/verify-2fa ─────────────────────────────────
router.post('/security/verify-2fa', auth, async (req, res, next) => {
    try {
        const { code } = req.body;
        if (!code || code.length !== 6) return res.status(400).json({ error: 'Código inválido' });

        const { rows } = await pool.query('SELECT totp_secret_encrypted, email FROM profiles WHERE id = $1', [req.user.id]);
        if (rows.length === 0 || !rows[0].totp_secret_encrypted) {
            return res.status(400).json({ error: 'Configure o 2FA primeiro' });
        }

        const secret = decrypt(rows[0].totp_secret_encrypted);
        if (!secret || !verifyTotpCode(secret, code)) {
            await logSecurityEvent(req, '2fa_failed', { user_id: req.user.id });
            return res.status(400).json({ error: 'Código inválido' });
        }

        // Generate recovery codes
        const recoveryCodes = generateRecoveryCodes();
        const encryptedCodes = encrypt(JSON.stringify(recoveryCodes));

        await pool.query(
            'UPDATE profiles SET totp_enabled = TRUE, recovery_codes_encrypted = $1 WHERE id = $2',
            [encryptedCodes, req.user.id]
        );

        await logSecurityEvent(req, '2fa_success', { user_id: req.user.id });
        await logAdminAction(req, '2fa_enabled', 'Security', '', '2FA', 'Autenticação 2FA ativada');

        res.json({ recovery_codes: recoveryCodes });
    } catch (err) { next(err); }
});

// ─── POST /api/security/disable-2fa ────────────────────────────────
router.post('/security/disable-2fa', auth, async (req, res, next) => {
    try {
        await pool.query(
            'UPDATE profiles SET totp_enabled = FALSE, totp_secret_encrypted = NULL, recovery_codes_encrypted = NULL WHERE id = $1',
            [req.user.id]
        );
        await logSecurityEvent(req, '2fa_disabled', { user_id: req.user.id });
        await logAdminAction(req, '2fa_disabled', 'Security', '', '2FA', 'Autenticação 2FA desativada');
        res.json({ success: true });
    } catch (err) { next(err); }
});

// ─── PATCH /api/security/settings ──────────────────────────────────
router.patch('/security/settings', auth, requireAdmin, async (req, res, next) => {
    try {
        const { require_2fa_admin } = req.body;
        if (typeof require_2fa_admin === 'boolean') {
            await pool.query('UPDATE profiles SET require_2fa = $1 WHERE id = $2', [require_2fa_admin, req.user.id]);
        }
        res.json({ success: true });
    } catch (err) { next(err); }
});

// ─── GET /api/login-history ────────────────────────────────────────
router.get('/login-history', auth, requireAdmin, async (req, res, next) => {
    try {
        const { search, status, user_type, period } = req.query;
        const params = [];
        const conditions = ['is_archived = FALSE'];
        let paramIdx = 1;

        if (search) {
            params.push(`%${search}%`);
            conditions.push(`email ILIKE $${paramIdx++}`);
        }
        if (status) {
            params.push(status);
            conditions.push(`status = $${paramIdx++}`);
        }
        if (user_type) {
            params.push(user_type);
            conditions.push(`user_type = $${paramIdx++}`);
        }

        // Period filter
        const now = new Date();
        let start;
        switch (period) {
            case 'today': start = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
            case '7d': start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
            case 'this_month': start = new Date(now.getFullYear(), now.getMonth(), 1); break;
            default: start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }
        params.push(start);
        conditions.push(`created_at >= $${paramIdx++}`);

        const query = `SELECT * FROM login_history WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT 200`;
        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (err) { next(err); }
});

// ─── POST /api/login-history/:id/archive ───────────────────────────
router.post('/login-history/:id/archive', auth, requireAdmin, async (req, res, next) => {
    try {
        await pool.query('UPDATE login_history SET is_archived = TRUE WHERE id = $1', [req.params.id]);
        await logAdminAction(req, 'login_history_archived', 'LoginHistory', req.params.id, 'Login History', 'Registro arquivado');
        res.json({ success: true });
    } catch (err) { next(err); }
});

// ─── POST /api/login-history/:id/suspicious ────────────────────────
router.post('/login-history/:id/suspicious', auth, requireAdmin, async (req, res, next) => {
    try {
        await pool.query('UPDATE login_history SET is_suspicious = TRUE WHERE id = $1', [req.params.id]);
        await logAdminAction(req, 'login_marked_suspicious', 'LoginHistory', req.params.id, 'Login History', 'Marcado como suspeito');
        res.json({ success: true });
    } catch (err) { next(err); }
});

// ─── GET /api/sessions/active ─────────────────────────────────────
router.get('/sessions/active', auth, async (req, res, next) => {
    try {
        // Show all active sessions for admin, or own sessions for customer
        const isAdmin = req.user.role === 'admin';
        const query = isAdmin
            ? `SELECT * FROM active_sessions WHERE is_revoked = FALSE ORDER BY last_activity DESC LIMIT 50`
            : `SELECT * FROM active_sessions WHERE user_id = $1 AND is_revoked = FALSE ORDER BY last_activity DESC`;
        const params = isAdmin ? [] : [req.user.id];
        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (err) { next(err); }
});

// ─── POST /api/sessions/:id/revoke ─────────────────────────────────
router.post('/sessions/:id/revoke', auth, async (req, res, next) => {
    try {
        const { rows } = await pool.query('SELECT user_id FROM active_sessions WHERE id = $1', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Session not found' });

        const canRevoke = req.user.role === 'admin' || rows[0].user_id === req.user.id;
        if (!canRevoke) return res.status(403).json({ error: 'Not authorized' });

        await pool.query('UPDATE active_sessions SET is_revoked = TRUE WHERE id = $1', [req.params.id]);
        await logAdminAction(req, 'session_revoked', 'Session', req.params.id, 'Session', 'Sessão encerrada');
        res.json({ success: true });
    } catch (err) { next(err); }
});

// ─── POST /api/sessions/user/:userId/revoke ────────────────────────
router.post('/sessions/user/:userId/revoke', auth, requireAdmin, async (req, res, next) => {
    try {
        await pool.query('UPDATE active_sessions SET is_revoked = TRUE WHERE user_id = $1', [req.params.userId]);
        await logAdminAction(req, 'session_revoked', 'Session', req.params.userId, 'Session', 'Todas as sessões do usuário revogadas');
        res.json({ success: true });
    } catch (err) { next(err); }
});

// ─── Helper: record login event (called from auth route) ───────────
export async function recordLoginEvent(req, { userId, email, userType, status }) {
    try {
        const ua = parseUserAgent(req.headers['user-agent']);
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
        const maskedIp = maskIp(ip);
        const sessionId = crypto.randomUUID();

        await pool.query(
            `INSERT INTO login_history (user_id, email, user_type, status, ip_address, device_type, browser, os, user_agent, session_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [userId || null, email, userType, status, maskedIp, ua.device_type, ua.browser, ua.os, (req.headers['user-agent'] || '').slice(0, 512), sessionId]
        );

        if (status === 'success' && userId) {
            await pool.query(
                `INSERT INTO active_sessions (user_id, token_jti, ip_address, device_type, browser, os, user_agent, expires_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [userId, sessionId, maskedIp, ua.device_type, ua.browser, ua.os, (req.headers['user-agent'] || '').slice(0, 512), new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)]
            );
        }

        return sessionId;
    } catch (err) {
        console.error('[LoginHistory] Failed to record event:', err.message);
        return null;
    }
}

export default router;
