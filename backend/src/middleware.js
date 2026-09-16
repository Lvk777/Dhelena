import jwt from 'jsonwebtoken';
import { pool } from './config/db.js';

const isProduction = process.env.NODE_ENV === 'production';

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
                // Prefer the immutable Supabase Auth id.
                let { rows } = await pool.query(
                    'SELECT id, email, full_name, phone, cpf, birth_date, role FROM profiles WHERE id = $1 LIMIT 1',
                    [user.id]
                );
                // Some legacy profiles pre-date the Supabase trigger and have a
                // different UUID. A fallback is safe only after getUser() has
                // cryptographically validated the Supabase token and only when
                // that verified e-mail maps to exactly one profile. It preserves
                // existing orders/admin access without accepting Express JWTs.
                if (rows.length === 0 && user.email) {
                    const legacy = await pool.query(
                        'SELECT id, email, full_name, phone, cpf, birth_date, role FROM profiles WHERE lower(email) = lower($1) LIMIT 2',
                        [user.email]
                    );
                    if (legacy.rows.length === 1) rows = legacy.rows;
                }
                if (rows.length > 0) req.user = rows[0];
            }
        } catch {
            // Supabase unreachable — fall back to Express JWT (dev/preview mode)
        }
    }

    // Express JWT is strictly a local-development compatibility mode.  In
    // production a Supabase outage or invalid Supabase token must never turn
    // into acceptance of a different JWT issuer.
    if (!req.user && !isProduction && !supabaseAdmin) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const { rows } = await pool.query(
                'SELECT id, email, full_name, phone, cpf, birth_date, role FROM profiles WHERE id = $1', [decoded.id]
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
