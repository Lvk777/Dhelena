// Destructive work is confined to an empty, disposable localhost database.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';

const url = new URL(process.env.TEST_DATABASE_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
assert.match(url.pathname, /^\/dhelenas_audit_reservation_[a-z0-9_]+$/);
const db = new pg.Pool({ connectionString: url.href });
const files = await fs.readdir(new URL('../migrations/', import.meta.url));
const migration = async n => {
    const file = files.find(value => value.startsWith(`${String(n).padStart(3, '0')}_`) && value.endsWith('.sql'));
    assert.ok(file, `migration ${n}`);
    await db.query(await fs.readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
};

try {
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0);
    for (let n = 1; n <= 17; n++) await migration(n);
    const profile = (await db.query(
        "INSERT INTO profiles(email,password_hash) VALUES('legacy-fixture@example.invalid','not-a-login') RETURNING id")).rows[0];
    const product = (await db.query(
        `INSERT INTO products(name,sku,price,sizes,colors,status,sold_count,weight,package_height,package_width,package_length)
         VALUES('Legacy fixture','LEGACY-FIXTURE',10,$1,$2,'archived',1,0.5,10,20,30) RETURNING id`,
        [JSON.stringify(['G']), JSON.stringify([{ id: 'bege', name: 'Bege', stock: { G: 0 } }])])).rows[0];
    const order = (await db.query(
        `INSERT INTO orders(order_number,user_id,status,payment_status,payment_method,subtotal,total,snapshot)
         VALUES('DH-LEGACY-FIXTURE',$1,'recebido','pending','debito',10,10,$2) RETURNING id`,
        [profile.id, JSON.stringify({ historical: true })])).rows[0];
    const item = (await db.query(
        `INSERT INTO order_items(order_id,product_id,product_name,color_id,size,quantity,unit_price,subtotal)
         VALUES($1,$2,'Legacy fixture','bege','G',1,10,10) RETURNING id`, [order.id, product.id])).rows[0];
    const movement = (await db.query(
        `INSERT INTO stock_movements(product_id,type,quantity,color_id,size,previous_stock,new_stock)
         VALUES($1,'sale',-1,'bege','G',1,0) RETURNING id`, [product.id])).rows[0];
    const historical = async () => (await db.query(
        `SELECT o.id AS order_id,o.snapshot,o.status,o.payment_status,i.id AS item_id,
                p.colors,p.sold_count,m.id AS movement_id,m.order_id AS movement_order_id,
                m.type,m.quantity,m.previous_stock,m.new_stock
         FROM orders o JOIN order_items i ON i.order_id=o.id
         JOIN products p ON p.id=i.product_id
         JOIN stock_movements m ON m.id=$2 WHERE o.id=$1`, [order.id, movement.id])).rows[0];
    const before = await historical();
    assert.equal(before.item_id, item.id);
    assert.equal(before.movement_order_id, null);
    assert.equal((await db.query("SELECT to_regclass('public.stock_reservations') AS relation")).rows[0].relation, null);

    await migration(18);
    assert.deepEqual(await historical(), before);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM stock_reservations')).rows[0].n, 0);
    const relation = (await db.query(
        "SELECT relrowsecurity FROM pg_class WHERE oid='public.stock_reservations'::regclass")).rows[0];
    assert.equal(relation.relrowsecurity, true);
    for (const role of ['anon', 'authenticated', 'service_role']) {
        if ((await db.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rows.length) {
            assert.equal((await db.query("SELECT has_table_privilege($1,'public.stock_reservations','SELECT') AS allowed", [role])).rows[0].allowed, false);
        }
    }
    await migration(18); // Repeatable CREATE IF NOT EXISTS and REVOKE.
    assert.deepEqual(await historical(), before);

    // Representative reads used by the currently deployed backend stay valid.
    assert.equal((await db.query('SELECT * FROM orders WHERE id=$1', [order.id])).rows.length, 1);
    assert.equal((await db.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [product.id])).rows.length, 1);
    assert.equal((await db.query('SELECT * FROM stock_movements WHERE product_id=$1', [product.id])).rows.length, 1);
    console.log('PASS: migration 018 on populated 017 preserves legacy order, item, stock and unlinked sale');
    console.log('PASS: repeat application, RLS and representative old-backend queries');
} finally {
    await db.end();
}
