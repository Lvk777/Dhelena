import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import catalogRouter, { catalogWriteKeys } from '../src/routes/catalog.js';
import ordersRouter from '../src/routes/orders.js';
import { pool } from '../src/config/db.js';
import { loadProductPages } from '../../src/lib/catalogPaging.js';

test('catalog writes accept form fields but reject unknown SQL identifiers and server-owned columns', () => {
    assert.deepEqual(catalogWriteKeys('products', { name: 'Fixture', sizes: ['P'], colors: [] }), ['name', 'sizes', 'colors']);
    assert.deepEqual(catalogWriteKeys('banners', { button_link: '/loja', image_mobile: '/image' }), ['button_link', 'image_mobile']);
    assert.deepEqual(catalogWriteKeys('categories', { description: '', status: 'active' }), ['description', 'status']);
    assert.deepEqual(catalogWriteKeys('collections', { banner_image: '', featured: false, start_date: null }), ['banner_image', 'featured', 'start_date']);
    for (const payload of [{ 'name) VALUES (1); DROP TABLE products; --': 'x' }, { sold_count: 100 }, { id: 'fixture' }, {}]) {
        assert.throws(() => catalogWriteKeys('products', payload), error => error.status === 400);
    }
});

test('maintenance blocks customer order creation before any order mutation', async () => {
    const originalQuery = pool.query;
    const queries = [];
    pool.query = async sql => {
        queries.push(sql);
        return { rows: [{ value: { maintenance_mode: true } }] };
    };
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: 'fixture', role: 'customer' }; next(); });
    app.use('/api', ordersRouter);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/orders`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: [] }),
        });
        assert.equal(response.status, 503);
        assert.equal(queries.length, 1);
        assert.match(queries[0], /FROM settings WHERE key = 'maintenance'/);
    } finally {
        pool.query = originalQuery;
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});

test('public categories and collections retain active filters with parameterized query fields', async () => {
    const originalQuery = pool.query;
    const queries = [];
    let legacySchema = false;
    pool.query = async (sql, values) => {
        queries.push({ sql, values });
        if (legacySchema && sql.includes("status = 'active'")) {
            throw Object.assign(new Error('missing optional column'), { code: '42703' });
        }
        return { rows: [] };
    };
    const app = express();
    app.use('/api', catalogRouter);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
        const root = `http://127.0.0.1:${server.address().port}/api`;
        assert.equal((await fetch(`${root}/categories?slug=fixture`)).status, 200);
        assert.match(queries[0].sql, /slug = \$1 AND status = 'active'/);
        assert.deepEqual(queries[0].values, ['fixture']);
        assert.equal((await fetch(`${root}/collections?featured=true`)).status, 200);
        assert.match(queries[1].sql, /featured = \$1 AND status = 'active'/);
        assert.match(queries[1].sql, /start_date IS NULL OR start_date <= now\(\)/);
        assert.deepEqual(queries[1].values, [true]);
        legacySchema = true;
        assert.equal((await fetch(`${root}/categories?slug=fixture`)).status, 200);
        assert.deepEqual(queries[3].values, ['fixture']);
        assert.doesNotMatch(queries[3].sql, /status = 'active'/);
        assert.equal((await fetch(`${root}/collections?slug=fixture`)).status, 200);
        assert.deepEqual(queries[5].values, ['fixture']);
        assert.doesNotMatch(queries[5].sql, /start_date IS NULL/);
    } finally {
        pool.query = originalQuery;
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});

test('product page loader includes later pages and fails closed on malformed or truncated data', async () => {
    const calls = [];
    const products = await loadProductPages(async (size, page) => {
        calls.push([size, page]);
        return page === 1 ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }];
    }, 2);
    assert.deepEqual(products.map(item => item.id), [1, 2, 3]);
    assert.deepEqual(calls, [[2, 1], [2, 2]]);
    await assert.rejects(loadProductPages(async () => null, 2));
    await assert.rejects(loadProductPages(async () => [{ id: 1 }], 1, 2));
});

test('catalog HTTP page two uses a bounded offset and malicious write keys never reach SQL', async () => {
    const originalQuery = pool.query;
    const queries = [];
    pool.query = async (sql, values) => {
        queries.push({ sql, values });
        return { rows: [] };
    };
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: 'fixture', role: 'admin' }; next(); });
    app.use('/api', catalogRouter);
    app.use((error, req, res, next) => res.status(error.status || 500).json({ error: 'Controlled failure' }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
        const root = `http://127.0.0.1:${server.address().port}/api`;
        const page = await fetch(`${root}/products?limit=200&page=2`);
        assert.equal(page.status, 200);
        assert.match(queries[0].sql, /ORDER BY created_date DESC, id DESC LIMIT 200 OFFSET 200$/);
        const writesBefore = queries.length;
        const bad = await fetch(`${root}/products`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Fixture', price: 1, sold_count: 100 }),
        });
        assert.equal(bad.status, 400);
        assert.equal(queries.length, writesBefore);
        const invalidLimit = await fetch(`${root}/categories?limit=not-a-number`);
        assert.equal(invalidLimit.status, 400);
        assert.equal(queries.length, writesBefore);
    } finally {
        pool.query = originalQuery;
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});
