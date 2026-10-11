import test from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt } from '../src/lib/crypto.js';
import { pool } from '../src/config/db.js';
import { createMelhorEnvioTokenManager } from '../src/services/melhorEnvioToken.js';
import { melhorEnvioOAuthSettings, isManagedMelhorEnvioConfig, MELHOR_ENVIO_OAUTH_SCOPES } from '../src/services/melhorEnvioEnvironment.js';
import { calculateShipping } from '../src/services/melhorEnvio.js';
import { orderEmailConfig, orderEmailReadiness, buildOrderEmail, sendOrderEmail, EMAIL_EVENTS } from '../src/services/orderEmail.js';

const keys = ['MELHOR_ENVIO_MODE', 'MELHOR_ENVIO_TOKEN', 'MELHOR_ENVIO_TOKEN_MODE', 'INTEGRATION_ENCRYPTION_KEY', 'MELHOR_ENVIO_PRODUCTION_USER_AGENT',
    ...['', 'SANDBOX_', 'PRODUCTION_'].flatMap(prefix => ['CLIENT_ID', 'CLIENT_SECRET', 'REDIRECT_URI'].map(name => 'MELHOR_ENVIO_' + prefix + name))];
async function environment(mode, run) {
    const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    keys.forEach(key => delete process.env[key]);
    Object.assign(process.env, {
        MELHOR_ENVIO_MODE: mode, INTEGRATION_ENCRYPTION_KEY: 'fixture-encryption-only',
        MELHOR_ENVIO_CLIENT_ID: 'sandbox-id', MELHOR_ENVIO_CLIENT_SECRET: 'sandbox-client',
        MELHOR_ENVIO_REDIRECT_URI: 'https://api.example.test/api/integrations/melhor-envio/oauth/callback',
        MELHOR_ENVIO_PRODUCTION_CLIENT_ID: 'production-id', MELHOR_ENVIO_PRODUCTION_CLIENT_SECRET: 'production-client',
        MELHOR_ENVIO_PRODUCTION_REDIRECT_URI: 'https://api.example.test/api/integrations/melhor-envio/oauth/production/callback',
        MELHOR_ENVIO_PRODUCTION_USER_AGENT: 'Fixture (technical@example.test)',
    });
    try { await run(); } finally { for (const [key, value] of Object.entries(before)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}

function store() {
    const data = new Map(['sandbox', 'production'].map(mode => [`melhor_envio_${mode}_oauth`, {
        mode, access_token: encrypt(mode + '-access'), refresh_token: encrypt(mode + '-refresh'), expires_at: Date.now() + 3600000,
    }]));
    const query = async (sql, args) => {
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
        if (sql.startsWith('UPDATE')) { data.set(args[0], JSON.parse(args[1])); return { rows: [] }; }
        return { rows: data.has(args[0]) ? [{ config_data: structuredClone(data.get(args[0])) }] : [] };
    };
    return { data, query, connect: async () => ({ query, release() {} }) };
}

test('Production reads its own encrypted token while Sandbox authorization is preserved', async () => {
    await environment('production', async () => {
        const db = store(), sandbox = structuredClone(db.data.get('melhor_envio_sandbox_oauth'));
        const manager = createMelhorEnvioTokenManager({ db });
        assert.deepEqual(await manager.getToken(), { token: 'production-access', source: 'oauth', mode: 'production' });
        assert.deepEqual(db.data.get('melhor_envio_sandbox_oauth'), sandbox);
        assert.equal((await manager.readiness('sandbox')).active, false);
        assert.equal((await manager.readiness('production')).active, true);
        assert.equal(JSON.stringify(await manager.readiness()).includes('production-access'), false);
    });
});

test('Production refresh uses only production credentials, endpoint, refresh token and row', async () => {
    await environment('production', async () => {
        const db = store(), sandbox = structuredClone(db.data.get('melhor_envio_sandbox_oauth'));
        db.data.get('melhor_envio_production_oauth').expires_at = 1;
        const manager = createMelhorEnvioTokenManager({ db, fetchImpl: async (url, options) => {
            assert.equal(url, 'https://melhorenvio.com.br/oauth/token');
            assert.deepEqual(JSON.parse(options.body), { grant_type: 'refresh_token', client_id: 'production-id', client_secret: 'production-client', refresh_token: 'production-refresh' });
            return { ok: true, json: async () => ({ access_token: 'new-production', refresh_token: 'new-refresh', expires_in: 3600 }) };
        } });
        assert.equal((await manager.getToken()).token, 'new-production');
        assert.equal(decrypt(db.data.get('melhor_envio_production_oauth').refresh_token), 'new-refresh');
        assert.deepEqual(db.data.get('melhor_envio_sandbox_oauth'), sandbox);
    });
});

test('Missing Production authorization does not reuse a valid Sandbox token', async () => {
    await environment('production', async () => {
        const db = store(); db.data.delete('melhor_envio_production_oauth');
        let fetched = false;
        await assert.rejects(createMelhorEnvioTokenManager({ db, fetchImpl: async () => { fetched = true; } }).getToken(), error => error.status === 503);
        assert.equal(fetched, false);
        delete process.env.MELHOR_ENVIO_PRODUCTION_CLIENT_SECRET;
        assert.equal(melhorEnvioOAuthSettings('production'), null);
        assert.ok(melhorEnvioOAuthSettings('sandbox'));
    });
});

test('Malformed, plaintext and wrong-environment OAuth rows fail closed without fallback', async () => {
    await environment('production', async () => {
        for (const invalid of [{ mode: 'sandbox' }, { access_token: 'plaintext' }, { access_token: 'invalid:invalid:invalid' }]) {
            const db = store(); Object.assign(db.data.get('melhor_envio_production_oauth'), invalid);
            process.env.MELHOR_ENVIO_TOKEN = 'fixed-production'; process.env.MELHOR_ENVIO_TOKEN_MODE = 'production';
            delete process.env.MELHOR_ENVIO_PRODUCTION_CLIENT_SECRET;
            await assert.rejects(createMelhorEnvioTokenManager({ db }).getToken(), error => error.status === 503);
        }
    });
});

test('Managed OAuth keys in both environments cannot be edited by generic integration routes', () => {
    for (const key of ['melhor_envio_sandbox_oauth', 'melhor_envio_production_oauth', 'melhor_envio_oauth_state_abc', 'melhor_envio_production_oauth_state_abc', 'melhor_envio_production_oauth_code_abc']) assert.equal(isManagedMelhorEnvioConfig(key), true);
    assert.equal(isManagedMelhorEnvioConfig('email'), false);
    assert.equal(MELHOR_ENVIO_OAUTH_SCOPES.includes('*'), false);
    assert.deepEqual(MELHOR_ENVIO_OAUTH_SCOPES.split(' '), ['shipping-calculate', 'cart-write', 'shipping-checkout', 'shipping-generate', 'shipping-print', 'shipping-tracking', 'users-read']);
});

for (const mode of ['sandbox', 'production']) test(`Freight quote uses ${mode} endpoint and token, with catalog dimensions and no label purchase`, async () => {
    await environment(mode, async () => {
        const db = store(), query = pool.query, fetchImpl = globalThis.fetch;
        let calls = 0;
        pool.query = db.query;
        globalThis.fetch = async (url, options) => {
            calls++;
            assert.equal(url, `https://${mode === 'sandbox' ? 'sandbox.' : ''}melhorenvio.com.br/api/v2/me/shipment/calculate`);
            assert.equal(options.headers.Authorization, `Bearer ${mode}-access`);
            const payload = JSON.parse(options.body);
            assert.equal(payload.products[0].weight, 0.3);
            assert.equal(payload.products[0].height, 4);
            return { ok: true, json: async () => [{ id: 1, name: 'Mock service', price: '12.50', company: { name: 'Mock carrier' }, delivery_time: 3 }] };
        };
        try {
            const quote = await calculateShipping({ fromPostalCode: '01001000', toPostalCode: '02002000', products: [{ id: 'fixture', height: 4, width: 15, length: 20, weight: 0.3, insurance_value: 80, qty: 1 }], totalValue: 80 });
            assert.equal(quote[0].price, 12.5);
            assert.equal(calls, 1);
        } finally { pool.query = query; globalThis.fetch = fetchImpl; }
    });
});

const emailEnv = { EMAIL_FROM: 'Authorized <authorized@example.test>', EMAIL_ALLOWED_SENDERS: 'boutique@example.test', EMAIL_REPLY_TO: 'support@example.test' };
const emailSettings = { emails: { sender_name: "D'Helenas", sender_email: 'boutique@example.test', reply_to: 'reply@example.test' } };
const order = { order_number: 'FIXTURE-ONLY', status: 'recebido', payment_method: 'pix', total: 80, subtotal: 80,
    snapshot: { items: [{ product_name: '<img src=x onerror=alert(1)>', color_name: 'A&B', size: 'M', quantity: 1, subtotal: 80 }] }, shipping_address: { street: '<script>bad</script>' }, user_name: '<b>Fixture</b>' };

test('Configured authorized sender and real Reply-To are connected to a mocked Resend dispatch', async () => {
    let payload;
    const db = { query: async () => ({ rows: Object.entries(emailSettings).map(([key, value]) => ({ key, value })) }) };
    const result = await sendOrderEmail(order, 'recipient@example.test', 'order_created', { db, env: emailEnv, send: async data => { payload = data; return { data: { id: 'mock-only' } }; } });
    assert.equal(result.id, 'mock-only');
    assert.equal(payload.from, "D'Helenas <boutique@example.test>");
    assert.equal(payload.replyTo, 'reply@example.test');
    assert.equal(payload.html.includes('<script>'), false);
    assert.equal(payload.html.includes('<img src=x'), false);
    assert.ok(payload.html.includes('&lt;img'));
    assert.equal(JSON.stringify(payload).includes('RESEND_API_KEY'), false);
});

test('Email has no fictional fallback, header injection or unauthorized sender', () => {
    for (const settings of [{}, { emails: { sender_email: 'attacker@example.test' } }, { emails: { ...emailSettings.emails, reply_to: 'reply@example.test\r\nBcc: victim@example.test' } }, { emails: { ...emailSettings.emails, sender_name: 'name\nBcc:' } }]) {
        assert.throws(() => orderEmailConfig(settings, settings.emails ? emailEnv : {}), error => error.code === 'EMAIL_CONFIG_INVALID');
    }
});

test('Email readiness reports only safe flags and never presumes domain verification', () => {
    const ready = orderEmailReadiness(emailSettings, { ...emailEnv, RESEND_API_KEY: 'private-fixture-key' });
    assert.equal(ready.api_key_configured, true);
    assert.equal(ready.sender_and_reply_to_ready, true);
    assert.equal(ready.domain_verification, 'external_gate');
    assert.equal(JSON.stringify(ready).includes('private-fixture-key'), false);
    assert.equal(JSON.stringify(ready).includes('@'), false);
    assert.equal(orderEmailReadiness({}, {}).sender_and_reply_to_ready, false);
});

test('Every supported transactional event has an event-specific escaped template', () => {
    for (const event of Object.keys(EMAIL_EVENTS)) {
        const payload = buildOrderEmail(order, 'recipient@example.test', event, orderEmailConfig(emailSettings, emailEnv));
        assert.ok(payload.subject.startsWith(EMAIL_EVENTS[event][1]));
        assert.ok(payload.text.includes('FIXTURE-ONLY'));
        assert.equal(payload.html.includes('<b>Fixture</b>'), false);
    }
});

test('Resend API errors and thrown payloads never escape into the caller', async () => {
    const db = { query: async () => ({ rows: Object.entries(emailSettings).map(([key, value]) => ({ key, value })) }) };
    for (const send of [async () => ({ error: { message: 'private-token private-recipient' } }), async () => { throw new Error('private-token private-recipient'); }]) {
        await assert.rejects(sendOrderEmail(order, 'recipient@example.test', 'order_created', { db, env: emailEnv, send }), error => error.code === 'EMAIL_DELIVERY_FAILED' && !error.message.includes('private'));
    }
});
