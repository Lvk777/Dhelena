import { pool } from '../config/db.js';

// ─── Security event logging ──────────────────────────────────────
// Stores security-relevant events in audit_logs for admin visibility.
// Never logs passwords, tokens, or secrets — only metadata.
export async function logSecurityEvent(req, eventName, metadata = {}) {
    try {
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
        // Mask IP for privacy (keep first 3 octets for IPv4)
        const maskedIp = maskIp(ip);
        const userId = req.user?.id || null;
        const endpoint = req.path || req.originalUrl || '';
        const method = req.method || '';

        await pool.query(
            `INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, changes, ip_address)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                userId,
                `security.${eventName}`,
                'security',
                endpoint,
                JSON.stringify({ method, ip: maskedIp, ...sanitizeMetadata(metadata) }),
                maskedIp,
            ]
        );
    } catch (err) {
        console.error('[SecurityLog] Failed to log event:', err.message);
    }
}

// ─── Mask IP (privacy — keep first 3 octets for IPv4) ─────────────
function maskIp(ip) {
    if (ip.includes('.')) {
        const parts = ip.split('.');
        if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
    }
    // IPv6 — just return prefix
    if (ip.includes(':')) return ip.split(':').slice(0, 2).join(':') + ':xxxx';
    return 'unknown';
}

// ─── Sanitize metadata (remove sensitive fields) ──────────────────
function sanitizeMetadata(meta) {
    const forbidden = ['password', 'token', 'secret', 'authorization', 'credit_card', 'card'];
    const clean = {};
    for (const [k, v] of Object.entries(meta || {})) {
        if (forbidden.some(f => k.toLowerCase().includes(f))) continue;
        clean[k] = v;
    }
    return clean;
}
