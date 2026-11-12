import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPublicSettingsRecords } from './publicSettingsRequest.js';

const base = 'https://api.example.test/api';
const rows = [{ key: 'maintenance', is_public: true, value: { maintenance_mode: true } }];

test('public maintenance request excludes session credentials and accepts ON', async () => {
    let sent;
    const result = await fetchPublicSettingsRecords(base, async (url, options) => {
        sent = { url, options };
        return { ok: true, json: async () => rows };
    });
    assert.deepEqual(result, rows);
    assert.equal(sent.url, 'https://api.example.test/api/settings?is_public=true');
    assert.equal(sent.options.credentials, 'omit');
    assert.equal(sent.options.headers.Authorization, undefined);
    assert.equal(sent.options.headers['Content-Type'], undefined);
});

test('missing or invalid maintenance state fails closed', async () => {
    for (const invalid of [
        [],
        [{ key: 'maintenance', is_public: true, value: {} }],
        [{ key: 'maintenance', is_public: true, value: { maintenance_mode: 'false' } }],
        [{ key: 'maintenance', is_public: false, value: { maintenance_mode: false } }],
        [rows[0], rows[0]],
    ]) {
        await assert.rejects(() => fetchPublicSettingsRecords(base, async () => ({ ok: true, json: async () => invalid })));
    }
    await assert.rejects(() => fetchPublicSettingsRecords(base, async () => ({ ok: false })));
});

test('explicit maintenance OFF is a valid confirmed state', async () => {
    const result = await fetchPublicSettingsRecords(base, async () => ({
        ok: true, json: async () => [{ key: 'maintenance', is_public: true, value: { maintenance_mode: false } }],
    }));
    assert.equal(result[0].value.maintenance_mode, false);
});
