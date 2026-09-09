import jwt from 'jsonwebtoken';
import { pool } from './config/db.js';

// ─── Auth middleware: verifies JWT, attaches user to req ───────────
export async function auth(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return next();

    const token = header.slice(7);
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { rows } = await pool.query('SELECT id, email, full_name, phone, role FROM users WHERE id = $1', [decoded.id]);
        if (rows.length > 0) {
            req.user = rows[0];
        }
    } catch {
        // Invalid token — continue as anonymous
    }
    next();
}

// ─── Require admin role ────────────────────────────────────────────
export function requireAdmin(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Autenticação necessária' });
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito a administradores' });
    next();
}

// ─── Error handler ─────────────────────────────────────────────────
export function errorHandler(err, req, res, next) {
    console.error('[API Error]', err.message);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Erro interno do servidor' });
}
