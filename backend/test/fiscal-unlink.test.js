import test from 'node:test';
import assert from 'node:assert/strict';
import { assertFiscalUnlinkEligible, validateFiscalUnlink } from '../src/services/fiscalUnlink.js';
import { requireSupabaseAdmin } from '../src/middleware.js';

const reviewed = { document_id: '11111111-1111-4111-8111-111111111111',
    reason: 'Documento fiscal vinculado ao pedido incorreto', official_source: 'national',
    prior_official_status: 'authorized', confirmed_official_check: true, confirmed_not_cancellation: true };

test('unlink requires an official review, explicit acknowledgement and a useful reason', () => {
    assert.equal(validateFiscalUnlink(reviewed).priorStatus, 'authorized');
    for (const changed of [{ reason: 'curto' }, { official_source: '' }, { prior_official_status: '' },
        { confirmed_official_check: false }, { confirmed_not_cancellation: false }, { document_id: 'stale' }]) {
        assert.throws(() => validateFiscalUnlink({ ...reviewed, ...changed }), error => error.status === (changed.document_id ? 409 : 422));
    }
});

test('uncertain cart may be reviewed without changing shipping state; identified and bought labels block unlink', () => {
    const uncertain = { shipping_status: 'cart_inflight', melhor_envio_shipment_id: null };
    assert.doesNotThrow(() => assertFiscalUnlinkEligible(uncertain));
    assert.equal(uncertain.shipping_status, 'cart_inflight');
    for (const order of [{ ...uncertain, melhor_envio_shipment_id: 'shipment-1' },
        { shipping_status: 'purchased' }, { shipping_status: 'delivered' }]) {
        assert.throws(() => assertFiscalUnlinkEligible(order), error => error.status === 409);
    }
    assert.throws(() => assertFiscalUnlinkEligible(null), error => error.status === 404);
});

test('fiscal changes require an authenticated Supabase administrator', () => {
    let status, nextCalled = false;
    const res = { status(value) { status = value; return this; }, json() { return this; } };
    requireSupabaseAdmin({ user: null }, res, () => { nextCalled = true; });
    assert.equal(status, 401);
    requireSupabaseAdmin({ user: { role: 'admin' }, authProvider: 'local' }, res, () => { nextCalled = true; });
    assert.equal(status, 401);
    requireSupabaseAdmin({ user: { role: 'customer' }, authProvider: 'supabase' }, res, () => { nextCalled = true; });
    assert.equal(status, 403);
    assert.equal(nextCalled, false);
});
