// Synthetic local Express-mode smoke test. Does not call payment providers,
// Supabase Auth, Supabase Storage, or production services.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

const dbUrl = new URL(process.env.DATABASE_URL || '');
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(dbUrl.hostname));
assert.ok(dbUrl.pathname === '/dhelenas_rls_stage_20261011' || /^\/dhelenas_audit_security_[a-z0-9_]+$/.test(dbUrl.pathname));
const port = Number(process.env.PORT || 3107);
assert.ok(Number.isInteger(port) && port > 1024 && port < 65536);
const base = `http://127.0.0.1:${port}`;

async function request(path, options = {}) {
  const response = await fetch(base + path, options);
  const body = response.headers.get('content-type')?.includes('json')
    ? await response.json() : null;
  return { status: response.status, body };
}
const json = (body, token) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});
const auth = (token) => ({ headers: { authorization: `Bearer ${token}` } });

assert.equal((await request('/health')).status, 200);
const products = await request('/api/products?limit=2');
assert.equal(products.status, 200);
assert.equal(products.body.length, 1);
const productId = products.body[0].id;
assert.equal((await request('/api/categories')).status, 200);
assert.equal((await request('/api/collections')).status, 200);

const runId = crypto.randomUUID().slice(0, 8);
const email = `rls-http-${runId}@example.test`;
const password = 'SyntheticOnly!1234';
const registered = await request('/api/auth/register', json({ email, password, full_name: 'Synthetic HTTP User' }));
assert.equal(registered.status, 201);
const customerToken = registered.body.token;
assert.ok(customerToken);
assert.equal((await request('/api/auth/me', auth(customerToken))).status, 200);
assert.equal((await request('/api/addresses', auth(customerToken))).status, 200);
assert.equal((await request('/api/orders', auth(customerToken))).status, 200);
assert.equal((await request('/api/users', auth(customerToken))).status, 403);

const coupon = await request('/api/coupons/validate', json({
  code: 'SYNTHETIC10', items: [{ productId, qty: 1 }],
}, customerToken));
assert.equal(coupon.status, 200);
assert.equal(coupon.body.valid, true);

const db = new pg.Client({ connectionString: dbUrl.toString() });
await db.connect();
try {
  const profile = await db.query('SELECT id,role FROM public.profiles WHERE email=$1', [email]);
  assert.equal(profile.rowCount, 1);
  assert.equal(profile.rows[0].role, 'customer');
  await db.query("UPDATE public.profiles SET role='admin' WHERE email=$1", [email]);
} finally {
  await db.end();
}

const loggedIn = await request('/api/auth/login', json({ email, password }));
assert.equal(loggedIn.status, 200);
const adminToken = loggedIn.body.token;
assert.ok(adminToken);
assert.equal((await request('/api/users', auth(adminToken))).status, 200);
assert.equal((await request('/api/coupons', auth(adminToken))).status, 200);

const category = await request('/api/categories', json({
  name: 'Synthetic Admin Category', slug: `synthetic-admin-category-${runId}`,
}, adminToken));
assert.equal(category.status, 201);

const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/le8AAAAASUVORK5CYII=', 'base64');
const form = new FormData();
form.set('folder', 'category');
form.set('file', new Blob([image], { type: 'image/png' }), 'synthetic.png');
const uploaded = await request('/api/upload', {
  method: 'POST', headers: { authorization: `Bearer ${adminToken}` }, body: form,
});
assert.equal(uploaded.status, 200);
assert.ok(uploaded.body.file_url.startsWith('/api/uploads/'));
assert.equal((await fetch(base + uploaded.body.file_url)).status, 200);

console.log('PASS: local Express registration/profile, login, catalog, coupon/cart preview, admin read/write, local upload, order list (no order created)');
