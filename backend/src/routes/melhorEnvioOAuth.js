import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../config/db.js';
import { requireAdmin } from '../middleware.js';
import { encrypt } from '../lib/crypto.js';
import { melhorEnvioEnvironment, melhorEnvioOAuthSettings, melhorEnvioUserAgent, MELHOR_ENVIO_OAUTH_SCOPES } from '../services/melhorEnvioEnvironment.js';

const TTL_MS = 10 * 60 * 1000;

function stateKey(mode, state) {
    return melhorEnvioEnvironment(mode).statePrefix + crypto.createHash('sha256').update(state).digest('hex');
}

async function exchangeCode(code, settings) {
    const response = await fetch(`${settings.base}/oauth/token`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': melhorEnvioUserAgent(settings.mode),
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
        typeof payload.refresh_token !== 'string' || !payload.refresh_token ||
        !Number.isFinite(Number(payload.expires_in)) || Number(payload.expires_in) <= 60) {
        throw new Error('invalid_token_response');
    }
    return payload;
}

function safeResponse(res, status, message) {
    return res.status(status).type('text/plain').send(message);
}

export function createMelhorEnvioOAuthRouter({ db = pool, exchange = exchangeCode, now = () => Date.now() } = {}) {
    const router = Router();
    const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
    router.use('/integrations/melhor-envio/oauth', limiter, (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        res.set('Referrer-Policy', 'no-referrer');
        next();
    });

    for (const mode of ['sandbox', 'production']) {
    const environment = melhorEnvioEnvironment(mode);
    const path = environment.route.slice(4);
    const label = mode === 'sandbox' ? 'Sandbox' : 'Production';
    router.get(`${path}/authorize`, requireAdmin, async (req, res) => {
        const settings = melhorEnvioOAuthSettings(mode);
        if (!settings || !process.env.INTEGRATION_ENCRYPTION_KEY) {
            return safeResponse(res, 503, `OAuth ${label} não configurado.`);
        }
        const state = crypto.randomBytes(32).toString('base64url');
        try {
            await db.query("DELETE FROM integration_configs WHERE service_key LIKE $1 AND (config_data->>'expires_at')::bigint < $2", [environment.statePrefix + '%', now()]);
            await db.query("DELETE FROM integration_configs WHERE service_key LIKE $1 AND (config_data->>'expires_at')::bigint < $2", [environment.codePrefix + '%', now()]);
            await db.query(
                `INSERT INTO integration_configs (service_key, service_name, config_data, is_active)
                 VALUES ($1, 'OAuth ${label} pendente', $2, false)`,
                [stateKey(mode, state), JSON.stringify({ admin_id: req.user.id, mode, client_id: settings.clientId, redirect_uri: settings.redirectUri, expires_at: now() + TTL_MS })]
            );
        } catch {
            return safeResponse(res, 503, 'Não foi possível iniciar a autorização.');
        }
        const url = new URL(`${environment.base}/oauth/authorize`);
        url.searchParams.set('client_id', settings.clientId);
        url.searchParams.set('redirect_uri', settings.redirectUri);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('state', state);
        url.searchParams.set('scope', MELHOR_ENVIO_OAUTH_SCOPES);
        // JSON lets the existing Bearer-authenticated admin frontend initiate navigation.
        if (req.get('Accept')?.includes('application/json')) return res.json({ authorization_url: url.toString() });
        return res.redirect(302, url.toString());
    });

    router.get(`${path}/result`, (req, res) => {
        return safeResponse(res, 200, `Autorização ${label} concluída. O ambiente ativo da loja não foi alterado.`);
    });

    router.get(`${path}/callback`, async (req, res) => {
        const settings = melhorEnvioOAuthSettings(mode);
        if (!settings) return safeResponse(res, 503, `OAuth ${label} não configurado.`);
        if (process.env.NODE_ENV === 'production' && !req.secure) return safeResponse(res, 400, 'HTTPS obrigatório.');
        const { state, code, error } = req.query;
        if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state)) {
            return safeResponse(res, 400, 'Estado de autorização inválido.');
        }
        let pending;
        try {
            const result = await db.query(
                'DELETE FROM integration_configs WHERE service_key = $1 RETURNING config_data',
                [stateKey(mode, state)]
            );
            pending = result.rows[0]?.config_data;
        } catch {
            return safeResponse(res, 503, 'Autorização indisponível.');
        }
        if (!pending || !Number.isSafeInteger(Number(pending.expires_at)) || Number(pending.expires_at) <= now()) {
            return safeResponse(res, 400, 'Estado de autorização inválido ou expirado.');
        }
        if ((pending.mode || 'sandbox') !== mode ||
            (pending.client_id && pending.client_id !== settings.clientId) ||
            (pending.redirect_uri && pending.redirect_uri !== settings.redirectUri)) {
            return safeResponse(res, 400, 'Configuração de autorização divergente.');
        }
        if (error !== undefined) return safeResponse(res, 400, 'Autorização recusada pelo Melhor Envio.');
        if (typeof code !== 'string' || !code || code.length > 2048) return safeResponse(res, 400, 'Código de autorização ausente.');
        try {
            const admin = await db.query("SELECT id FROM profiles WHERE id = $1 AND role = 'admin' LIMIT 1", [pending.admin_id]);
            if (admin.rows.length !== 1) return safeResponse(res, 403, 'Administrador não autorizado.');
            const codeHash = environment.codePrefix + crypto.createHash('sha256').update(code).digest('hex');
            const claimed = await db.query(
                `INSERT INTO integration_configs (service_key, service_name, config_data, is_active)
                 VALUES ($1, 'Código OAuth consumido', $2, false)
                 ON CONFLICT (service_key) DO NOTHING RETURNING id`,
                [codeHash, JSON.stringify({ expires_at: now() + 45 * 24 * 60 * 60 * 1000 })]
            );
            if (claimed.rows.length !== 1) return safeResponse(res, 400, 'Código de autorização já utilizado.');
            // Never put provider errors or token payloads into logs or responses.
            const tokens = await exchange(code, settings);
            if (typeof tokens.access_token !== 'string' || !tokens.access_token || typeof tokens.refresh_token !== 'string' || !tokens.refresh_token || !Number.isFinite(Number(tokens.expires_in)) || Number(tokens.expires_in) <= 60) throw new Error('invalid_token_response');
            const access = encrypt(tokens.access_token);
            const refresh = encrypt(tokens.refresh_token);
            const expiresIn = Number(tokens.expires_in);
            const expiresAt = now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 2592000) * 1000;
            const saved = await db.query(
                `INSERT INTO integration_configs (service_key, service_name, config_data, is_active)
                 VALUES ($1, 'Melhor Envio OAuth ${label}', $2, false)
                 ON CONFLICT (service_key) DO UPDATE SET config_data = EXCLUDED.config_data, updated_at = now()
                 WHERE integration_configs.config_data->>'authorized_by' = $3
                 RETURNING id`,
                [environment.tokenKey, JSON.stringify({ access_token: access, refresh_token: refresh, expires_at: expiresAt, authorized_by: pending.admin_id, mode }), pending.admin_id]
            );
            if (saved.rows.length !== 1) return safeResponse(res, 409, 'A integração já pertence a outro administrador.');
            return res.redirect(303, `${environment.route}/result`);
        } catch {
            return safeResponse(res, 502, `Não foi possível concluir a autorização ${label}.`);
        }
    });
    }
    return router;
}

export default createMelhorEnvioOAuthRouter();
