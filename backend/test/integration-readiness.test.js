import assert from 'node:assert/strict';
import test from 'node:test';
import { encrypt, decrypt } from '../src/lib/crypto.js';
import { getMercadoPagoMode, getMercadoPagoEnvironment, getMercadoPagoReadiness } from '../src/services/mercadoPago.js';
import { createMelhorEnvioTokenManager, MELHOR_ENVIO_USER_AGENT_FALLBACK } from '../src/services/melhorEnvioToken.js';

const KEYS = [
    'MERCADO_PAGO_MODE', 'MERCADO_PAGO_ACCESS_TOKEN', 'MERCADO_PAGO_WEBHOOK_SECRET',
    'MELHOR_ENVIO_MODE', 'MELHOR_ENVIO_TOKEN_MODE', 'MELHOR_ENVIO_TOKEN',
    'MELHOR_ENVIO_CLIENT_ID', 'MELHOR_ENVIO_CLIENT_SECRET', 'MELHOR_ENVIO_REDIRECT_URI',
    'MELHOR_ENVIO_WEBHOOK_SECRET', 'MELHOR_ENVIO_USER_AGENT', 'INTEGRATION_ENCRYPTION_KEY',
];

function withEnv(values, callback) {
    const previous = Object.fromEntries(KEYS.map(key => [key, process.env[key]]));
    for (const key of KEYS) delete process.env[key];
    Object.assign(process.env, values);
    return Promise.resolve().then(callback).finally(() => {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    });
}

function memoryDb(initial = null) {
    let data = initial;
    let queue = Promise.resolve();
    const row = () => ({ rows: data ? [{ config_data: structuredClone(data) }] : [] });
    return {
        query: async () => row(),
        async connect() {
            let unlock = null;
            return {
                async query(sql, args) {
                    if (sql === 'BEGIN') {
                        const previous = queue;
                        queue = new Promise(resolve => { unlock = resolve; });
                        await previous;
                        return { rows: [] };
                    }
                    if (sql.includes('FOR UPDATE')) return row();
                    if (sql.startsWith('UPDATE integration_configs')) {
                        data = JSON.parse(args[1]);
                        return { rows: [] };
                    }
                    if (sql === 'COMMIT' || sql === 'ROLLBACK') { unlock?.(); return { rows: [] }; }
                    throw new Error('Unexpected SQL');
                },
                release() {},
            };
        },
        stored: () => data,
    };
}

const env = {
    MELHOR_ENVIO_MODE: 'sandbox', MELHOR_ENVIO_CLIENT_ID: '123', MELHOR_ENVIO_CLIENT_SECRET: 'secret-client',
    MELHOR_ENVIO_REDIRECT_URI: 'https://api.example.test/api/integrations/melhor-envio/oauth/callback',
    INTEGRATION_ENCRYPTION_KEY: 'test-encryption-key', MELHOR_ENVIO_TOKEN: 'fixed-private', MELHOR_ENVIO_TOKEN_MODE: 'sandbox',
};

test('Mercado Pago mode is explicit and APP_USR is not environment evidence', async () => {
    await withEnv({ MERCADO_PAGO_ACCESS_TOKEN: 'APP_USR-private' }, () => {
        assert.equal(getMercadoPagoMode(), 'INDETERMINADO');
        assert.equal(getMercadoPagoEnvironment(), 'INDETERMINADO');
        assert.equal(getMercadoPagoReadiness().configured, false);
    });
    for (const [mode, label] of [['test', 'Teste'], ['production', 'Produção']]) {
        await withEnv({ MERCADO_PAGO_MODE: mode, MERCADO_PAGO_ACCESS_TOKEN: 'APP_USR-private' }, () => {
            assert.equal(getMercadoPagoMode(), mode);
            assert.equal(getMercadoPagoEnvironment(), label);
            assert.equal(getMercadoPagoReadiness().configured, true);
        });
    }
});

