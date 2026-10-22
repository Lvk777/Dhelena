import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticateSupabaseProfile, ensureSupabaseProfile } from '../src/lib/supabaseProfile.js';
import { requireAdmin } from '../src/middleware.js';
import { catalogWriteKeys, validateProductForPublication } from '../src/routes/catalog.js';

const user = { id: 'verified-id', email: 'Verified@Example.invalid', email_confirmed_at: '2026-10-12T00:00:00Z', user_metadata: { full_name: ' Customer ', role: 'admin' } };
const customer = { id: user.id, email: user.email.toLowerCase(), role: 'customer' };
function database(answers, { linkTable = false } = {}) {
    const calls = [];
    let released = false;
    const client = { async query(sql, values) {
        calls.push({ sql, values });
        if (sql.includes("to_regclass('public.profile_auth_links')")) return { rows: [{ relation: linkTable ? 'profile_auth_links' : null }] };
        if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL|SELECT pg_advisory)/.test(sql)) return { rows: [] };
        const answer = answers.shift();
        if (answer instanceof Error) throw answer;
        assert.ok(answer, `Unexpected query: ${sql}`);
        return { rows: answer };
    }, release() { released = true; } };
    return { query: client.query, connect: async () => client, calls, get released() { return released; } };
}

test('new verified signup provisions a customer by immutable Auth ID and ignores metadata roles', async () => {
    const db = database([[], [], [], [customer]]);
    assert.deepEqual(await ensureSupabaseProfile(db, user), customer);
    const insert = db.calls.find(c => c.sql.startsWith('INSERT'));
    assert.deepEqual(insert.values, [user.id, 'verified@example.invalid', 'Customer']);
    assert.match(insert.sql, /'customer'/);
    assert.match(insert.sql, /ON CONFLICT DO NOTHING/);
    assert.equal(db.calls.at(-1).sql, 'COMMIT');
    assert.equal(db.released, true);
});

test('an existing profile keeps its role and fields without writes', async () => {
    const admin = { ...customer, role: 'admin' };
    const db = database([[admin]]);
    assert.deepEqual(await ensureSupabaseProfile(db, user), admin);
    assert.equal(db.calls.length, 1);
});

test('profile created while waiting on the lock is reused', async () => {
    const db = database([[], [customer]]);
    assert.deepEqual(await ensureSupabaseProfile(db, user), customer);
    assert.equal(db.calls.some(c => c.sql.startsWith('INSERT')), false);
});

test('a unique verified customer email preserves its legacy UUID and order associations', async () => {
    const legacy = { ...customer, id: 'legacy-id' };
    const db = database([[], [], [legacy]]);
    assert.deepEqual(await ensureSupabaseProfile(db, user), legacy);
    assert.equal(db.calls.some(c => /^(INSERT|UPDATE|DELETE)/.test(c.sql)), false);
});

test('a verified email alone cannot claim an unlinked legacy administrator', async () => {
    const legacy = { ...customer, id: 'legacy-admin-id', role: 'admin' };
    const db = database([[], [], [legacy]]);
    await assert.rejects(ensureSupabaseProfile(db, user), { status: 409 });
    assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
    assert.equal(db.calls.some(c => /^(INSERT|UPDATE|DELETE)/.test(c.sql)), false);
});

test('an explicit UUID link admits the legacy admin and a valid synthetic product without changing either UUID', async () => {
    const legacy = { ...customer, id: 'legacy-admin-id', email: 'legacy@example.invalid', role: 'admin' };
    const updated = { ...legacy, email: customer.email };
    const db = database([[], [], [legacy], [updated]], { linkTable: true });
    const profile = await ensureSupabaseProfile(db, user);
    assert.equal(profile.id, legacy.id);
    assert.equal(profile.role, 'admin');
    assert.equal(profile.identity_linked, true);
    assert.deepEqual(db.calls.filter(call => /^(INSERT|UPDATE|DELETE)/.test(call.sql)).map(call => call.sql.split(' ')[0]), ['UPDATE']);
    assert.deepEqual(db.calls.find(call => call.sql.startsWith('UPDATE')).values, [customer.email, legacy.id]);
    const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    let admitted = false;
    requireAdmin({ user: profile }, response, () => { admitted = true; });
    assert.equal(admitted, true);
    const product = { name: 'Peça fictícia', sku: 'TEST-001', status: 'published', price: 100,
        sizes: ['P'], colors: [{ id: 'blue', name: 'Azul', stock: { P: 2 } }],
        weight: 0.3, package_height: 2, package_width: 20, package_length: 30 };
    assert.deepEqual(catalogWriteKeys('products', product), Object.keys(product));
    assert.equal(validateProductForPublication(product), undefined);
});

