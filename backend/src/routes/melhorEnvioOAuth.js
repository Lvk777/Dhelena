import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../config/db.js';
import { requireAdmin } from '../middleware.js';
import { encrypt } from '../lib/crypto.js';

const BASE = 'https://sandbox.melhorenvio.com.br';
const PREFIX = 'melhor_envio_oauth_state_';
const CODE_PREFIX = 'melhor_envio_oauth_code_';
const TOKEN_KEY = 'melhor_envio_sandbox_oauth';
const TTL_MS = 10 * 60 * 1000;
// Permissions used by the existing quote, cart, checkout, label and tracking code.
const SCOPES = 'shipping-calculate cart-write shipping-checkout shipping-generate shipping-print shipping-tracking users-read';
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

function config() {
    if (process.env.MELHOR_ENVIO_MODE !== 'sandbox') return null;
    const { MELHOR_ENVIO_CLIENT_ID: clientId, MELHOR_ENVIO_CLIENT_SECRET: clientSecret, MELHOR_ENVIO_REDIRECT_URI: redirectUri } = process.env;
    if (!clientId || !clientSecret || !redirectUri) return null;
    try {
        const uri = new URL(redirectUri);
        if (uri.protocol !== 'https:' && process.env.NODE_ENV === 'production') return null;
        if (uri.pathname !== '/api/integrations/melhor-envio/oauth/callback' || uri.search || uri.hash) return null;
        return { clientId, clientSecret, redirectUri };
    } catch { return null; }
}

function stateKey(state) {
    return PREFIX + crypto.createHash('sha256').update(state).digest('hex');
}

async function exchangeCode(code, settings) {
    const response = await fetch(`${BASE}/oauth/token`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': process.env.MELHOR_ENVIO_USER_AGENT || "D'Helenas (atendimento@dhelenas.com.br)",
        },
        body: JSON.stringify({
            grant_type: 'authorization_code',
            client_id: settings.clientId,
            client_secret: settings.clientSecret,
            redirect_uri: settings.redirectUri,
            code,
        }),
        signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('token_exchange_failed');
    const payload = await response.json();
    if (typeof payload.access_token !== 'string' || !payload.access_token ||
        typeof payload.refresh_token !== 'string' || !payload.refresh_token) {
        throw new Error('invalid_token_response');
    }
    return payload;
}

function safeResponse(res, status, message) {
    return res.status(status).type('text/plain').send(message);
}

