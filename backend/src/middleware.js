import jwt from 'jsonwebtoken';
import { pool } from './config/db.js';

// ─── Supabase admin client (lazy init, only when configured) ───────
let _supabaseAdmin = undefined;

async function getSupabaseAdmin() {
    if (_supabaseAdmin !== undefined) return _supabaseAdmin;
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        _supabaseAdmin = null;
        return null;
    }
    try {
        const { createClient } = await import('@supabase/supabase-js');
        _supabaseAdmin = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY,
            { auth: { autoRefreshToken: false, persistSession: false } }
        );
        console.log('[Auth] Supabase mode active');
    } catch (e) {
        console.warn('[Auth] @supabase/supabase-js not installed, using Express JWT');
        _supabaseAdmin = null;
    }
    return _supabaseAdmin;
}

export const isSupabaseMode = () => _supabaseAdmin !== null && _supabaseAdmin !== undefined;

// ─── Auth middleware: validates Supabase JWT or Express JWT ────────
export async function auth(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return next();

    const token = header.slice(7);
    const supabaseAdmin = await getSupabaseAdmin();

    if (supabaseAdmin) {
        // ── Supabase mode: validate Supabase access token ──
        try {
            const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
            if (!error && user) {
                // Look up by Supabase Auth ID first, then by email as fallback
                // (IDs may differ if profile was created by seed, not by Supabase Auth)
                const { rows } = await pool.query(
                    'SELECT id, email, full_name, phone, role FROM profiles WHERE id = $1 OR email = $2 LIMIT 1',
                    [user.id, user.email]
                );
                if (rows.length > 0) req.user = rows[0];
            }
        } catch {
            // Supabase unreachable — fall back to Express JWT (dev/preview mode)
        }
    }

    // ── Express JWT fallback (dev mode, or Supabase unreachable) ──
    if (!req.user) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const { rows } = await pool.query(
                'SELECT id, email, full_name, phone, role FROM profiles WHERE id = $1', [decoded.id]
            );
            if (rows.length > 0) req.user = rows[0];
        } catch { /* invalid token — continue as anonymous */ }
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
