import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
import { databaseConnectionOptions } from '../../src/config/databaseSsl.js';

if (!process.env.DATABASE_URL || process.env.NODE_ENV !== 'production') throw new Error('Production context required');
const apply = process.argv.includes('--apply');
const db = new pg.Client(databaseConnectionOptions(process.env.DATABASE_URL, { production: true }));
await db.connect();
try {
    await db.query(apply ? 'BEGIN' : 'BEGIN TRANSACTION READ ONLY');
    await db.query("SET LOCAL lock_timeout='2000ms'");
    await db.query("SET LOCAL statement_timeout='10000ms'");
    const before = (await db.query(`SELECT id,order_id,access_key,xml_sha256,octet_length(xml_bytes) AS xml_size,
        status,official_checked_at,imported_by,verified_by FROM fiscal_documents ORDER BY id`)).rows;
    const ordersBefore = (await db.query(`SELECT order_number,payment_status,shipping_status,total,melhor_envio_shipment_id
        FROM orders WHERE order_number IN ('DH-2026-000018','DH-2026-000019') ORDER BY order_number`)).rows;
    const security = (await db.query(`SELECT relrowsecurity FROM pg_class WHERE oid='fiscal_documents'::regclass`)).rows[0];
    const maintenance = (await db.query("SELECT value FROM settings WHERE key='maintenance'")).rows[0]?.value?.maintenance_mode;
    assert.equal(security.relrowsecurity, true);
    assert.equal(maintenance, true);
    assert.notEqual(process.env.SHIPPING_LABEL_PURCHASE_ENABLED, 'true');
    assert.equal(ordersBefore.length, 2);
    assert.equal(ordersBefore[1].shipping_status, 'cart_inflight');
    if (apply) {
        const sql = await fs.readFile(new URL('../../migrations/026_fiscal_document_history.sql', import.meta.url), 'utf8');
        await db.query(sql);
    }
    if (apply) {
        const after = (await db.query(`SELECT id,order_id,access_key,xml_sha256,octet_length(xml_bytes) AS xml_size,
            status,official_checked_at,imported_by,verified_by FROM fiscal_documents ORDER BY id`)).rows;
        const ordersAfter = (await db.query(`SELECT order_number,payment_status,shipping_status,total,melhor_envio_shipment_id
            FROM orders WHERE order_number IN ('DH-2026-000018','DH-2026-000019') ORDER BY order_number`)).rows;
        assert.deepEqual(after, before);
        assert.deepEqual(ordersAfter, ordersBefore);
        const index = (await db.query(`SELECT indisunique,indpred IS NOT NULL AS partial FROM pg_index
            WHERE indexrelid='fiscal_documents_one_active_order_idx'::regclass`)).rows[0];
        assert.deepEqual(index, { indisunique: true, partial: true });
        const roles = (await db.query(`SELECT rolname,has_table_privilege(rolname,'public.fiscal_documents','SELECT') AS can_read
            FROM pg_roles WHERE rolname IN ('anon','authenticated')`)).rows;
        assert.ok(roles.every(role => !role.can_read));
    }
    await db.query('COMMIT');
    console.log(JSON.stringify({ applied: apply, documents_preserved: before.length,
        order18_19_preserved: true, maintenance_on: true, label_purchase_off: true }));
} catch (error) { await db.query('ROLLBACK').catch(() => {}); throw error; }
finally { await db.end(); }
