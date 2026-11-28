import test from 'node:test';
import assert from 'node:assert/strict';
import { createPendingPaymentReconciliationWorker } from '../src/services/pendingPaymentReconciliation.js';

test('reconciliação de cobranças abandonadas é inerte até ativação controlada', async () => {
    let queries = 0;
    const worker = createPendingPaymentReconciliationWorker({
        env: {}, db: { query: async () => { queries++; return { rows: [] }; } },
        readStatus: async () => { throw new Error('não deveria ser chamada'); },
    });
    worker.start();
    assert.deepEqual(await worker.runOnce(), { checked: 0, disabled: true });
    assert.equal(queries, 0);
    await worker.stop();
});

test('consulta pendências já vinculadas ao provedor; não expira por relógio', async () => {
    const seen = [];
    const queries = [];
    const records = [
        { id: '11111111-1111-4111-8111-111111111111', created_at: new Date('2026-11-22T12:00:00Z') },
        { id: '22222222-2222-4222-8222-222222222222', created_at: new Date('2026-11-22T11:00:00Z') },
    ];
    const db = { query: async (sql, params) => {
        queries.push({ sql, params });
        return { rows: params[0] ? [] : records };
    } };
    const worker = createPendingPaymentReconciliationWorker({
        env: { PAYMENT_PENDING_RECONCILIATION_ENABLED: 'true' }, db,
        readStatus: async order => { seen.push(order.id); return { payment_status: 'pending' }; },
    });
    assert.deepEqual(await worker.runOnce(), { checked: 2, disabled: false });
    assert.deepEqual(seen, records.map(record => record.id));
    assert.match(queries[0].sql, /mercado_pago_order_id IS NOT NULL/);
    assert.match(queries[0].sql, /paid_at IS NULL/);
    assert.match(queries[0].sql, /stock_model' = 'deferred_sale_v1'/);
    assert.match(queries[0].sql, /snapshot \? 'payment_context'/);
    assert.deepEqual(await worker.runOnce(), { checked: 0, disabled: false });
    assert.equal(queries[1].params[1], records[1].id);
    await worker.stop();
});
