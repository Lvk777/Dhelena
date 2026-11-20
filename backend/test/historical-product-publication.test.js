import test from 'node:test';
import assert from 'node:assert/strict';
import { assertHistoricalProductCanPublish } from '../src/lib/historicalProductPublication.js';

const id = '11111111-1111-4111-8111-111111111111';

test('linked historical products cannot be republished', async () => {
    const client = { query: async (_sql, args) => {
        assert.deepEqual(args, [id]);
        return { rows: [{ has_history: true }] };
    } };
    await assert.rejects(() => assertHistoricalProductCanPublish(client, { id, status: 'archived', sold_count: 0 }, 'published'), { status: 409 });
});

test('legacy sales count blocks republishing even without a linked order', async () => {
    const client = { query: async () => ({ rows: [{ has_history: false }] }) };
    await assert.rejects(() => assertHistoricalProductCanPublish(client, { id, status: 'draft', sold_count: 1 }, 'published'), { status: 409 });
});

test('new unsold draft can be published and archived product can stay archived', async () => {
    let calls = 0;
    const client = { query: async () => { calls++; return { rows: [{ has_history: false }] }; } };
    await assertHistoricalProductCanPublish(client, { id, status: 'draft', sold_count: 0 }, 'published');
    await assertHistoricalProductCanPublish(client, { id, status: 'archived', sold_count: 3 }, 'archived');
    assert.equal(calls, 1);
});
