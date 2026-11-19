import pg from 'pg';

if (process.env.NODE_ENV !== 'production' || !process.env.DATABASE_URL) throw new Error('Production context required');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
try {
    await db.query('BEGIN TRANSACTION READ ONLY');
    const { rows } = await db.query(`SELECT p.id,p.name,p.sku,p.status,p.sold_count,p.colors,p.images,
        (SELECT count(*)::int FROM order_items i WHERE i.product_id=p.id OR (p.sku IS NOT NULL AND i.product_sku=p.sku)) AS order_items,
        (SELECT count(*)::int FROM stock_reservations r WHERE r.product_id=p.id) AS reservations,
        (SELECT count(*)::int FROM stock_movements m WHERE m.product_id=p.id) AS movements,
        (SELECT count(*)::int FROM analytics_events a WHERE a.product_id=p.id) AS analytics
        FROM products p ORDER BY p.name,p.id`);
    const inventory = rows.map(p => ({ id:p.id,name:p.name,status:p.status,sku:p.sku,
        sold_count:p.sold_count,stock:(p.colors||[]).reduce((sum,color)=>sum+Object.values(color.stock||{}).reduce((n,x)=>n+Number(x||0),0),0),
        order_items:p.order_items,reservations:p.reservations,movements:p.movements,analytics:p.analytics,
        images:p.images?.length||0 }));
    const categories = (await db.query('SELECT id,name,slug,status FROM categories ORDER BY name')).rows;
    const collections = (await db.query('SELECT id,name,status FROM collections ORDER BY name')).rows;
    const orders = (await db.query("SELECT order_number,payment_status,shipping_status FROM orders WHERE order_number IN ('DH-2026-000018','DH-2026-000019') ORDER BY order_number")).rows;
    const maintenance = (await db.query("SELECT value->>'maintenance_mode' AS enabled FROM settings WHERE key='maintenance'")).rows[0]?.enabled;
    await db.query('COMMIT');
    console.log(JSON.stringify({ products:inventory, categories, collections, orders, maintenance }));
} catch (error) { await db.query('ROLLBACK').catch(()=>{}); throw error; }
finally { await db.end(); }
