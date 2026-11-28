import test from 'node:test';
import assert from 'node:assert/strict';
import { safeNavigation, httpsOrigin, instagramLink, whatsappLink, validEmail, validCnpjFormat, safeMelhorEnvioAuthorizationUrl } from '../src/lib/navigation.js';
import { publicSetting, validateSettingValue } from '../src/lib/publicSettings.js';
import { validateBannerLinks } from '../src/routes/catalog.js';
import express from 'express';
import catalogRouter from '../src/routes/catalog.js';
import { pool } from '../src/config/db.js';
import { noStore } from '../src/middleware/noStore.js';
import { primaryBannerCta } from '../../src/lib/banners.js';

const adversarial = ['javascript:alert(1)', 'data:text/html,bad', 'http://evil.example', '//evil.example', '/\\evil.example', '/.//evil.example', '/x/..//evil.example', '/%2f%2fevil.example', '/%255cevil.example', '/%00bad', '/%250abad', ' /loja', '/loja\n', 'https://approved.example@evil.example/', 'https://approved.example.evil.example/', 'https://approved.example:444/', 'https://approved.example\\@evil.example/', 'https:evil.example', 'not-a-url', '/%zz', 42, {}, false];
for (const value of adversarial) test(`CMS navigation rejects adversarial destination ${JSON.stringify(value)}`, () => {
    assert.equal(safeNavigation(value, { allowedOrigins: ['https://approved.example'] }), null);
});

test('Internal paths, fragments and expressly authorized exact HTTPS origins remain valid', () => {
    assert.deepEqual(safeNavigation('/loja?cat=vestidos#pecas'), { href: '/loja?cat=vestidos#pecas', external: false });
    assert.equal(safeNavigation('https://dhelenas.com/sobre').external, false);
    assert.equal(safeNavigation('#novidades').external, false);
    assert.equal(safeNavigation('https://approved.example/collection', { allowedOrigins: ['https://approved.example'] }).external, true);
    assert.equal(safeNavigation('https://approved.example/collection'), null);
    assert.equal(httpsOrigin('https://approved.example/path'), null);
});

test('OAuth navigation accepts only the official authorization host for the selected environment', () => {
    assert.ok(safeMelhorEnvioAuthorizationUrl('production', 'https://melhorenvio.com.br/oauth/authorize?state=fixture-only'));
    assert.equal(safeMelhorEnvioAuthorizationUrl('sandbox', 'https://melhorenvio.com.br/oauth/authorize'), null);
    assert.equal(safeMelhorEnvioAuthorizationUrl('production', 'https://evil.example/oauth/authorize'), null);
    assert.equal(safeMelhorEnvioAuthorizationUrl('production', 'https://melhorenvio.com.br/other'), null);
});

test('Edited banner CTA overrides legacy fields and clearing it does not resurrect a stale link', () => {
    assert.equal(primaryBannerCta({ primary_cta_link: '/old', button_link: '/new' }).href, '/new');
    assert.equal(primaryBannerCta({ primary_cta_link: '/old', button_link: '' }).href, '');
    assert.equal(primaryBannerCta({ primary_cta_link: '/old' }).href, '/old');
});

test('Banner API rejects unsafe primary, secondary and legacy links before persistence', async () => {
    const db = { query: async sql => { assert.ok(sql.startsWith('SELECT')); return { rows: [{ value: { external_link_origins: ['https://approved.example'] } }] }; } };
    for (const field of ['button_link', 'primary_cta_link', 'secondary_cta_link']) {
        await assert.rejects(validateBannerLinks({ [field]: '//evil.example' }, db), error => error.status === 400);
        await validateBannerLinks({ [field]: '/loja' }, db);
        await validateBannerLinks({ [field]: 'https://approved.example/collection' }, db);
    }
});

test('Public settings never reveal private sender, origin, email settings or unexpected nested fields', () => {
    for (const key of ['address', 'shipping_sender', 'emails', 'notifications', 'unknown']) assert.equal(publicSetting({ key, is_public: true, value: { private: 'private' } }), null);
    const result = publicSetting({ key: 'general', is_public: true, value: { company_name: 'Fixture', public_address: 'Public fixture', private_sender: 'PRIVATE', token: 'PRIVATE', external_link_origins: [] } });
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
    assert.equal(result.value.public_address, 'Public fixture');
    assert.equal(publicSetting({ key: 'general', is_public: false, value: {} }), null);
    const pickup = publicSetting({ key: 'shipping', is_public: true, value: { pickup_address: 'Public pickup fixture', pickup_instructions: 'Appointment', sender_document: 'PRIVATE' } });
    assert.equal(pickup.value.pickup_instructions, 'Appointment');
    assert.equal(JSON.stringify(pickup).includes('PRIVATE'), false);
});

