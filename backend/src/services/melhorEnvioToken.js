import { pool } from '../config/db.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { melhorEnvioEnvironment, melhorEnvioOAuthSettings, melhorEnvioUserAgent } from './melhorEnvioEnvironment.js';
export { MELHOR_ENVIO_USER_AGENT_FALLBACK } from './melhorEnvioEnvironment.js';

const EXPIRY_MARGIN_MS = 60_000;

function disconnected() {
    return Object.assign(new Error('Integração Melhor Envio desconectada no ambiente selecionado; autorize o OAuth correspondente.'), { status: 503 });
}

export function melhorEnvioMode() {
    const mode = process.env.MELHOR_ENVIO_MODE || (process.env.NODE_ENV === 'production' ? '' : 'sandbox');
    if (mode !== 'sandbox' && mode !== 'production') {
        throw Object.assign(new Error('MELHOR_ENVIO_MODE inválido ou ausente'), { status: 503 });
    }
    return mode;
}

function storedToken(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(value)) return null;
    return decrypt(value);
}

function validAccess(row, now, mode) {
    const config = row?.config_data;
    return config?.mode === mode && Number(config.expires_at) > now + EXPIRY_MARGIN_MS && !!storedToken(config.access_token);
}

export function createMelhorEnvioTokenManager({ db = pool, fetchImpl = fetch, now = () => Date.now() } = {}) {
    async function readRow(mode, client = db) {
        const { rows } = await client.query('SELECT config_data FROM integration_configs WHERE service_key = $1', [melhorEnvioEnvironment(mode).tokenKey]);
        return rows[0] || null;
    }

    async function getToken(selectedMode) {
        const mode = selectedMode || melhorEnvioMode();
        if (!['sandbox', 'production'].includes(mode)) throw disconnected();
        const environment = melhorEnvioEnvironment(mode);
        let row;
        try { row = await readRow(mode); } catch { throw disconnected(); }

        if (row) {
            if (row.config_data?.mode !== mode) throw disconnected();
            if (validAccess(row, now(), mode)) return { token: storedToken(row.config_data.access_token), source: 'oauth', mode };
            const settings = melhorEnvioOAuthSettings(mode);
            if (!settings || !storedToken(row.config_data?.refresh_token)) throw disconnected();

            // A row lock coordinates refresh across requests and Railway instances.
            const client = await db.connect().catch(() => { throw disconnected(); });
            try {
                await client.query('BEGIN');
                const { rows } = await client.query('SELECT config_data FROM integration_configs WHERE service_key = $1 FOR UPDATE', [environment.tokenKey]);
                const current = rows[0];
                if (!current || current.config_data?.mode !== mode) throw disconnected();
                if (validAccess(current, now(), mode)) {
                    await client.query('COMMIT');
                    return { token: storedToken(current.config_data.access_token), source: 'oauth', mode };
                }
                const refreshToken = storedToken(current.config_data.refresh_token);
                if (!refreshToken) throw disconnected();
                const response = await fetchImpl(`${environment.base}/oauth/token`, {
                    method: 'POST',
                    headers: {
                        Accept: 'application/json',
                        'Content-Type': 'application/json',
                        'User-Agent': melhorEnvioUserAgent(mode),
                    },
                    body: JSON.stringify({ grant_type: 'refresh_token', client_id: settings.clientId, client_secret: settings.clientSecret, refresh_token: refreshToken }),
                    signal: AbortSignal.timeout(10000),
                });
                if (!response.ok) throw disconnected();
                const payload = await response.json();
                const expiresIn = Number(payload.expires_in);
                if (typeof payload.access_token !== 'string' || !payload.access_token || !Number.isFinite(expiresIn) || expiresIn <= 60 ||
                    (payload.refresh_token !== undefined && (typeof payload.refresh_token !== 'string' || !payload.refresh_token))) throw disconnected();
                const updated = {
                    ...current.config_data,
                    access_token: encrypt(payload.access_token),
                    refresh_token: encrypt(payload.refresh_token || refreshToken),
                    expires_at: now() + expiresIn * 1000,
                };
                await client.query('UPDATE integration_configs SET config_data = $2, updated_at = now() WHERE service_key = $1', [environment.tokenKey, JSON.stringify(updated)]);
                await client.query('COMMIT');
                return { token: payload.access_token, source: 'oauth', mode };
            } catch {
                await client.query('ROLLBACK').catch(() => {});
                throw disconnected();
            } finally { client.release(); }
        }

        // A fixed token has no discoverable environment. Require an explicit match.
        if (process.env.MELHOR_ENVIO_TOKEN && process.env.MELHOR_ENVIO_TOKEN_MODE === mode) {
            return { token: process.env.MELHOR_ENVIO_TOKEN, source: 'fallback', mode };
        }
        throw Object.assign(new Error('Token Melhor Envio indisponível ou ambiente do token fixo não comprovado.'), { status: 503 });
    }

    async function readiness(selectedMode) {
        const rawMode = process.env.MELHOR_ENVIO_MODE || (process.env.NODE_ENV === 'production' ? null : 'sandbox');
        const mode = selectedMode || rawMode;
        let row = null;
        let oauthStoreAvailable = true;
        try { row = await readRow(mode); } catch { oauthStoreAvailable = false; }
        const data = row?.config_data;
        const tokenPresent = data?.mode === mode && !!storedToken(data.access_token);
        const tokenExpired = tokenPresent ? !(Number(data.expires_at) > now() + EXPIRY_MARGIN_MS) : null;
        const fallbackPresent = !!process.env.MELHOR_ENVIO_TOKEN;
        return {
            mode: mode === 'sandbox' || mode === 'production' ? mode : 'INDETERMINADO',
            active: mode === rawMode,
            oauth_configured: !!melhorEnvioOAuthSettings(mode || ''),
            oauth_token_present: !!tokenPresent,
            token_expired: tokenExpired,
            refresh_available: !!(tokenPresent && storedToken(data.refresh_token) && melhorEnvioOAuthSettings(mode)),
            fallback_token_present: fallbackPresent,
            fallback_usable: fallbackPresent && process.env.MELHOR_ENVIO_TOKEN_MODE === mode && !row && oauthStoreAvailable,
            webhook_configured: !!process.env.MELHOR_ENVIO_WEBHOOK_SECRET,
            user_agent_configured: !!(process.env[`MELHOR_ENVIO_${String(mode).toUpperCase()}_USER_AGENT`] || process.env.MELHOR_ENVIO_USER_AGENT),
            oauth_store_available: oauthStoreAvailable,
        };
    }

    return { getToken, readiness };
}

export const melhorEnvioTokens = createMelhorEnvioTokenManager();
