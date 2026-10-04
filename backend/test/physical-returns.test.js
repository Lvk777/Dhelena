import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { pool } from '../src/config/db.js';
import afterSalesRoutes from '../src/routes/afterSales.js';
import { advanceReturn, createReturn } from '../src/afterSalesService.js';
import { nextReturnStatus } from '../src/lib/afterSalesPolicy.js';

function fixture(status = 'em_transito_retorno') {
    const state = {
        order: { id: 'order-1', order_number: 'DH-MOCK', status: 'entregue', payment_status: 'approved' },
        entry: { id: 'return-1', order_id: 'order-1', status },
        item: { return_item_id: 'return-item-1', return_quantity: 1, id: 'item-1',
            product_id: 'product-1', color_id: 'color-1', size: 'M', quantity: 1 },
        stock: 7, restored: false, movements: 0, refundWrites: 0, queries: [], condition: null,
    };
    const client = { async query(sql, values = []) {
        state.queries.push(sql);
        if (/\b(INSERT INTO|UPDATE|DELETE FROM)\s+order_refunds\b/i.test(sql)) state.refundWrites++;
        if (sql.includes('SELECT order_id FROM order_returns')) return { rows: [{ order_id: state.entry.order_id }] };
        if (sql.includes('SELECT * FROM orders WHERE id')) return { rows: [state.order] };
        if (sql.includes('SELECT * FROM order_returns WHERE id')) return { rows: [{ ...state.entry }] };
        if (sql.includes('SELECT ri.id AS return_item_id')) return { rows: [state.item] };
        if (sql.includes('UPDATE order_return_items SET restockable')) {
            state.condition = { restockable: values[0], note: values[1] };
            return { rows: [] };
        }
        if (sql.includes('INSERT INTO stock_restorations')) {
            if (state.restored) return { rows: [] };
            state.restored = true;
            return { rows: [{ id: 'restore-1' }] };
        }
        if (sql.includes('FROM stock_restorations')) return { rows: [{ quantity: 0 }] };
        if (sql.includes('SELECT colors FROM products')) return { rows: [{ colors: [
            { id: 'color-1', stock: { M: state.stock } },
        ] }] };
        if (sql.includes('UPDATE products SET colors')) {
            state.stock = JSON.parse(values[0])[0].stock.M;
            return { rows: [] };
        }
        if (sql.includes('INSERT INTO stock_movements')) { state.movements++; return { rows: [] }; }
        if (sql.includes('UPDATE order_returns SET status')) {
            state.entry.status = values[0];
            return { rows: [{ ...state.entry }] };
        }
        return { rows: [] };
    } };
    let queue = Promise.resolve();
    const transaction = callback => {
        const work = queue.then(() => callback(client));
        queue = work.catch(() => {});
        return work;
    };
    return { state, transaction };
}

test('physical return follows every state without skipping; legacy financial state is terminal', () => {
    const path = ['solicitada', 'autorizada', 'aguardando_postagem', 'em_transito_retorno', 'recebida'];
    for (let i = 0; i < path.length - 1; i++) assert.equal(nextReturnStatus(path[i], path[i + 1]), true);
    for (const from of ['solicitada', 'autorizada', 'aguardando_postagem']) {
        assert.throws(() => nextReturnStatus(from, 'recebida'));
    }
    assert.equal(nextReturnStatus('solicitada', 'recusada'), true);
    assert.equal(nextReturnStatus('solicitada', 'cancelada'), true);
    assert.equal(nextReturnStatus('autorizada', 'cancelada'), true);
    assert.equal(nextReturnStatus('aguardando_postagem', 'cancelada'), true);
    assert.equal(nextReturnStatus('recebida', 'recebida'), false);
    for (const terminal of ['reembolso_processado', 'recusada', 'cancelada']) {
        assert.throws(() => nextReturnStatus(terminal, 'recebida'));
    }
});

test('receiving a sellable item twice or concurrently restores exactly one unit without refund', async () => {
    const { state, transaction } = fixture();
    const args = ['return-1', 'admin-1', 'recebida', { 'return-item-1': true },
        { expectedOrderId: 'order-1', conditionNotes: { 'return-item-1': 'Sem sinais de uso' } }, transaction];
    const results = await Promise.all([advanceReturn(...args), advanceReturn(...args)]);
    assert.deepEqual(results.map(row => row.status), ['recebida', 'recebida']);
    assert.equal(state.stock, 8);
    assert.equal(state.movements, 1);
    assert.equal(state.condition.restockable, true);
    assert.equal(state.refundWrites, 0);
    assert.equal(state.queries.filter(sql => sql.includes('INSERT INTO stock_restorations')).length, 1);
});

test('receiving a non-sellable item records condition without restoring stock', async () => {
    const { state, transaction } = fixture();
    await advanceReturn('return-1', 'admin-1', 'recebida', { 'return-item-1': false },
        { expectedOrderId: 'order-1', conditionNotes: { 'return-item-1': 'Peça danificada' } }, transaction);
    assert.equal(state.stock, 7);
    assert.equal(state.restored, false);
    assert.equal(state.movements, 0);
    assert.equal(state.condition.note, 'Peça danificada');
    assert.equal(state.refundWrites, 0);
});