export function createMelhorEnvioOAuthRouter({ db = pool, exchange = exchangeCode, now = () => Date.now() } = {}) {
    const router = Router();
    router.use('/integrations/melhor-envio/oauth', limiter, (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        res.set('Referrer-Policy', 'no-referrer');
        next();
    });

    router.get('/integrations/melhor-envio/oauth/authorize', requireAdmin, async (req, res) => {
        const settings = config();
        if (!settings || !process.env.INTEGRATION_ENCRYPTION_KEY) {
            return safeResponse(res, 503, 'OAuth Sandbox não configurado.');
        }
        const state = crypto.randomBytes(32).toString('base64url');
        try {
            await db.query("DELETE FROM integration_configs WHERE service_key LIKE 'melhor_envio_oauth_state_%' AND (config_data->>'expires_at')::bigint < $1", [now()]);
            await db.query("DELETE FROM integration_configs WHERE service_key LIKE 'melhor_envio_oauth_code_%' AND (config_data->>'expires_at')::bigint < $1", [now()]);
            await db.query(
                `INSERT INTO integration_configs (service_key, service_name, config_data, is_active)
                 VALUES ($1, 'OAuth Sandbox pendente', $2, false)`,
                [stateKey(state), JSON.stringify({ admin_id: req.user.id, expires_at: now() + TTL_MS })]
            );
        } catch {
            return safeResponse(res, 503, 'Não foi possível iniciar a autorização.');
        }
        const url = new URL(`${BASE}/oauth/authorize`);
        url.searchParams.set('client_id', settings.clientId);
        url.searchParams.set('redirect_uri', settings.redirectUri);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('state', state);
        url.searchParams.set('scope', SCOPES);
        // JSON lets the existing Bearer-authenticated admin frontend initiate navigation.
        if (req.get('Accept')?.includes('application/json')) return res.json({ authorization_url: url.toString() });
        return res.redirect(302, url.toString());
    });

    router.get('/integrations/melhor-envio/oauth/result', (req, res) => {
        return safeResponse(res, 200, 'Autorização Sandbox concluída.');
    });

    router.get('/integrations/melhor-envio/oauth/callback', async (req, res) => {
        const settings = config();
        if (!settings) return safeResponse(res, 503, 'OAuth Sandbox não configurado.');
        if (process.env.NODE_ENV === 'production' && !req.secure) return safeResponse(res, 400, 'HTTPS obrigatório.');
        const { state, code, error } = req.query;
        if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state)) {
            return safeResponse(res, 400, 'Estado de autorização inválido.');
        }
        let pending;
        try {
            const result = await db.query(
                'DELETE FROM integration_configs WHERE service_key = $1 RETURNING config_data',
                [stateKey(state)]
            );
            pending = result.rows[0]?.config_data;
        } catch {
            return safeResponse(res, 503, 'Autorização indisponível.');
        }
        if (!pending || !Number.isSafeInteger(Number(pending.expires_at)) || Number(pending.expires_at) <= now()) {
            return safeResponse(res, 400, 'Estado de autorização inválido ou expirado.');
        }
        if (error !== undefined) return safeResponse(res, 400, 'Autorização recusada pelo Melhor Envio.');
        if (typeof code !== 'string' || !code || code.length > 2048) return safeResponse(res, 400, 'Código de autorização ausente.');
        try {
            const admin = await db.query("SELECT id FROM profiles WHERE id = $1 AND role = 'admin' LIMIT 1", [pending.admin_id]);
            if (admin.rows.length !== 1) return safeResponse(res, 403, 'Administrador não autorizado.');
            const codeHash = CODE_PREFIX + crypto.createHash('sha256').update(code).digest('hex');
            const claimed = await db.query(
                `INSERT INTO integration_configs (service_key, service_name, config_data, is_active)
                 VALUES ($1, 'Código OAuth consumido', $2, false)
                 ON CONFLICT (service_key) DO NOTHING RETURNING id`,
                [codeHash, JSON.stringify({ expires_at: now() + 45 * 24 * 60 * 60 * 1000 })]
            );
            if (claimed.rows.length !== 1) return safeResponse(res, 400, 'Código de autorização já utilizado.');
            // Never put provider errors or token payloads into logs or responses.
            const tokens = await exchange(code, settings);
            const access = encrypt(tokens.access_token);
            const refresh = encrypt(tokens.refresh_token);
            const expiresIn = Number(tokens.expires_in);
            const expiresAt = now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 2592000) * 1000;
            const saved = await db.query(
                `INSERT INTO integration_configs (service_key, service_name, config_data, is_active)
                 VALUES ($1, 'Melhor Envio OAuth Sandbox', $2, false)
                 ON CONFLICT (service_key) DO UPDATE SET config_data = EXCLUDED.config_data, updated_at = now()
                 WHERE integration_configs.config_data->>'authorized_by' = $3
                 RETURNING id`,
                [TOKEN_KEY, JSON.stringify({ access_token: access, refresh_token: refresh, expires_at: expiresAt, authorized_by: pending.admin_id, mode: 'sandbox' }), pending.admin_id]
            );
            if (saved.rows.length !== 1) return safeResponse(res, 409, 'A integração já pertence a outro administrador.');
            return res.redirect(303, '/api/integrations/melhor-envio/oauth/result');
        } catch {
            return safeResponse(res, 502, 'Não foi possível concluir a autorização Sandbox.');
        }
    });
    return router;
}

export default createMelhorEnvioOAuthRouter();
