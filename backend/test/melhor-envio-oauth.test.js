import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createMelhorEnvioOAuthRouter } from '../src/routes/melhorEnvioOAuth.js';
import { decrypt } from '../src/lib/crypto.js';

const PATH = '/api/integrations/melhor-envio/oauth';

async function fixture({ mode = 'sandbox', admin = true, exchange = async () => ({ access_token: 'private-access', refresh_token: 'private-refresh', expires_in: 3600 }) } = {}) {
    const previous = Object.fromEntries(['MELHOR_ENVIO_MODE', 'MELHOR_ENVIO_CLIENT_ID', 'MELHOR_ENVIO_CLIENT_SECRET', 'MELHOR_ENVIO_REDIRECT_URI', 'MELHOR_ENVIO_PRODUCTION_CLIENT_ID', 'MELHOR_ENVIO_PRODUCTION_CLIENT_SECRET', 'MELHOR_ENVIO_PRODUCTION_REDIRECT_URI', 'MELHOR_ENVIO_PRODUCTION_USER_AGENT', 'INTEGRATION_ENCRYPTION_KEY'].map(k => [k, process.env[k]]));
    Object.assign(process.env, {
        MELHOR_ENVIO_MODE: 'sandbox', MELHOR_ENVIO_CLIENT_ID: '123', MELHOR_ENVIO_CLIENT_SECRET: 'private-client',
        MELHOR_ENVIO_REDIRECT_URI: 'https://api.dhelenas.com/api/integrations/melhor-envio/oauth/callback',
        INTEGRATION_ENCRYPTION_KEY: 'existing-test-key',
    });
    for (const key of ['CLIENT_ID', 'CLIENT_SECRET', 'REDIRECT_URI']) delete process.env['MELHOR_ENVIO_PRODUCTION_' + key];
    if (mode === 'production') Object.assign(process.env, {
        MELHOR_ENVIO_PRODUCTION_CLIENT_ID: 'prod-456', MELHOR_ENVIO_PRODUCTION_CLIENT_SECRET: 'private-production-client',
        MELHOR_ENVIO_PRODUCTION_REDIRECT_URI: 'https://api.dhelenas.com' + PATH + '/production/callback',
        MELHOR_ENVIO_PRODUCTION_USER_AGENT: 'Fixture (technical@example.test)',
    });
    const states = new Map();
    const codes = new Set();
    let saved;
    let savedKey;
    let clock = Date.now();
    const db = {
        async query(sql, args) {
            if (sql.startsWith('DELETE FROM integration_configs WHERE service_key LIKE')) return { rows: [] };
            if (sql.includes("'Código OAuth consumido'")) {
                if (codes.has(args[0])) return { rows: [] };
                codes.add(args[0]);
                return { rows: [{ id: 'claimed' }] };
            }
            if (sql.startsWith('INSERT INTO integration_configs') && args.length === 2) {
                states.set(args[0], JSON.parse(args[1]));
                return { rows: [] };
            }
            if (sql.startsWith('DELETE FROM integration_configs WHERE service_key =')) {
                const value = states.get(args[0]);
                states.delete(args[0]);
                return { rows: value ? [{ config_data: value }] : [] };
            }
            if (sql.startsWith('SELECT id FROM profiles')) return { rows: args[0] === 'admin-one' ? [{ id: 'admin-one' }] : [] };
            if (sql.startsWith('INSERT INTO integration_configs') && args.length === 3) {
                saved = JSON.parse(args[1]);
                savedKey = args[0];
                return { rows: [{ id: 'stored' }] };
            }
            throw new Error('Unexpected query');
        },
    };
    const app = express();
    app.use((req, res, next) => { req.user = { id: 'admin-one', role: admin ? 'admin' : 'customer' }; next(); });
    app.use('/api', createMelhorEnvioOAuthRouter({ db, exchange, now: () => clock }));
    const server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = (path) => fetch(`${origin}${path}`, { redirect: 'manual' });
    const modePath = mode === 'production' ? PATH + '/production' : PATH;
    const authorize = async () => {
        const response = await fetch(`${origin}${modePath}/authorize`, { headers: { Accept: 'application/json' } });
        assert.equal(response.status, 200);
        const { authorization_url } = await response.json();
        const url = new URL(authorization_url);
        assert.equal(url.origin, mode === 'sandbox' ? 'https://sandbox.melhorenvio.com.br' : 'https://melhorenvio.com.br');
        assert.equal(url.pathname, '/oauth/authorize');
        assert.equal(url.searchParams.get('response_type'), 'code');
        assert.equal(url.searchParams.get('redirect_uri'), process.env[mode === 'sandbox' ? 'MELHOR_ENVIO_REDIRECT_URI' : 'MELHOR_ENVIO_PRODUCTION_REDIRECT_URI']);
        assert.equal(url.searchParams.get('scope').includes('shipping-calculate'), true);
        assert.equal(authorization_url.includes('private-client'), false);
        return url.searchParams.get('state');
    };
    return {
        request, authorize, states, modePath, getSaved: () => saved, getSavedKey: () => savedKey, advance: ms => { clock += ms; },
        async close() {
            await new Promise(resolve => server.close(resolve));
            for (const [key, value] of Object.entries(previous)) {
                if (value === undefined) delete process.env[key]; else process.env[key] = value;
            }
        },
    };
}

test('callback rejects missing code and consumes state', async () => {
    const f = await fixture();
    try {
        const state = await f.authorize();
        const first = await f.request(`${PATH}/callback?state=${state}`);
        assert.equal(first.status, 400);
        assert.equal((await first.text()).includes('Código de autorização ausente'), true);
        assert.equal((await f.request(`${PATH}/callback?state=${state}&code=again`)).status, 400);
    } finally { await f.close(); }
});