test('canceled and cross-order returns cannot be received; missing classification does not mutate stock', async () => {
    for (const status of ['cancelada', 'recusada', 'solicitada']) {
        const { state, transaction } = fixture(status);
        await assert.rejects(advanceReturn('return-1', 'admin-1', 'recebida',
            { 'return-item-1': true }, { expectedOrderId: 'order-1',
                conditionNotes: { 'return-item-1': 'Sem uso' } }, transaction));
        assert.equal(state.stock, 7);
    }
    const { state, transaction } = fixture();
    await assert.rejects(advanceReturn('return-1', 'admin-1', 'recebida',
        { 'return-item-1': true }, { expectedOrderId: 'other-order',
            conditionNotes: { 'return-item-1': 'Sem uso' } }, transaction), { status: 404 });
    await assert.rejects(advanceReturn('return-1', 'admin-1', 'recebida', {},
        { expectedOrderId: 'order-1', conditionNotes: {} }, transaction), { status: 400 });
    assert.equal(state.stock, 7);
});

test('authorization and posting never restore stock; posting instructions are required', async () => {
    const { state, transaction } = fixture('solicitada');
    await advanceReturn('return-1', 'admin-1', 'autorizada', {}, { expectedOrderId: 'order-1' }, transaction);
    await assert.rejects(advanceReturn('return-1', 'admin-1', 'aguardando_postagem', {},
        { expectedOrderId: 'order-1' }, transaction), { status: 400 });
    await advanceReturn('return-1', 'admin-1', 'aguardando_postagem', {},
        { expectedOrderId: 'order-1', postingInstructions: 'Postar em agência dos Correios.' }, transaction);
    await advanceReturn('return-1', 'admin-1', 'em_transito_retorno', {},
        { expectedOrderId: 'order-1', reverseTrackingCode: 'MOCK123' }, transaction);
    assert.equal(state.stock, 7);
    assert.equal(state.movements, 0);
    assert.equal(state.restored, false);
    assert.equal(state.refundWrites, 0);
});

test('return request validates purchased quantity, order stage and closed financial evidence', async () => {
    const state = { order: { id: 'order-1', order_number: 'DH-MOCK',
        status: 'entregue', payment_status: 'approved' }, inserts: 0, selected: 0, stockWrites: 0 };
    const client = { async query(sql) {
        if (sql.includes('SELECT * FROM orders WHERE id')) return { rows: [state.order] };
        if (sql.includes('SELECT * FROM order_items')) return { rows: [{ id: 'item-1', quantity: 1 }] };
        if (sql.includes('SELECT ri.order_item_id')) return { rows: state.selected
            ? [{ order_item_id: 'item-1', quantity: state.selected }] : [] };
        if (sql.includes('INSERT INTO order_returns')) { state.inserts++; return { rows: [{ id: 'return-new' }] }; }
        if (sql.includes('INSERT INTO order_return_items')) { state.selected++; return { rows: [] }; }
        if (/\b(INSERT INTO|UPDATE)\s+(stock_movements|stock_restorations|products)\b/i.test(sql)) state.stockWrites++;
        return { rows: [] };
    } };
    const transaction = callback => callback(client);
    await assert.rejects(createReturn('order-1', 'customer-1',
        [{ order_item_id: 'item-1', quantity: 2 }], 'Tamanho errado', transaction), { status: 400 });
    state.order.status = 'em_separacao';
    await assert.rejects(createReturn('order-1', 'customer-1',
        [{ order_item_id: 'item-1', quantity: 1 }], 'Tamanho errado', transaction), { status: 409 });
    state.order.status = 'entregue';
    state.order.order_number = 'DH-2026-000006';
    await assert.rejects(createReturn('order-1', 'customer-1',
        [{ order_item_id: 'item-1', quantity: 1 }], 'Tamanho errado', transaction), { status: 409 });
    assert.equal(state.inserts, 0);
    state.order.order_number = 'DH-MOCK';
    const created = await createReturn('order-1', 'customer-1',
        [{ order_item_id: 'item-1', quantity: 1 }], 'Tamanho errado', transaction);
    assert.equal(created.id, 'return-new');
    await assert.rejects(createReturn('order-1', 'customer-1',
        [{ order_item_id: 'item-1', quantity: 1 }], 'Tamanho errado', transaction), { status: 400 });
    assert.equal(state.inserts, 1);
    assert.equal(state.stockWrites, 0);
});

test('customer cannot read another order, mutate a return or access an admin return from another order', async () => {
    const original = pool.query;
    pool.query = async sql => ({ rows: sql.includes('SELECT id FROM orders WHERE id') ? [] : [] });
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: 'customer-1',
        role: req.get('x-test-role') === 'admin' ? 'admin' : 'customer' }; next(); });
    app.use('/api', afterSalesRoutes);
    const server = await new Promise(resolve => {
        const running = app.listen(0, '127.0.0.1', () => resolve(running));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        assert.equal((await fetch(`${base}/api/orders/other/after-sales`)).status, 404);
        assert.equal((await fetch(`${base}/api/orders/other/returns`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: [{ order_item_id: 'item-1', quantity: 1 }], reason: 'Não serviu' }),
        })).status, 404);
        assert.equal((await fetch(`${base}/api/orders/other/returns/return-1`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'recebida', restockable: { 'return-item-1': true } }),
        })).status, 403);
        assert.equal((await fetch(`${base}/api/orders/other/returns/return-1`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-test-role': 'admin' },
            body: JSON.stringify({ status: 'recebida', restockable: { 'return-item-1': true } }),
        })).status, 404);
    } finally {
        pool.query = original;
        await new Promise(resolve => server.close(resolve));
    }
});
