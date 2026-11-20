// Real PostgreSQL + HTTP middleware, with an isolated Supabase Auth HTTP double.
// This deliberately does not claim validation of hosted GoTrue or Storage.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';

const url = new URL(process.env.TEST_DATABASE_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
assert.ok(url.pathname.startsWith('/dhelenas_audit_'));
process.env.DATABASE_URL = url.href;
process.env.NODE_ENV = 'test';
const db = new pg.Pool({ connectionString: url.href, max: 12 });
const identities = new Map();
const runId = crypto.randomUUID();
const identity = () => ({ id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.invalid`,
    email_confirmed_at: '2026-10-12T00:00:00Z', aud: 'authenticated', role: 'authenticated',
    user_metadata: { full_name: 'Synthetic Profile', role: 'admin' } });
const mockAuth = express();
mockAuth.get('/auth/v1/user', (req, res) => {
    const value = identities.get(req.headers.authorization?.slice(7));
    if (!value) return res.status(401).json({ message: 'Invalid token' });
    res.json(value);
});
const authServer = mockAuth.listen(0, '127.0.0.1');
await new Promise(resolve => authServer.once('listening', resolve));
process.env.SUPABASE_URL = `http://127.0.0.1:${authServer.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-local-only';
const { auth, errorHandler, requireAdmin } = await import('../src/middleware.js');
const { default: authRoutes } = await import('../src/routes/auth.js');
const { pool: appPool } = await import('../src/config/db.js');
const app = express();
app.use(express.json(), auth);
app.use('/api/auth', authRoutes);
app.get('/admin-probe', requireAdmin, (req, res) => res.json({ allowed: true }));
app.use(errorHandler);
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const request = (token, path = '/api/auth/me', options = {}) => fetch(base + path, {
    ...options, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` } });
try {
    const fresh = identity(); identities.set('new', fresh);
    const results = await Promise.all(Array.from({ length: 12 }, () => request('new')));
    for (const result of results) {
        assert.equal(result.status, 200);
        const profile = await result.json();
        assert.equal(profile.id, fresh.id); assert.equal(profile.role, 'customer');
    }
    assert.equal((await db.query('SELECT count(*)::int AS n FROM profiles WHERE id=$1', [fresh.id])).rows[0].n, 1);
    console.log('PASS: 12 concurrent first authenticated requests provision exactly one customer');

    const forbiddenPatch = await request('new', '/api/auth/me', { method: 'PATCH', body: JSON.stringify({ role: 'admin', id: crypto.randomUUID(), full_name: 'Allowed Name' }) });
    assert.equal(forbiddenPatch.status, 400);
    assert.equal((await request('new').then(result => result.json())).role, 'customer');
    const patch = await request('new', '/api/auth/me', { method: 'PATCH', body: JSON.stringify({ full_name: 'Allowed Name' }) });
    assert.equal(patch.status, 200); assert.equal((await patch.json()).role, 'customer');
    assert.equal((await request('new', '/admin-probe')).status, 403);
    console.log('PASS: metadata and HTTP profile updates cannot promote customer');

    await db.query("UPDATE profiles SET role='admin' WHERE id=$1", [fresh.id]);
    assert.equal((await request('new', '/admin-probe')).status, 200);
    assert.equal((await (await request('new')).json()).full_name, 'Allowed Name');
    console.log('PASS: existing profile and server-assigned admin role preserved');

    const legacy = identity(); const legacyId = crypto.randomUUID();
    await db.query("INSERT INTO profiles(id,email,password_hash,role) VALUES ($1,$2,'!synthetic','customer')", [legacyId, legacy.email]);
    identities.set('legacy', legacy);
    assert.equal((await (await request('legacy')).json()).id, legacyId);
    console.log('PASS: unique verified legacy email preserves original profile UUID');

    identities.set('unconfirmed', { ...legacy, email_confirmed_at: null });
    assert.equal((await request('unconfirmed')).status, 401);
    assert.equal((await request('invalid')).status, 401);
    console.log('PASS: invalid tokens and unconfirmed email cannot claim profiles');

    const ambiguous = identity(); identities.set('ambiguous', ambiguous);
    await db.query("INSERT INTO profiles(email,password_hash) VALUES ($1,'!synthetic'),($2,'!synthetic')",
        [ambiguous.email, ambiguous.email.toUpperCase()]);
    assert.equal((await request('ambiguous')).status, 409);
    console.log('PASS: ambiguous email mapping rejected');

    const retry = identity(); identities.set('retry', retry);
    // A transaction lock causes a bounded provisioning failure, then retry.
    const lock = await db.connect();
    try {
        await lock.query('BEGIN');
        await lock.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`supabase-profile:${retry.email}`]);
        assert.equal((await request('retry')).status, 503);
        assert.equal((await db.query('SELECT count(*)::int AS n FROM profiles WHERE id=$1', [retry.id])).rows[0].n, 0);
        await lock.query('ROLLBACK');
    } finally { lock.release(); }
    assert.equal((await request('retry')).status, 200);
    console.log('PASS: lock timeout leaves no partial profile and retry succeeds');
    console.log(`Synthetic run completed (${runId}); no hosted Auth or provider contacted`);
} finally {
    for (const service of [server, authServer]) {
        service.closeAllConnections();
        await new Promise(resolve => service.close(resolve));
    }
    await db.end(); await appPool.end();
}
