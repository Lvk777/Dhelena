import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { parseOperationalStart, readLaunchSummary } from '../src/services/launchSummary.js';

if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL obrigatório para banco descartável');
assert.throws(() => parseOperationalStart({ start_at: '2026-02-31T00:00:00Z' }), /inválido/);
assert.throws(() => parseOperationalStart({ start_at: '2026-10-20T00:00:00-03:00' }), /inválido/);

const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await client.connect();
try {
    await client.query('BEGIN');
    await client.query(`CREATE TEMP TABLE settings (key text, value jsonb);
        CREATE TEMP TABLE products (id text, status text);
        CREATE TEMP TABLE orders (id text, order_number text, user_id text, status text,
            payment_status text, total numeric(10,2), created_at timestamptz, paid_at timestamptz);
        CREATE TEMP TABLE order_refunds (order_id text, amount numeric(10,2), status text);
        CREATE TEMP TABLE order_items (order_id text, product_name text, subtotal numeric(10,2));`);
    const startAt = new Date(Date.now() - 60_000).toISOString();
    await client.query('INSERT INTO settings VALUES ($1, $2)', ['operational_start', { start_at: startAt }]);
    await client.query("INSERT INTO products VALUES ('old-product', 'archived')");
    await client.query(`INSERT INTO orders VALUES
        ('historical', 'DH-OLD', 'old-buyer', 'entregue', 'approved', 100,
            now() - interval '2 minutes', now() - interval '2 minutes')`);
    let summary = await readLaunchSummary(client);
    assert.equal(summary.orders, 0);
    assert.equal(summary.net_revenue, 0);
    assert.equal(summary.profit, 0);
    assert.equal(summary.published_products, 0);

    await client.query(`INSERT INTO orders VALUES
        ('pending', 'DH-NEW-1', 'pending-only', 'recebido', 'pending', 70, now(), NULL),
        ('paid', 'DH-NEW-2', 'new-buyer', 'pagamento_aprovado', 'partially_refunded', 50, now(), now()),
        ('refunded', 'DH-NEW-3', 'second-buyer', 'cancelado', 'refunded', 10, now(), now());
        INSERT INTO order_refunds VALUES ('paid', 20, 'processed'), ('paid', 5, 'failed'), ('refunded', 10, 'processed');
        INSERT INTO order_items VALUES ('paid', 'Nova peça fictícia', 50), ('refunded', 'Outra peça fictícia', 10);
        INSERT INTO products VALUES ('new-product', 'published');`);
    summary = await readLaunchSummary(client);
    assert.equal(summary.orders, 3);
    assert.equal(summary.paid_orders, 2);
    assert.equal(summary.buyers, 2);
    assert.equal(summary.gross_paid, 60);
    assert.equal(summary.refunds, 30);
    assert.equal(summary.net_revenue, 30);
    assert.equal(summary.average_paid_order, 30);
    assert.equal(summary.profit, null);
    assert.equal(summary.published_products, 1);
    assert.equal(summary.top_products[0].name, 'Nova peça fictícia');
    assert.equal(summary.daily.reduce((sum, day) => sum + Number(day.revenue), 0), 30);
    assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM orders')).rows[0].count, 4);
    await client.query('ROLLBACK');

    // Execute the exact proposed cutover and recovery SQL only against TEMP
    // tables in this disposable database; no production connection is used.
    await client.query(`CREATE TEMP TABLE settings (key text PRIMARY KEY, value jsonb, is_public boolean);
        CREATE TEMP TABLE products (id uuid PRIMARY KEY, sku text UNIQUE, status text, updated_date timestamptz);
        CREATE TEMP TABLE orders (id text, order_number text, user_id text, status text,
            payment_status text, total numeric(10,2), created_at timestamptz, paid_at timestamptz);
        CREATE TEMP TABLE order_refunds (order_id text, amount numeric(10,2), status text);
        CREATE TEMP TABLE order_items (order_id text, product_name text, subtotal numeric(10,2));`);
    await client.query("INSERT INTO settings(key,value,is_public) VALUES ('maintenance', '{\"maintenance_mode\":true}', true)");
    const document = readFileSync(new URL('../docs/launch-zero-production-preview-2026-10-21.md', import.meta.url), 'utf8');
    const products = [...document.matchAll(/^\| (DH-[A-Z]+-\d+) \| ([0-9a-f-]{36}) \|/gm)];
    assert.equal(products.length, 14);
    for (const [, sku, id] of products) {
        await client.query('INSERT INTO products(id,sku,status) VALUES ($1,$2,$3)', [id, sku, 'published']);
    }
    const [cutover, recovery] = [...document.matchAll(/```sql\n([\s\S]*?)\n```/g)].map(match => match[1]);
    assert.ok(cutover && recovery);
    await client.query(cutover);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM products WHERE status='published'")).rows[0].count, 0);
    assert.equal((await client.query("SELECT is_public FROM settings WHERE key='operational_start'")).rows[0].is_public, false);
    summary = await readLaunchSummary(client);
    assert.equal(summary.net_revenue, 0);
    assert.equal(summary.published_products, 0);
    await client.query(recovery);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM products WHERE status='published'")).rows[0].count, 14);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM settings WHERE key='operational_start'")).rows[0].count, 0);
    await client.query("INSERT INTO products(id,sku,status) VALUES ('99999999-9999-4999-8999-999999999999','DH-TEST-999','published')");
    await assert.rejects(client.query(cutover), /Pré-condições da virada divergiram/);
    await client.query('ROLLBACK');
    assert.equal((await client.query("SELECT count(*)::int AS count FROM products WHERE status='published'")).rows[0].count, 15);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM settings WHERE key='operational_start'")).rows[0].count, 0);
    console.log('launch_zero_readiness: marco, venda, reembolso, arquivamento e recuperação em banco descartável OK');
} finally {
    await client.query('ROLLBACK');
    await client.end();
}