test('ambiguous legacy emails fail closed and roll back', async () => {
    const db = database([[], [], [customer, customer]]);
    await assert.rejects(ensureSupabaseProfile(db, user), { status: 409 });
    assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
    assert.equal(db.released, true);
});

test('unconfirmed email, anonymous identity and missing identity cannot claim any profile', async () => {
    for (const identity of [{ ...user, email_confirmed_at: null }, { ...user, is_anonymous: true }, { ...user, id: null }, { ...user, email: null }]) {
        const db = database([]);
        await assert.rejects(ensureSupabaseProfile(db, identity), { status: 401 });
        assert.equal(db.calls.length, 0);
    }
});

test('a concurrent Auth trigger insert is reused without overwriting privileges', async () => {
    const db = database([[], [], [], [], [customer]]);
    assert.deepEqual(await ensureSupabaseProfile(db, user), customer);
    assert.equal(db.released, true);
});

test('a conflicting email insertion never authenticates a different ID', async () => {
    const db = database([[], [], [], [], []]);
    await assert.rejects(ensureSupabaseProfile(db, user), { status: 409 });
    assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
});

test('database failure rolls back and releases the connection', async () => {
    const db = database([[], [], [], new Error('synthetic failure')]);
    await assert.rejects(ensureSupabaseProfile(db, user), /synthetic failure/);
    assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
    assert.equal(db.released, true);
});

test('invalid Supabase tokens never query or provision profiles', async () => {
    const db = database([]);
    const admin = { auth: { getUser: async () => ({ data: { user }, error: { status: 401 } }) } };
    assert.equal(await authenticateSupabaseProfile(admin, db, 'invalid'), null);
    assert.equal(db.calls.length, 0);
});

test('Supabase outages propagate as retryable 503 without profile writes', async () => {
    const db = database([]);
    const admin = { auth: { getUser: async () => ({ data: {}, error: { status: 503 } }) } };
    await assert.rejects(authenticateSupabaseProfile(admin, db, 'token'), { status: 503 });
    assert.equal(db.calls.length, 0);
});

test('only getUser returned identity reaches provisioning', async () => {
    const db = database([[customer]]);
    const admin = { auth: { getUser: async token => {
        assert.equal(token, 'validated-token');
        return { data: { user }, error: null };
    } } };
    assert.deepEqual(await authenticateSupabaseProfile(admin, db, 'validated-token'), customer);
});

test('confirmed Auth email synchronizes only the matching immutable profile without changing role or UUID', async () => {
    const previous = { ...customer, email: 'old@example.invalid', role: 'admin', phone: 'preserved' };
    const updated = { ...previous, email: customer.email };
    const db = database([[previous], [updated]]);
    assert.deepEqual(await ensureSupabaseProfile(db, { ...user, new_email: 'unconfirmed@example.invalid' }), updated);
    const write = db.calls.find(c => c.sql.startsWith('UPDATE'));
    assert.deepEqual(write.values, [customer.email, user.id]);
    assert.doesNotMatch(write.sql.split('WHERE')[0], /role\s*=|\bid\s*=/);
});
test('an unconfirmed email never replaces the profile email', async () => {
    const db = database([[customer]]);
    assert.deepEqual(await ensureSupabaseProfile(db, { ...user, new_email: 'unconfirmed@example.invalid' }), customer);
    assert.equal(db.calls.length, 1);
});
test('conflicting confirmed email fails closed instead of binding another account', async () => {
    const db = database([[{ ...customer, email: 'old@example.invalid' }], Object.assign(new Error('unique conflict'), { code: '23505' })]);
    await assert.rejects(ensureSupabaseProfile(db, user), { status: 409 });
    assert.equal(db.calls.filter(c => c.sql.startsWith('UPDATE')).length, 1);
});
test('a missing profile during synchronization is unavailable and not silently authenticated', async () => {
    const db = database([[{ ...customer, email: 'old@example.invalid' }], []]);
    await assert.rejects(ensureSupabaseProfile(db, user), { status: 503 });
});
