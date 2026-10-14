import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import lookRouter from '../src/routes/look.js';
import { pool } from '../src/config/db.js';

test('look promotion preview derives subtotal from published catalog rows', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const originalQuery = pool.query;
    const queries = [];
    pool.query = async (sql, values) => {
        queries.push({ sql, values });
        if (sql.includes('FROM products')) return { rows: [{ id, price: 100, sale_price: 80, category: 'vestidos' }] };
        if (sql.includes('FROM look_promotions')) return { rows: [{ name: 'Fixture', discount_percent: 10, discount_fixed: 0, min_items: 1, min_value: 50, applicable_category: 'vestidos', free_shipping: false }] };
        throw new Error('Unexpected query');
    };
    const app = express(); app.use(express.json()); app.use('/api', lookRouter);
    app.use((error, req, res, next) => res.status(error.status || 500).json({ error: 'Controlled failure' }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
        const url = `http://127.0.0.1:${server.address().port}/api/look-promotions/validate`;
        const request = body => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const response = await request({ items: [{ productId: id, qty: 2 }], subtotal: 1000000 });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).discount, 16);
        assert.equal(queries.length, 2);
        const bad = await request({ items: [{ productId: id, qty: -1 }], subtotal: 1000000 });
        assert.equal(bad.status, 400);
        assert.equal(queries.length, 2);
    } finally {
        pool.query = originalQuery;
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});
