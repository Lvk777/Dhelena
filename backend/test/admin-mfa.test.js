import test from 'node:test';
import assert from 'node:assert/strict';
import { adminAssuranceAllowed, adminRequestRequiresStepUp } from '../src/middleware.js';

test('admin AAL2 gate remains off until controlled activation', () => {
    assert.equal(adminAssuranceAllowed({ user: { role: 'admin' } }, { ADMIN_AAL2_REQUIRED: 'false' }), true);
});

test('admin AAL2 gate rejects password, email OTP, OAuth and local sessions at AAL1', () => {
    const env = { ADMIN_AAL2_REQUIRED: 'true' };
    for (const provider of ['supabase', 'local', undefined]) {
        assert.equal(adminAssuranceAllowed({ authProvider: provider, supabaseSession: { aal: 'aal1' } }, env), false);
    }
    assert.equal(adminAssuranceAllowed({ authProvider: 'supabase', supabaseSession: null }, env), false);
    assert.equal(adminAssuranceAllowed({ authProvider: 'supabase', supabaseSession: { aal: 'aal2' } }, env), true);
});

test('AAL1 administrators can inspect identity to complete enrollment but cannot reach another API path', () => {
    const env = { ADMIN_AAL2_REQUIRED: 'true' };
    const req = { user: { role: 'admin' }, authProvider: 'supabase', supabaseSession: { aal: 'aal1' }, method: 'GET', path: '/api/auth/me' };
    assert.equal(adminRequestRequiresStepUp(req, env), false);
    for (const [method, path] of [['PATCH', '/api/auth/me'], ['GET', '/api/admin/launch-summary'],
        ['POST', '/api/products'], ['POST', '/api/orders/1/payment/card'], ['GET', '/api/auth/code/start']]) {
        assert.equal(adminRequestRequiresStepUp({ ...req, method, path }, env), true);
    }
    assert.equal(adminRequestRequiresStepUp({ ...req, user: { role: 'customer' }, path: '/api/orders' }, env), false);
});