test('Melhor Envio prefers valid encrypted Sandbox OAuth token and reports only state', async () => {
    await withEnv(env, async () => {
        const db = memoryDb({ mode: 'sandbox', access_token: encrypt('oauth-private'), refresh_token: encrypt('refresh-private'), expires_at: Date.now() + 3600_000 });
        const manager = createMelhorEnvioTokenManager({ db });
        assert.deepEqual(await manager.getToken(), { token: 'oauth-private', source: 'oauth', mode: 'sandbox' });
        const status = await manager.readiness();
        assert.equal(status.oauth_token_present, true);
        assert.equal(status.token_expired, false);
        assert.equal(status.webhook_configured, false);
        assert.equal(status.user_agent_configured, false);
        assert.equal(JSON.stringify(status).includes('private'), false);
    });
});

test('expired OAuth token refreshes, rotates encrypted credentials and uses User-Agent fallback', async () => {
    await withEnv(env, async () => {
        const db = memoryDb({ mode: 'sandbox', access_token: encrypt('old-private'), refresh_token: encrypt('old-refresh'), expires_at: Date.now() - 1 });
        let calls = 0;
        const manager = createMelhorEnvioTokenManager({ db, fetchImpl: async (url, options) => {
            calls++;
            assert.equal(url, 'https://sandbox.melhorenvio.com.br/oauth/token');
            assert.equal(options.headers['User-Agent'], MELHOR_ENVIO_USER_AGENT_FALLBACK);
            assert.equal(JSON.parse(options.body).grant_type, 'refresh_token');
            assert.equal(JSON.parse(options.body).refresh_token, 'old-refresh');
            return { ok: true, json: async () => ({ access_token: 'new-private', refresh_token: 'new-refresh', expires_in: 3600 }) };
        } });
        const result = await manager.getToken();
        assert.equal(result.token, 'new-private');
        assert.equal(result.source, 'oauth');
        assert.equal(calls, 1);
        assert.equal(decrypt(db.stored().access_token), 'new-private');
        assert.equal(decrypt(db.stored().refresh_token), 'new-refresh');
        assert.equal(JSON.stringify(db.stored()).includes('new-private'), false);
        assert.ok(db.stored().expires_at > Date.now());
    });
});

test('failed refresh never falls back or reveals provider tokens', async () => {
    await withEnv(env, async () => {
        const db = memoryDb({ mode: 'sandbox', access_token: encrypt('old-private'), refresh_token: encrypt('old-refresh'), expires_at: 1 });
        const manager = createMelhorEnvioTokenManager({ db, fetchImpl: async () => ({ ok: false, status: 401 }) });
        await assert.rejects(manager.getToken(), error => error.status === 503 && !error.message.includes('private'));
    });
});

test('concurrent requests perform one refresh', async () => {
    await withEnv(env, async () => {
        const db = memoryDb({ mode: 'sandbox', access_token: encrypt('old-private'), refresh_token: encrypt('old-refresh'), expires_at: 1 });
        let calls = 0;
        const manager = createMelhorEnvioTokenManager({ db, fetchImpl: async () => {
            calls++;
            await new Promise(resolve => setTimeout(resolve, 10));
            return { ok: true, json: async () => ({ access_token: 'new-private', refresh_token: 'new-refresh', expires_in: 3600 }) };
        } });
        const results = await Promise.all([manager.getToken(), manager.getToken()]);
        assert.equal(calls, 1);
        assert.equal(results[0].token, results[1].token);
    });
});

test('fixed token requires matching environment and Sandbox OAuth never enters production', async () => {
    await withEnv(env, async () => {
        const manager = createMelhorEnvioTokenManager({ db: memoryDb() });
        assert.equal((await manager.getToken()).source, 'fallback');
        process.env.MELHOR_ENVIO_MODE = 'production';
        await assert.rejects(manager.getToken(), error => error.status === 503);
        process.env.MELHOR_ENVIO_TOKEN_MODE = 'production';
        assert.equal((await manager.getToken()).mode, 'production');
        const oauthDb = memoryDb({ mode: 'sandbox', access_token: encrypt('sandbox-private'), refresh_token: encrypt('refresh-private'), expires_at: Date.now() + 3600_000 });
        await assert.rejects(createMelhorEnvioTokenManager({ db: oauthDb }).getToken(), error => error.status === 503);
    });
});
