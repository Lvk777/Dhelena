import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
import { createFiscalUnlink } from '../src/services/fiscalUnlink.js';
import { confirmFiscalEquivalence } from '../src/routes/fiscalDocuments.js';

if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required');
const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await client.connect();
try {
    await client.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    END $$`);
    for (const name of ['001_init.sql', '002_profiles_rename.sql', '008_payments_shipping.sql',
        '022_fiscal_documents.sql', '022_fiscal_documents.sql']) {
        await client.query(await fs.readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
    }
    const { rows } = await client.query(`SELECT c.relrowsecurity AS rls,
        EXISTS (SELECT 1 FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner)))
            WHERE grantee=0 AND privilege_type='SELECT') AS public_read,
        (SELECT count(*)::int FROM pg_constraint WHERE conrelid='fiscal_documents'::regclass AND contype='u') AS uniques
        FROM pg_class c WHERE c.oid='fiscal_documents'::regclass`);
    assert.equal(rows[0].rls, true);
    assert.equal(rows[0].public_read, false);
    assert.ok(rows[0].uniques >= 3);
    const { rows: references } = await client.query(`SELECT confrelid::regclass::text AS target FROM pg_constraint
        WHERE conrelid='fiscal_documents'::regclass AND contype='f'`);
    assert.ok(references.some(row => row.target === 'profiles'));
    assert.ok(references.some(row => row.target === 'orders'));
    const { rows: roles } = await client.query(`SELECT rolname,
        has_table_privilege(rolname, 'public.fiscal_documents', 'SELECT') AS can_read,
        has_table_privilege(rolname, 'public.fiscal_documents', 'INSERT') AS can_insert,
        has_table_privilege(rolname, 'public.fiscal_documents', 'UPDATE') AS can_update,
        has_table_privilege(rolname, 'public.fiscal_documents', 'DELETE') AS can_delete
        FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`);
    for (const role of roles) {
        assert.deepEqual([role.can_read, role.can_insert, role.can_update, role.can_delete], [false, false, false, false]);
    }
    assert.equal(roles.length, 2);
    const { rows: profiles } = await client.query(`INSERT INTO profiles(email,password_hash,role)
        VALUES('fiscal-fixture@example.test','synthetic-only','admin') RETURNING id`);
    const { rows: orders } = await client.query(`INSERT INTO orders(order_number,user_id,subtotal,total,snapshot)
        VALUES('FISCAL-FIXTURE',$1,30,39.98,'{}') RETURNING id`, [profiles[0].id]);
    const insert = `INSERT INTO fiscal_documents(order_id,access_key,xml_bytes,xml_sha256,parsed_data,status,imported_by)
        VALUES($1,$2,$3,$4,'{}','pending_official',$5) RETURNING id`;
    const values = [orders[0].id, '1'.repeat(44), Buffer.from('<synthetic/>'), 'a'.repeat(64), profiles[0].id];
    const second = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await second.connect();
    try {
        const attempts = await Promise.allSettled([client.query(insert, values), second.query(insert, values)]);
        assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
        assert.deepEqual(attempts.filter(result => result.status === 'rejected').map(result => result.reason.code), ['23505']);
    } finally { await second.end(); }
    assert.equal((await client.query('SELECT count(*)::int AS count FROM fiscal_documents')).rows[0].count, 1);
    for (const name of ['023_manual_fiscal_documents.sql', '023_manual_fiscal_documents.sql']) {
        await client.query(await fs.readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
    }
    const existing = (await client.query('SELECT origin,xml_bytes,xml_sha256 FROM fiscal_documents WHERE order_id=$1', [orders[0].id])).rows[0];
    assert.equal(existing.origin, 'xml');
    assert.deepEqual(existing.xml_bytes, Buffer.from('<synthetic/>'));
    assert.equal(existing.xml_sha256, 'a'.repeat(64));
    const { rows: manualOrder } = await client.query(`INSERT INTO orders(order_number,user_id,subtotal,total,snapshot)
        VALUES('FISCAL-MANUAL-FIXTURE',$1,30,39.98,'{}') RETURNING id`, [profiles[0].id]);
    await client.query(`INSERT INTO fiscal_documents(order_id,access_key,origin,parsed_data,status,imported_by)
        VALUES($1,$2,'manual','{}','pending_official',$3)`, [manualOrder[0].id, '2'.repeat(44), profiles[0].id]);
    const { rows: invalidOrder } = await client.query(`INSERT INTO orders(order_number,user_id,subtotal,total,snapshot)
        VALUES('FISCAL-INVALID-FIXTURE',$1,30,39.98,'{}') RETURNING id`, [profiles[0].id]);
    await assert.rejects(client.query(`INSERT INTO fiscal_documents(order_id,access_key,origin,parsed_data,status,imported_by)
        VALUES($1,$2,'xml','{}','pending_official',$3)`, [invalidOrder[0].id, '3'.repeat(44), profiles[0].id]), { code: '23514' });
    const manual = (await client.query('SELECT origin,xml_bytes,xml_sha256 FROM fiscal_documents WHERE order_id=$1', [manualOrder[0].id])).rows[0];
    assert.equal(manual.origin, 'manual');
    assert.equal(manual.xml_bytes, null);
    assert.equal(manual.xml_sha256, null);
    assert.equal((await client.query("SELECT relrowsecurity FROM pg_class WHERE oid='fiscal_documents'::regclass")).rows[0].relrowsecurity, true);
    for (const role of ['anon', 'authenticated']) {
        await client.query('BEGIN');
        try {
            await client.query(`SET LOCAL ROLE ${role}`);
            await assert.rejects(client.query('SELECT xml_bytes FROM fiscal_documents'), { code: '42501' });
        } finally { await client.query('ROLLBACK'); }
    }
    for (const name of ['025_pending_fiscal_keys.sql', '025_pending_fiscal_keys.sql']) {
        await client.query(await fs.readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
    }
    const pendingOrder = (await client.query(`INSERT INTO orders(order_number,user_id,subtotal,total,snapshot)
        VALUES('FISCAL-KEY-FIXTURE',$1,30,39.98,'{}') RETURNING id`, [profiles[0].id])).rows[0];
    await client.query('INSERT INTO pending_fiscal_keys(order_id,access_key,entered_by) VALUES($1,$2,$3)',
        [pendingOrder.id, '4'.repeat(44), profiles[0].id]);
    await assert.rejects(client.query('INSERT INTO pending_fiscal_keys(order_id,access_key,entered_by) VALUES($1,$2,$3)',
        [pendingOrder.id, '5'.repeat(44), profiles[0].id]), { code: '23505' });
    assert.equal((await client.query('SELECT count(*)::int AS n FROM fiscal_documents')).rows[0].n, 2);
    assert.equal((await client.query("SELECT relrowsecurity FROM pg_class WHERE oid='pending_fiscal_keys'::regclass")).rows[0].relrowsecurity, true);
    for (const role of ['anon', 'authenticated']) {
        await client.query('BEGIN');
        try {
            await client.query(`SET LOCAL ROLE ${role}`);
            await assert.rejects(client.query('SELECT access_key FROM pending_fiscal_keys'), { code: '42501' });
        } finally { await client.query('ROLLBACK'); }
    }
    for (const name of ['026_fiscal_document_history.sql', '026_fiscal_document_history.sql']) {
        await client.query(await fs.readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
    }
    const firstId = (await client.query('SELECT id FROM fiscal_documents WHERE order_id=$1 AND unlinked_at IS NULL', [orders[0].id])).rows[0].id;
    const unlink = createFiscalUnlink({ db: { connect: async () => ({ query: client.query.bind(client), release() {} }) } });
    const concurrentPool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
    try {
        await client.query('BEGIN');
        await client.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE', [orders[0].id]);
        await assert.rejects(createFiscalUnlink({ db: concurrentPool })(orders[0].id, profiles[0].id, {
            document_id: firstId, reason: 'Documento fiscal vinculado ao pedido incorreto',
            official_source: 'national', prior_official_status: 'authorized',
            confirmed_official_check: true, confirmed_not_cancellation: true,
        }), { status: 409 });
    } finally { await client.query('ROLLBACK'); await concurrentPool.end(); }
    await assert.rejects(unlink(orders[0].id, profiles[0].id, {
        document_id: firstId, reason: 'Documento fiscal vinculado ao pedido incorreto',
        official_source: 'national', prior_official_status: 'authorized',
        confirmed_official_check: false, confirmed_not_cancellation: true,
    }), { status: 422 });
    assert.equal((await client.query('SELECT unlinked_at FROM fiscal_documents WHERE id=$1', [firstId])).rows[0].unlinked_at, null);
    await unlink(orders[0].id, profiles[0].id, {
        document_id: firstId, reason: 'Documento fiscal vinculado ao pedido incorreto',
        official_source: 'national', prior_official_status: 'authorized',
        confirmed_official_check: true, confirmed_not_cancellation: true,
    });
    const prior = (await client.query('SELECT xml_bytes,access_key,unlinked_at,unlink_reason FROM fiscal_documents WHERE id=$1', [firstId])).rows[0];
    assert.deepEqual(prior.xml_bytes, Buffer.from('<synthetic/>'));
    assert.equal(prior.access_key.trim(), '1'.repeat(44));
    assert.ok(prior.unlinked_at);
    assert.match(prior.unlink_reason, /Documento fiscal/);
    await assert.rejects(unlink(orders[0].id, profiles[0].id, {
        document_id: firstId, reason: 'Tentar desvincular duas vezes', official_source: 'national',
        prior_official_status: 'authorized', confirmed_official_check: true, confirmed_not_cancellation: true,
    }), { status: 409 });
    await client.query(`INSERT INTO fiscal_documents(order_id,access_key,origin,xml_bytes,xml_sha256,parsed_data,status,imported_by)
        VALUES($1,$2,'xml',$3,$4,'{}','pending_official',$5)`,
    [orders[0].id, '6'.repeat(44), Buffer.from('<replacement/>'), 'b'.repeat(64), profiles[0].id]);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM fiscal_documents WHERE order_id=$1 AND unlinked_at IS NULL', [orders[0].id])).rows[0].n, 1);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM fiscal_documents WHERE order_id=$1', [orders[0].id])).rows[0].n, 2);
    await assert.rejects(client.query(`INSERT INTO fiscal_documents(order_id,access_key,origin,xml_bytes,xml_sha256,parsed_data,status,imported_by)
        VALUES($1,$2,'xml',$3,$4,'{}','pending_official',$5)`,
    [invalidOrder[0].id, '1'.repeat(44), Buffer.from('<synthetic/>'), 'a'.repeat(64), profiles[0].id]), { code: '23505' });
    for (const role of ['anon', 'authenticated']) {
        await client.query('BEGIN');
        try {
            await client.query(`SET LOCAL ROLE ${role}`);
            await assert.rejects(client.query('SELECT xml_bytes FROM fiscal_documents'), { code: '42501' });
        } finally { await client.query('ROLLBACK'); }
    }
    await client.query(`INSERT INTO settings(key,value) VALUES('shipping_sender',$1::jsonb)
        ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify({ document: '61738801000143' })]);
    const reviewOrder = (await client.query(`INSERT INTO orders(order_number,user_id,subtotal,shipping_cost,total,snapshot,shipping_status,payment_status)
        VALUES('FISCAL-EQUIVALENCE-FIXTURE',$1,30,9.98,39.98,$2::jsonb,'cart_inflight','approved') RETURNING id`,
    [profiles[0].id, JSON.stringify({ customer: { name: 'Nataly Helena', cpf: '12345678909' } })])).rows[0];
    const reviewItem = (await client.query(`INSERT INTO order_items(order_id,product_name,product_sku,color_name,size,quantity,unit_price,subtotal)
        VALUES($1,'Shorts Angel','2026@','Bege','P',1,30,30) RETURNING id`, [reviewOrder.id])).rows[0];
    const reviewData = { key: '7'.repeat(44), recipientName: 'Nataly Helena de Souza Freitas',
        recipientDocument: '12345678909', issuerCnpj: '61738801000143',
        items: [{ code: '127', name: 'Shorts Angel Marfim P', quantity: 1, productCents: 3000 }],
        productCents: 3000, shippingCents: 998, discountCents: 0, totalCents: 3998,
        insuranceCents: 0, otherCents: 0, taxesCents: 0 };
    const reviewDoc = (await client.query(`INSERT INTO fiscal_documents(order_id,access_key,origin,xml_bytes,xml_sha256,
        parsed_data,differences,status,imported_by) VALUES($1,$2,'xml',$3,$4,$5::jsonb,$6::jsonb,'needs_review',$7) RETURNING id`,
    [reviewOrder.id, reviewData.key, Buffer.from('<synthetic-equivalence/>'), 'c'.repeat(64),
        JSON.stringify(reviewData), JSON.stringify(['Nome do destinatário','Identificação dos produtos']), profiles[0].id])).rows[0];
    const reviewInput = { document_id: reviewDoc.id, order_item_id: reviewItem.id, fiscal_index: 0,
        confirmed_recipient: false, confirmed_product_code: true, confirmed_product_variant: true,
        reason: 'Variante sintética conferida', evidence: 'Ficha sintética da variante comercial' };
    const reviewDb = { connect: async () => ({ query: client.query.bind(client), release() {} }) };
    const reviewResult = await confirmFiscalEquivalence(reviewOrder.id, profiles[0].id, reviewInput, reviewDb);
    assert.equal(reviewResult.status, 'needs_review');
    assert.equal(reviewResult.differences.length, 1);
    assert.match(reviewResult.differences[0], /Nome da cliente/);
    await assert.rejects(confirmFiscalEquivalence(reviewOrder.id, profiles[0].id, reviewInput, reviewDb), { status: 409 });
    const nameResult = await confirmFiscalEquivalence(reviewOrder.id, profiles[0].id, {
        document_id: reviewDoc.id, confirmed_recipient: true,
        confirmed_product_code: false, confirmed_product_variant: false,
        reason: 'Nome abreviado sintético conferido', evidence: 'Documento sintético da cliente conferido',
    }, reviewDb);
    assert.equal(nameResult.status, 'pending_official');
    const reviewed = (await client.query(`SELECT fd.xml_bytes,fd.differences,fd.status,o.payment_status,o.shipping_status
        FROM fiscal_documents fd JOIN orders o ON o.id=fd.order_id WHERE fd.id=$1`, [reviewDoc.id])).rows[0];
    assert.deepEqual(reviewed.xml_bytes, Buffer.from('<synthetic-equivalence/>'));
    assert.deepEqual(reviewed.differences, []);
    assert.equal(reviewed.payment_status, 'approved');
    assert.equal(reviewed.shipping_status, 'cart_inflight');
    const reviewAudits = (await client.query(`SELECT admin_id,changes FROM audit_logs
        WHERE action='fiscal.equivalence_confirmed' AND entity_id=$1 ORDER BY created_at,id`, [reviewOrder.id])).rows;
    assert.equal(reviewAudits.length, 2);
    assert.ok(reviewAudits.every(entry => entry.admin_id === profiles[0].id && entry.changes.shipping_released === false
        && entry.changes.official_status_verified === false));
    assert.deepEqual(reviewAudits.map(entry => entry.changes.fields_compared.includes('product_code')), [true, false]);
    console.log('PASS: fiscal document migration is idempotent, private and references orders/profiles');
} finally { await client.end(); }
