import assert from 'node:assert/strict';
import pg from 'pg';
import { resolveCatalogLine } from '../src/lib/orderPricing.js';
import { reserveVariantStock, stockForSize } from '../src/lib/variantStock.js';
import { restoreStock } from '../src/afterSalesService.js';

const url = new URL(process.env.TEST_DATABASE_URL || '');
if (!['localhost', '127.0.0.1'].includes(url.hostname)
    || !url.pathname.slice(1).startsWith('dhelenas_audit_')) {
    throw new Error('TEST_DATABASE_URL must target an isolated local dhelenas_audit_* database');
}
const pool = new pg.Pool({ connectionString: url.href, max: 5 });
const colorId = 'audit-color';

async function transaction(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function productFixture(name, stock) {
    const colors = [{ id: colorId, name: 'Teste', stock }];
    const result = await pool.query(
        'INSERT INTO products (name, price, sizes, colors) VALUES ($1, 50, $2, $3) RETURNING id',
        [name, JSON.stringify(['Único']), JSON.stringify(colors)]
    );
    return result.rows[0].id;
}

async function currentStock(productId) {
    const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [productId]);
    return stockForSize(rows[0], rows[0].colors[0], 'Único');
}

async function reserve(productId, quantity, afterLock = async () => {}) {
    return transaction(async client => {
        const { rows } = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
        const product = rows[0];
        await afterLock();
        const { color, currentStock } = resolveCatalogLine(product,
            { colorId, size: 'Único', qty: quantity });
        reserveVariantStock(product, color, 'Único', quantity);
        await client.query(
            'UPDATE products SET colors = $1, sold_count = sold_count + $2 WHERE id = $3',
            [JSON.stringify(product.colors), quantity, productId]
        );
        await client.query(
            `INSERT INTO stock_movements
             (product_id, type, quantity, color_id, size, previous_stock, new_stock)
             VALUES ($1, 'sale', $2, $3, 'Único', $4, $5)`,
            [productId, -quantity, colorId, currentStock, currentStock - quantity]
        );
    });
}

async function competingReservations(productId, quantity, expectedFinal) {
    let locked;
    let release;
    const lockHeld = new Promise(resolve => { locked = resolve; });
    const mayCommit = new Promise(resolve => { release = resolve; });
    const first = reserve(productId, quantity, async () => { locked(); await mayCommit; });
    await lockHeld;
    let secondSettled = false;
    const second = reserve(productId, quantity).then(
        () => { secondSettled = true; return 'won'; },
        error => { secondSettled = true; return error.status === 409 ? 'stock_rejected' : Promise.reject(error); }
    );
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(secondSettled, false, 'SELECT FOR UPDATE must block the second reservation');
    release();
    await first;
    assert.equal(await second, 'stock_rejected');
    assert.equal(await currentStock(productId), expectedFinal);
    const { rows } = await pool.query(
        "SELECT type, quantity, previous_stock, new_stock FROM stock_movements WHERE product_id = $1 AND type = 'sale'",
        [productId]
    );
    assert.equal(rows.length, 1, 'only one sale movement is committed');
    assert.equal(rows[0].new_stock, expectedFinal);
    return rows[0];
}

try {
    const ordinary = await productFixture('Concorrência normal', { Único: 1 });
    await competingReservations(ordinary, 1, 0);
    console.log('PASS: row lock serialized two reservations; one won, no overselling');

    const rollback = await productFixture('Rollback', { Único: 1 });
    await assert.rejects(transaction(async client => {
        const { rows } = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [rollback]);
        reserveVariantStock(rows[0], rows[0].colors[0], 'Único', 1);
        await client.query('UPDATE products SET colors = $1 WHERE id = $2',
            [JSON.stringify(rows[0].colors), rollback]);
        throw new Error('forced rollback');
    }), /forced rollback/);
    assert.equal(await currentStock(rollback), 1);
    console.log('PASS: rollback preserved stock');

    const legacy = await productFixture('Tamanho Único legado', { P: 1, M: 1 });
    await competingReservations(legacy, 2, 0);
    const { rows: legacyRows } = await pool.query('SELECT colors FROM products WHERE id = $1', [legacy]);
    assert.deepEqual(legacyRows[0].colors[0].stock, { P: 0, M: 0 });
    console.log('PASS: legacy Único bins serialized without negative stock');

    const { rows: users } = await pool.query(
        "INSERT INTO profiles (email, password_hash) VALUES ('audit-local@example.invalid', 'not-a-login') RETURNING id"
    );
    const { rows: orders } = await pool.query(
        `INSERT INTO orders (order_number, user_id, subtotal, total, snapshot)
         VALUES ('AUDIT-LOCAL-1', $1, 100, 100, '{}') RETURNING id`, [users[0].id]
    );
    const { rows: items } = await pool.query(
        `INSERT INTO order_items
         (order_id, product_id, product_name, color_id, color_name, size, quantity, unit_price, subtotal)
         VALUES ($1, $2, 'Tamanho Único legado', $3, 'Teste', 'Único', 2, 50, 100) RETURNING *`,
        [orders[0].id, legacy, colorId]
    );
    const order = orders[0];
    const item = items[0];
    const restored = await Promise.all([
        transaction(client => restoreStock(client, order, item, 2, 'cancellation')),
        transaction(client => restoreStock(client, order, item, 2, 'cancellation')),
    ]);
    assert.deepEqual(restored.sort(), [false, true]);
    assert.equal(await currentStock(legacy), 2);
    const { rows: counts } = await pool.query(
        `SELECT (SELECT COUNT(*)::int FROM stock_restorations WHERE order_item_id = $1) AS restorations,
                (SELECT COUNT(*)::int FROM stock_movements WHERE product_id = $2 AND type = 'cancel') AS movements`,
        [item.id, legacy]
    );
    assert.deepEqual(counts[0], { restorations: 1, movements: 1 });
    console.log('PASS: concurrent cancellation restored legacy Único exactly once');
} finally {
    await pool.end();
}
