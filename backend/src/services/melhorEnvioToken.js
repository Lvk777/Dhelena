import { pool } from '../config/db.js';
import { decrypt, encrypt } from '../lib/crypto.js';

const TOKEN_KEY = 'melhor_envio_sandbox_oauth';
const EXPIRY_MARGIN_MS = 60_000;
export const MELHOR_ENVIO_USER_AGENT_FALLBACK = "D'Helenas (atendimento@dhelenas.com.br)";

function disconnected() {
    return Object.assign(new Error('Integração Melhor Envio desconectada; autorize novamente o OAuth Sandbox.'), { status: 503 });
}

export function melhorEnvioMode() {
    const mode = process.env.MELHOR_ENVIO_MODE || (process.env.NODE_ENV === 'production' ? '' : 'sandbox');
    if (mode !== 'sandbox' && mode !== 'production') {
        throw Object.assign(new Error('MELHOR_ENVIO_MODE inválido ou ausente'), { status: 503 });
    }
    return mode;
}

function oauthSettings() {
    const { MELHOR_ENVIO_CLIENT_ID: clientId, MELHOR_ENVIO_CLIENT_SECRET: clientSecret, INTEGRATION_ENCRYPTION_KEY: encryptionKey } = process.env;
    return clientId && clientSecret && encryptionKey ? { clientId, clientSecret } : null;
}

function validAccess(row, now) {
    const config = row?.config_data;
    return config?.mode === 'sandbox' && Number(config.expires_at) > now + EXPIRY_MARGIN_MS && !!decrypt(config.access_token);
}

export function createMelhorEnvioTokenManager({ db = pool, fetchImpl = fetch, now = () => Date.now() } = {}) {
    async function readRow(client = db) {
        const { rows } = await client.query('SELECT config_data FROM integration_configs WHERE service_key = $1', [TOKEN_KEY]);
        return rows[0] || null;
    }

    async function getToken() {
        const mode = melhorEnvioMode();
        let row;
        try { row = await readRow(); } catch { throw disconnected(); }

        if (row) {
            if (mode !== 'sandbox' || row.config_data?.mode !== 'sandbox') throw disconnected();
            if (validAccess(row, now())) return { token: decrypt(row.config_data.access_token), source: 'oauth', mode };
            const settings = oauthSettings();
            if (!settings || !decrypt(row.config_data?.refresh_token)) throw disconnected();

            // A row lock coordinates refresh across requests and Railway instances.
            const client = await db.connect().catch(() => { throw disconnected(); });
            try {
                await client.query('BEGIN');
                const { rows } = await client.query('SELECT config_data FROM integration_configs WHERE service_key = $1 FOR UPDATE', [TOKEN_KEY]);
                const current = rows[0];
                if (!current || current.config_data?.mode !== 'sandbox') throw disconnected();
                if (validAccess(current, now())) {
                    await client.query('COMMIT');
                    return { token: decrypt(current.config_data.access_token), source: 'oauth', mode };
                }
                const refreshToken = decrypt(current.config_data.refresh_token);
                if (!refreshToken) throw disconnected();
                const response = await fetchImpl('https://sandbox.melhorenvio.com.br/oauth/token', {
                    method: 'POST',
                    headers: {
                        Accept: 'application/json',
                        'Content-Type': 'application/json',
                        'User-Agent': process.env.MELHOR_ENVIO_USER_AGENT || MELHOR_ENVIO_USER_AGENT_FALLBACK,
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
                await client.query('UPDATE integration_configs SET config_data = $2, updated_at = now() WHERE service_key = $1', [TOKEN_KEY, JSON.stringify(updated)]);
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

    async function readiness() {
        const rawMode = process.env.MELHOR_ENVIO_MODE || (process.env.NODE_ENV === 'production' ? null : 'sandbox');
        let row = null;
        let oauthStoreAvailable = true;
        try { row = await readRow(); } catch { oauthStoreAvailable = false; }
        const data = row?.config_data;
        const tokenPresent = data?.mode === 'sandbox' && !!data.access_token;
        const tokenExpired = tokenPresent ? !(Number(data.expires_at) > now() + EXPIRY_MARGIN_MS) : null;
        const fallbackPresent = !!process.env.MELHOR_ENVIO_TOKEN;
        return {
            mode: rawMode === 'sandbox' || rawMode === 'production' ? rawMode : 'INDETERMINADO',
            oauth_configured: rawMode === 'sandbox' && !!oauthSettings() && !!process.env.MELHOR_ENVIO_REDIRECT_URI,
            oauth_token_present: !!tokenPresent,
            token_expired: tokenExpired,
            refresh_available: !!(tokenPresent && data.refresh_token && oauthSettings()),
            fallback_token_present: fallbackPresent,
            fallback_usable: fallbackPresent && process.env.MELHOR_ENVIO_TOKEN_MODE === rawMode && !row,
            webhook_configured: !!process.env.MELHOR_ENVIO_WEBHOOK_SECRET,
            user_agent_configured: !!process.env.MELHOR_ENVIO_USER_AGENT,
            oauth_store_available: oauthStoreAvailable,
        };
    }

    return { getToken, readiness };
}

export const melhorEnvioTokens = createMelhorEnvioTokenManager();
