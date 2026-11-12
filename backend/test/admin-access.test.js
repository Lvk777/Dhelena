import test from 'node:test';
import assert from 'node:assert/strict';
import { accessReadiness, readAdminAccess, changeAdminAccess } from '../src/services/adminAccess.js';
import { requireAdmin } from '../src/middleware.js';
const owner = { id: '11111111-1111-4111-8111-111111111111', role: 'admin', authProvider: 'supabase', identityVerified: true };
const target = '22222222-2222-4222-8222-222222222222';
const env = { ADMIN_ACCESS_MANAGEMENT_ENABLED: 'true' };
function fixture({ actorActive = true, authority = 'staff', role = 'customer', active = false, missing = false } = {}) {
    const calls = [];
    const db = { async query(sql, params) {
        calls.push({ sql, params });
        if (sql.includes('to_regclass')) return { rows: [{ relation: 'admin_authorities' }] };
        if (/SET LOCAL|pg_advisory/.test(sql)) return { rows: [] };
        if (sql.includes("JOIN admin_authorities")) return { rows: actorActive ? [{ id: owner.id }] : [] };
        if (sql.includes('SELECT id,role')) return { rows: missing ? [] : [{ id: target, role }] };
        if (sql.includes('SELECT authority,active')) return { rows: [{ authority, active }] };
        if (sql.includes("authority='owner'")) return { rows: actorActive ? [{ profile_id: owner.id }] : [] };
        if (sql.includes('LEFT JOIN')) return { rows: [{ id: target, role, active }] };
        return { rows: [] };
    } };
    return { calls, options: { db, env, transaction: fn => fn(db) } };
}
test('current database without migration or activation is compatible and performs no access writes', async () => {
    let queried = false; const db = { query() { queried = true; throw Error('must not query'); } };
    assert.equal(await accessReadiness(db, {}), false);
    assert.deepEqual(await readAdminAccess(owner, { db, env: {} }), { available: false, can_manage: false, collaborators: [] });
    await assert.rejects(changeAdminAccess(owner, target, { grant: true }, { db, env: {} }), { status: 503 });
    assert.equal(queried, false);
    assert.equal(await accessReadiness({ query: async () => ({ rows: [{ relation: null }] }) }, env), false);
});
test('customers, Express JWT and email-only legacy admins cannot grant roles', async () => {
    for (const actor of [{ ...owner, role: 'customer' }, { ...owner, authProvider: 'express' }, { ...owner, identityVerified: false }]) {
        const f = fixture(); await assert.rejects(changeAdminAccess(actor, target, { grant: true }, f.options), { status: 403 }); assert.equal(f.calls.length, 0);
    }
});
test('admin role alone cannot list or manage collaborators without active owner authority', async () => {
    const f = fixture({ actorActive: false });
    assert.deepEqual(await readAdminAccess(owner, f.options), { available: true, can_manage: false, collaborators: [] });
    await assert.rejects(changeAdminAccess(owner, target, { grant: true }, f.options), { status: 403 });
    assert.equal(f.calls.some(c => c.sql.startsWith('UPDATE')), false);
});
test('requests cannot forge roles, create owners, change own access or select invalid IDs', async () => {
    for (const [id, body] of [[target, { grant: true, role: 'admin' }], [target, { grant: true, authority: 'owner' }], [owner.id, { grant: false }], ['invalid', { grant: true }], [target, { grant: 'true' }]]) {
        const f = fixture(); await assert.rejects(changeAdminAccess(owner, id, body, f.options), { status: 400 });
        assert.equal(f.calls.some(c => c.sql.startsWith('UPDATE')), false);
    }
});
test('owner accounts cannot be revoked or overwritten and unknown accounts are not created', async () => {
    const f = fixture({ authority: 'owner' }); await assert.rejects(changeAdminAccess(owner, target, { grant: false }, f.options), { status: 403 });
    const g = fixture({ missing: true }); await assert.rejects(changeAdminAccess(owner, target, { grant: true }, g.options), { status: 404 });
    for (const item of [f, g]) assert.equal(item.calls.some(c => c.sql.startsWith('UPDATE')), false);
});
test('authorized grant locks and rechecks owner authority, preserves personal fields and records actor', async () => {
    const f = fixture(); assert.deepEqual(await changeAdminAccess(owner, target, { grant: true }, f.options), { success: true });
    const lock = f.calls.findIndex(c => c.sql.includes('pg_advisory'));
    assert.ok(lock < f.calls.findIndex(c => c.sql.includes('JOIN admin_authorities')));
    const write = f.calls.find(c => c.sql.startsWith('UPDATE')); assert.deepEqual(write.params, ['admin', target]);
    assert.doesNotMatch(write.sql, /email|password|full_name/);
    const audit = f.calls.find(c => c.sql.startsWith('INSERT INTO audit_logs')); assert.equal(JSON.parse(audit.params[1]).actor_id, owner.id);
});
test('repeated grants and revocations are idempotent without duplicate audit or role writes', async () => {
    for (const grant of [true, false]) {
        const f = fixture({ role: grant ? 'admin' : 'customer', active: grant });
        assert.deepEqual(await changeAdminAccess(owner, target, { grant }, f.options), { success: true, unchanged: true });
        assert.equal(f.calls.some(c => /^(UPDATE|INSERT)/.test(c.sql)), false);
    }
});
test('revocation changes only staff authority and role; next request denies admin access even with the old token role', async () => {
    const f = fixture({ role: 'admin', active: true }); await changeAdminAccess(owner, target, { grant: false }, f.options);
    assert.deepEqual(f.calls.find(c => c.sql.startsWith('UPDATE')).params, ['customer', target]);
    const res = { status(value) { this.code = value; return this; }, json(value) { this.body = value; } };
    let passed = false; requireAdmin({ user: { id: target, role: 'customer' } }, res, () => { passed = true; });
    assert.equal(passed, false); assert.equal(res.code, 403);
});
test('concurrent stale owner request is rejected by the transactional authority recheck', async () => {
    const f = fixture({ actorActive: false });
    await Promise.all([assert.rejects(changeAdminAccess(owner, target, { grant: true }, f.options), { status: 403 }), assert.rejects(changeAdminAccess(owner, target, { grant: false }, f.options), { status: 403 })]);
    assert.equal(f.calls.some(c => /^(UPDATE|INSERT)/.test(c.sql)), false);
});