test('Production authorization uses isolated credentials, callback and encrypted store without changing the active mode', async () => {
    const f = await fixture({ mode: 'production', exchange: async (code, config) => {
        assert.equal(config.mode, 'production');
        assert.equal(config.clientId, 'prod-456');
        assert.equal(config.base, 'https://melhorenvio.com.br');
        return { access_token: 'private-production-access', refresh_token: 'private-production-refresh', expires_in: 3600 };
    } });
    try {
        const state = await f.authorize();
        assert.equal((await f.request(`${f.modePath}/callback?state=${state}&code=prod-one`)).status, 303);
        assert.equal(f.getSavedKey(), 'melhor_envio_production_oauth');
        assert.equal(f.getSaved().mode, 'production');
        assert.equal(decrypt(f.getSaved().access_token), 'private-production-access');
        assert.equal(decrypt(f.getSaved().refresh_token), 'private-production-refresh');
        assert.equal(process.env.MELHOR_ENVIO_MODE, 'sandbox');
    } finally { await f.close(); }
});

test('Production cannot borrow legacy Sandbox client credentials', async () => {
    const f = await fixture();
    try { assert.equal((await f.request(`${PATH}/production/authorize`)).status, 503); }
    finally { await f.close(); }
});

test('OAuth state cannot cross environments and the original Sandbox state remains usable', async () => {
    const f = await fixture({ mode: 'production' });
    try {
        const productionState = await f.authorize();
        assert.equal((await f.request(`${PATH}/callback?state=${productionState}&code=wrong-environment`)).status, 400);
        assert.equal((await f.request(`${f.modePath}/callback?state=${productionState}&code=right-environment`)).status, 303);
    } finally { await f.close(); }
});

test('OAuth state binds the exact client and redirect configuration', async () => {
    const f = await fixture({ mode: 'production' });
    try {
        const state = await f.authorize();
        process.env.MELHOR_ENVIO_PRODUCTION_CLIENT_ID = 'changed-app';
        assert.equal((await f.request(`${f.modePath}/callback?state=${state}&code=one`)).status, 400);
        assert.equal(f.getSaved(), undefined);
    } finally { await f.close(); }
});

test('Production callback requires HTTPS and an exact dedicated redirect path', async () => {
    const f = await fixture({ mode: 'production' });
    try {
        process.env.MELHOR_ENVIO_PRODUCTION_REDIRECT_URI = 'http://api.example.test' + PATH + '/production/callback';
        assert.equal((await f.request(`${f.modePath}/authorize`)).status, 503);
        process.env.MELHOR_ENVIO_PRODUCTION_REDIRECT_URI = 'https://api.example.test' + PATH + '/callback';
        assert.equal((await f.request(`${f.modePath}/authorize`)).status, 503);
    } finally { await f.close(); }
});

test('Customer cannot initiate either OAuth environment', async () => {
    const f = await fixture({ mode: 'production', admin: false });
    try {
        assert.equal((await f.request(`${PATH}/authorize`)).status, 403);
        assert.equal((await f.request(`${f.modePath}/authorize`)).status, 403);
    } finally { await f.close(); }
});

test('callback rejects invalid, expired and reused states', async () => {
    const f = await fixture();
    try {
        assert.equal((await f.request(`${PATH}/callback?state=invalid&code=one`)).status, 400);
        const expired = await f.authorize();
        f.advance(10 * 60 * 1000 + 1);
        assert.equal((await f.request(`${PATH}/callback?state=${expired}&code=one`)).status, 400);
        const state = await f.authorize();
        assert.equal((await f.request(`${PATH}/callback?state=${state}&code=one`)).status, 303);
        assert.equal((await f.request(`${PATH}/callback?state=${state}&code=one`)).status, 400);
        const anotherState = await f.authorize();
        assert.equal((await f.request(`${PATH}/callback?state=${anotherState}&code=one`)).status, 400);
    } finally { await f.close(); }
});

test('token exchange failure is sanitized and cannot be replayed', async () => {
    const f = await fixture({ exchange: async () => { throw new Error('private-client private-access'); } });
    try {
        const state = await f.authorize();
        const response = await f.request(`${PATH}/callback?state=${state}&code=one`);
        assert.equal(response.status, 502);
        const body = await response.text();
        assert.equal(body.includes('private-client'), false);
        assert.equal(body.includes('private-access'), false);
        assert.equal((await f.request(`${PATH}/callback?state=${state}&code=one`)).status, 400);
    } finally { await f.close(); }
});

test('successful callback stores encrypted Sandbox tokens and redirects to a clean URL', async () => {
    const f = await fixture();
    try {
        const state = await f.authorize();
        const response = await f.request(`${PATH}/callback?state=${state}&code=one`);
        assert.equal(response.status, 303);
        assert.equal(response.headers.get('location'), `${PATH}/result`);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const stored = f.getSaved();
        assert.equal(stored.mode, 'sandbox');
        assert.equal(stored.authorized_by, 'admin-one');
        assert.equal(stored.access_token.includes('private-access'), false);
        assert.equal(stored.refresh_token.includes('private-refresh'), false);
        assert.equal(decrypt(stored.access_token), 'private-access');
        assert.equal(decrypt(stored.refresh_token), 'private-refresh');
        const result = await f.request(response.headers.get('location'));
        assert.equal((await result.text()).includes('private-'), false);
    } finally { await f.close(); }
});
