import jwt from 'jsonwebtoken';
import { authenticateSupabaseProfile } from './lib/supabaseProfile.js';
import { pool } from './config/db.js';
import { logSafeError } from './lib/safeErrorLog.js';
import { loginCodeEnabled, sessionAllowed, trustedSession } from './services/loginCode.js';

const isProduction = process.env.NODE_ENV === 'production';

// ─── Supabase admin client (lazy init, only when configured) ───────
let _supabaseAdmin = undefined;

export async function getSupabaseAdmin() {
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
        console.warn('[Auth] Supabase client unavailable');
        _supabaseAdmin = null;
    }
    return _supabaseAdmin;
}

export const isSupabaseMode = () => _supabaseAdmin !== null && _supabaseAdmin !== undefined;

export const adminAssuranceRequired = (env = process.env) => env.ADMIN_AAL2_REQUIRED === 'true';

export function adminAssuranceAllowed(req, env = process.env) {
    return !adminAssuranceRequired(env) || req.authProvider === 'supabase'
        && req.supabaseSession?.aal === 'aal2';
}

export function adminRequestRequiresStepUp(req, env = process.env) {
    return req.user?.role === 'admin' && !adminAssuranceAllowed(req, env)
        && !(req.method === 'GET' && req.path === '/api/auth/me');
}

// ─── Auth middleware: validates Supabase JWT or Express JWT ────────
export async function auth(req, res, next) {
    if (req.authProvider === 'supabase' && req.user) return next();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return next();

    const token = header.slice(7);
    const supabaseAdmin = await getSupabaseAdmin();

    if (supabaseAdmin) {
        // ── Supabase mode: validate Supabase access token ──
        try {
            const profile = await authenticateSupabaseProfile(supabaseAdmin, pool, token, identity => {
                req.supabaseUserId = identity.id;
                req.supabaseEmail = identity.email_confirmed_at ? identity.email : null;
                req.supabaseSession = trustedSession(token, identity);
            }, async () => !loginCodeEnabled() || await sessionAllowed(pool, req.supabaseSession));
            if (profile) {
                req.user = profile;
                req.authProvider = 'supabase';
                // The assurance gate is off until every administrator has enrolled
                // a verified native TOTP factor. Once on, no role-based API branch
                // may be reached with an AAL1 token, including OTP and OAuth logins.
                if (adminRequestRequiresStepUp(req)) {
                    return res.status(403).json({ error: 'Confirme o aplicativo autenticador para acessar o painel.', code: 'admin_mfa_required' });
                }
            }
        } catch (error) {
            // A provisioning failure is retryable; never impersonate an anonymous
            // user or accept another token issuer after a verified Auth request.
            const status = [401, 409].includes(error.status) ? error.status : 503;
            return next(Object.assign(new Error(status === 503
                ? 'Perfil temporariamente indisponível.' : error.message), { status }));
        }
    }

    // Express JWT is strictly a local-development compatibility mode.  In
    // production a Supabase outage or invalid Supabase token must never turn
    // into acceptance of a different JWT issuer.
    if (!req.user && !isProduction && !process.env.SUPABASE_URL && !supabaseAdmin) {
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
    if (!adminAssuranceAllowed(req)) return res.status(403).json({ error: 'Confirme o aplicativo autenticador para acessar o painel.', code: 'admin_mfa_required' });
    next();
}

/** Financial administration requires a token verified by Supabase Auth. */
export function requireSupabaseAdmin(req, res, next) {
    if (!req.user || req.authProvider !== 'supabase') {
        return res.status(401).json({ error: 'Sessão Supabase necessária' });
    }
    return requireAdmin(req, res, next);
}

// ─── Error handler ─────────────────────────────────────────────────
export function errorHandler(err, req, res, next) {
    logSafeError('api_request_failed', err);
    const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    res.status(status).json({ error: status >= 500 ? 'Erro interno do servidor'
        : err instanceof SyntaxError ? 'JSON inválido' : (err.message || 'Requisição inválida') });
}
