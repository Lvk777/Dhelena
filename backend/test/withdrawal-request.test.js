import assert from 'node:assert/strict';
import test from 'node:test';
import { requestWithdrawal, assertNoWithdrawalRequest } from '../src/lib/withdrawalRequest.js';

function fixture() {
    const state = { queries: [], event: null };
    const client = { async query(sql, params = []) {
        state.queries.push(sql);
        if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
        if (sql.includes('FROM orders WHERE id')) return { rows: [{ id: params[0], user_id: 'customer-1' }] };
        if (sql.includes('FROM order_events')) return { rows: state.event ? [state.event] : [] };
        if (sql.includes('INSERT INTO order_events')) {
            state.event = { id: 'request-1', created_at: '2026-10-21T12:00:00Z' };
            return { rows: [state.event] };
        }
        throw new Error(`Unexpected query: ${sql}`);
    } };
    return { state, client, transaction: callback => callback(client) };
}

test('withdrawal notice is owned, idempotent, and never starts a financial operation', async () => {
    const { state, transaction } = fixture();
    const user = { id: 'customer-1', role: 'customer' };
    const first = await requestWithdrawal('order-1', user, transaction);
    const second = await requestWithdrawal('order-1', user, transaction);
    assert.deepEqual(first, { request_id: 'request-1', received_at: '2026-10-21T12:00:00Z', already_received: false });
    assert.deepEqual(second, { ...first, already_received: true });
    assert.equal(state.queries.filter(sql => sql.includes('INSERT INTO order_events')).length, 1);
    assert.equal(state.queries.some(sql => /\b(INSERT|UPDATE|DELETE)\b[\s\S]*\b(orders|order_refunds|stock_movements|notification_logs)\b/i.test(sql)), false);
    await assert.rejects(() => assertNoWithdrawalRequest({ query: (...args) => fixtureQuery(state, ...args) }, 'order-1',
        { WITHDRAWAL_REQUESTS_ENABLED: 'true' }), { status: 409 });
});

async function fixtureQuery(state, sql) {
    if (!sql.includes('FROM order_events')) throw new Error('Unexpected query');
    return { rows: state.event ? [state.event] : [] };
}

test('another customer cannot register a withdrawal on this order', async () => {
    const { state, transaction } = fixture();
    await assert.rejects(() => requestWithdrawal('order-1', { id: 'customer-2', role: 'customer' }, transaction), { status: 404 });
    assert.equal(state.queries.some(sql => sql.includes('INSERT INTO order_events')), false);
});

test('disabled feature leaves existing payment and shipping paths without extra database reads', async () => {
    await assertNoWithdrawalRequest({ query: () => { throw new Error('unexpected database read'); } },
        'order-1', { WITHDRAWAL_REQUESTS_ENABLED: 'false' });
});
