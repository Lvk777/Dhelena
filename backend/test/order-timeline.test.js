import test from 'node:test';
import assert from 'node:assert/strict';
import { orderEventLabel } from '../../src/lib/orderTimeline.js';

test('approved order presents its old pending event as history, without mutating events', () => {
    const event = Object.freeze({ event: 'payment_pending', description: 'original event', created_at: '2026-10-07T05:10:00Z' });
    assert.equal(orderEventLabel(event, 'approved'), 'Pagamento inicialmente pendente');
    assert.equal(event.event, 'payment_pending');
    assert.equal(orderEventLabel({ event: 'payment_approved' }, 'approved'), 'Pagamento confirmado');
});

test('an unpaid order still displays the current waiting state', () => {
    assert.equal(orderEventLabel({ event: 'payment_pending' }, 'pending'), 'Aguardando pagamento');
});

test('timeline preserves unknown event descriptions', () => {
    assert.equal(orderEventLabel({ event: 'custom', description: 'original description' }, 'approved'), 'original description');
});