test('Empty client fields are accepted while malformed email, CNPJ, WhatsApp and allowlists are rejected', () => {
    validateSettingValue('general', { email: '', cnpj: '', whatsapp: '', external_link_origins: [] });
    validateSettingValue('general', { cnpj: '12.ABC.345/01DE-35' });
    for (const value of [{ email: 'invalid' }, { cnpj: '00.000.000/0000-00' }, { whatsapp: '00000000000' }, { external_link_origins: ['http://evil.example'] }, { external_link_origins: ['https://approved.example/path'] }]) assert.throws(() => validateSettingValue('general', value), error => error.status === 400);
    assert.throws(() => validateSettingValue('emails', { reply_to: 'valid@example.test\r\nBcc: bad' }), error => error.status === 400);
});

test('Social links reject protocol tricks and absent placeholder channels stay absent', () => {
    assert.equal(instagramLink(''), null);
    assert.equal(instagramLink('https://instagram.com'), null);
    assert.equal(instagramLink('javascript:alert(1)'), null);
    assert.equal(instagramLink('@boutique_fixture'), 'https://www.instagram.com/boutique_fixture/');
    assert.equal(whatsappLink('https://wa.me/5500000000000'), null);
    assert.equal(whatsappLink('00000000000'), null);
    assert.equal(whatsappLink('https://evil.example/5511999999999'), null);
    assert.equal(whatsappLink('(11) 91234-5678'), 'https://wa.me/5511912345678');
    assert.equal(validEmail('valid@example.test'), true);
    assert.equal(validCnpjFormat('00.000.000/0001-00'), false);
    assert.equal(validCnpjFormat('00.000.000/E08G-12'), true);
    assert.equal(validCnpjFormat('00.000.000/0000-00'), false);
});

test('Anonymous HTTP settings responses redact legacy misclassified private records and nested data', async () => {
    const original = pool.query;
    pool.query = async () => ({ rows: [
        { key: 'shipping_sender', is_public: true, value: { document: 'PRIVATE' } },
        { key: 'address', is_public: true, value: { street: 'PRIVATE' } },
        { key: 'general', is_public: true, value: { public_address: 'Public fixture', private: 'PRIVATE' } },
    ] });
    const app = express(); app.use('/api', noStore, catalogRouter);
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    try {
        const r = await fetch(`http://127.0.0.1:${server.address().port}/api/settings`);
        assert.equal(r.headers.get('cache-control'), 'no-store');
        const payload = await r.json();
        assert.equal(payload.length, 1); assert.equal(payload[0].value.public_address, 'Public fixture');
        assert.equal(JSON.stringify(payload).includes('PRIVATE'), false);
    } finally { pool.query = original; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('CMS HTTP validation rejects unsafe links and invalid settings on every write route without persistence', async () => {
    const original = pool.query; let writes = 0;
    pool.query = async sql => {
        if (!sql.startsWith('SELECT')) { writes++; throw new Error('Writes forbidden in this fixture'); }
        return { rows: sql.includes('SELECT key') ? [{ key: 'emails' }] : [{ value: {} }] };
    };
    const app = express(); app.use(express.json());
    app.use((req, res, next) => { req.user = { id: 'fixture', role: 'admin' }; next(); });
    app.use('/api', noStore, catalogRouter); app.use((error, req, res, next) => res.status(error.status || 500).json({ error: 'Controlled failure' }));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    try {
        for (const [method, path, body] of [
            ['POST', '/banners', { button_link: '/\\evil.example' }], ['PATCH', '/banners/fixture', { primary_cta_link: '//evil.example' }],
            ['POST', '/settings', { key: 'emails', value: { reply_to: 'bad' } }], ['PATCH', '/settings/fixture', { value: { reply_to: 'bad' } }],
            ['PUT', '/settings/emails', { value: { reply_to: 'bad' } }],
        ]) {
            const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
            assert.equal(r.status, 400); assert.equal(r.headers.get('cache-control'), 'no-store');
        }
        assert.equal(writes, 0);
    } finally { pool.query = original; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
