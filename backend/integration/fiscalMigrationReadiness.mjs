import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { createFiscalUnlink } from '../src/services/fiscalUnlink.js';
import { confirmFiscalEquivalence, storeDocument, verifyFiscalDocument } from '../src/routes/fiscalDocuments.js';
import { parseAuthorizedNfe, validNfeKey } from '../src/lib/fiscalXml.js';

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
        confirmed_recipient: false, confirmed_product_match: true };
    const reviewDb = { connect: async () => ({ query: client.query.bind(client), release() {} }) };
    const reviewResult = await confirmFiscalEquivalence(reviewOrder.id, profiles[0].id, reviewInput, reviewDb);
    assert.equal(reviewResult.status, 'pending_official');
    assert.equal(reviewResult.differences.length, 0);
    await assert.rejects(confirmFiscalEquivalence(reviewOrder.id, profiles[0].id, reviewInput, reviewDb), { status: 409 });
    const reviewed = (await client.query(`SELECT fd.xml_bytes,fd.differences,fd.status,o.payment_status,o.shipping_status
        FROM fiscal_documents fd JOIN orders o ON o.id=fd.order_id WHERE fd.id=$1`, [reviewDoc.id])).rows[0];
    assert.deepEqual(reviewed.xml_bytes, Buffer.from('<synthetic-equivalence/>'));
    assert.deepEqual(reviewed.differences, []);
    assert.equal(reviewed.payment_status, 'approved');
    assert.equal(reviewed.shipping_status, 'cart_inflight');
    const reviewAudits = (await client.query(`SELECT admin_id,changes FROM audit_logs
        WHERE action='fiscal.equivalence_confirmed' AND entity_id=$1 ORDER BY created_at,id`, [reviewOrder.id])).rows;
    assert.equal(reviewAudits.length, 1);
    assert.ok(reviewAudits.every(entry => entry.admin_id === profiles[0].id && entry.changes.shipping_released === false
        && entry.changes.official_status_verified === false));
    assert.deepEqual(reviewAudits.map(entry => entry.changes.fields_compared.includes('product_code')), [true]);
    const syntheticKey = number => {
        const prefix = `3526116173880100014355026${String(number).padStart(9, '0')}394826583`;
        for (let digit = 0; digit <= 9; digit += 1) if (validNfeKey(prefix + digit)) return prefix + digit;
        throw new Error('synthetic key');
    };
    const syntheticXml = number => {
        const accessKey = syntheticKey(number);
        return Buffer.from(`<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${accessKey}">
          <ide><cUF>35</cUF><mod>55</mod><tpAmb>1</tpAmb><nNF>${number}</nNF><serie>26</serie>
          <tpEmis>3</tpEmis><cNF>94826583</cNF><dhEmi>2026-11-16T12:00:00-03:00</dhEmi></ide>
          <emit><CNPJ>61738801000143</CNPJ><xNome>Emitente Sintético</xNome></emit>
          <dest><CPF>12345678909</CPF><xNome>Nataly Helena de Souza Freitas</xNome></dest>
          <det><prod><cProd>127</cProd><xProd>Shorts Angel Marfim P</xProd><qCom>1</qCom>
          <vUnCom>30.00</vUnCom><vProd>30.00</vProd></prod></det>
          <total><ICMSTot><vProd>30.00</vProd><vFrete>9.98</vFrete><vDesc>0.00</vDesc>
          <vNF>39.98</vNF></ICMSTot></total></infNFe><Signature><SignedInfo/></Signature></NFe>
          <protNFe><infProt><chNFe>${accessKey}</chNFe><cStat>100</cStat>
          <nProt>235260655386875</nProt><dhRecbto>2026-11-16T12:01:00-03:00</dhRecbto>
          </infProt></protNFe></nfeProc>`);
    };
    const product = (await client.query(`INSERT INTO products(name,sku,price)
        VALUES('Shorts Angel Sintético','2026@',30) RETURNING id`)).rows[0];
    const makeOrder = async (number, colorId = 'bege-id') => {
        const row = (await client.query(`INSERT INTO orders(order_number,user_id,subtotal,shipping_cost,total,
            snapshot,shipping_status,payment_status) VALUES($1,$2,30,9.98,39.98,$3::jsonb,
            'cart_inflight','approved') RETURNING id`, [number, profiles[0].id,
        JSON.stringify({ customer: { name: 'Nataly Helena', cpf: '12345678909' } })])).rows[0];
        const item = (await client.query(`INSERT INTO order_items(order_id,product_id,product_name,product_sku,
            color_id,color_name,size,quantity,unit_price,subtotal)
            VALUES($1,$2,'Shorts Angel','2026@',$3,'Bege','P',1,30,30) RETURNING id`,
        [row.id, product.id, colorId])).rows[0];
        return { order: row, item };
    };
    const importXml = async (orderId, number, replacementReview = null) => {
        const bytes = syntheticXml(number);
        const data = parseAuthorizedNfe(bytes);
        return { bytes, document: await storeDocument({ params: { id: orderId },
            user: { id: profiles[0].id } }, data, 'xml', bytes,
        createHash('sha256').update(bytes).digest('hex'), reviewDb, replacementReview) };
    };
    const first = await makeOrder('FISCAL-END-TO-END-1');
    const imported = await importXml(first.order.id, 161110001);
    assert.equal(imported.document.status, 'needs_review');
    assert.equal(imported.document.differences.length, 1);
    const earlier = await makeOrder('FISCAL-END-TO-END-EARLIER');
    const earlierImport = await importXml(earlier.order.id, 161110005);
    assert.equal(earlierImport.document.status, 'needs_review');
    await assert.rejects(importXml(first.order.id, 161110001), { status: 409 });
    const mapped = await confirmFiscalEquivalence(first.order.id, profiles[0].id, {
        document_id: imported.document.id, order_item_id: first.item.id, fiscal_index: 0,
        confirmed_recipient: false, confirmed_product_match: true, save_for_future: true,
    }, reviewDb);
    assert.equal(mapped.status, 'pending_official');
    assert.equal((await client.query("SELECT count(*)::int AS n FROM audit_logs WHERE action='fiscal.product_mapping_saved'")).rows[0].n, 1);
    const reloaded = (await client.query('SELECT status,xml_bytes,xml_sha256 FROM fiscal_documents WHERE id=$1',
        [imported.document.id])).rows[0];
    assert.equal(reloaded.status, 'pending_official');
    assert.deepEqual(reloaded.xml_bytes, imported.bytes);
    assert.equal(reloaded.xml_sha256, createHash('sha256').update(imported.bytes).digest('hex'));
    const attestation = { access_key: earlierImport.document.access_key,
        protocol: earlierImport.document.data.protocol, source: 'national',
        confirmed_authorized: true, confirmed_document_matches: true };
    const verifiedEarlier = await verifyFiscalDocument(earlier.order.id, profiles[0].id, attestation, reviewDb);
    assert.equal(verifiedEarlier.status, 'verified');
    assert.deepEqual(verifiedEarlier.differences, []);
    assert.deepEqual((await client.query('SELECT differences FROM fiscal_documents WHERE id=$1',
        [earlierImport.document.id])).rows[0].differences, []);
    const secondOrder = await makeOrder('FISCAL-END-TO-END-2');
    const secondImport = await importXml(secondOrder.order.id, 161110002);
    assert.equal(secondImport.document.status, 'pending_official');
    assert.deepEqual(secondImport.document.differences, []);
    const otherColor = await makeOrder('FISCAL-END-TO-END-WRONG-COLOR', 'outro-id');
    const rejected = await importXml(otherColor.order.id, 161110003);
    assert.equal(rejected.document.status, 'needs_review');
    assert.ok(rejected.document.differences.length > 0);
    await assert.rejects(confirmFiscalEquivalence(otherColor.order.id, profiles[0].id, {
        document_id: rejected.document.id, order_item_id: otherColor.item.id, fiscal_index: 0,
        confirmed_recipient: false, confirmed_product_match: true, save_for_future: true,
    }, reviewDb), { status: 409 });
    assert.equal((await client.query('SELECT status FROM fiscal_documents WHERE id=$1',
        [rejected.document.id])).rows[0].status, 'needs_review');
    await assert.rejects(verifyFiscalDocument(otherColor.order.id, profiles[0].id, {
        ...attestation, access_key: rejected.document.access_key }, reviewDb), { status: 409 });
    await unlink(first.order.id, profiles[0].id, {
        document_id: imported.document.id, reason: 'Substituição sintética para testar histórico fiscal',
        official_source: 'national', prior_official_status: 'authorized',
        confirmed_official_check: true, confirmed_not_cancellation: true,
    });
    const reactivated = await importXml(first.order.id, 161110001);
    assert.equal(reactivated.document.id, imported.document.id);
    assert.equal(reactivated.document.status, 'pending_official');
    assert.deepEqual((await client.query('SELECT xml_bytes FROM fiscal_documents WHERE id=$1',
        [imported.document.id])).rows[0].xml_bytes, imported.bytes);
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action='fiscal.xml_reactivated'
        AND entity_id=$1`, [first.order.id])).rows[0].n, 1);
    await assert.rejects(importXml(first.order.id, 161110001), { status: 409 });
    await unlink(first.order.id, profiles[0].id, {
        document_id: imported.document.id, reason: 'Nova substituição sintética após reativação',
        official_source: 'national', prior_official_status: 'authorized',
        confirmed_official_check: true, confirmed_not_cancellation: true,
    });
    const replacement = await importXml(first.order.id, 161110004);
    assert.equal(replacement.document.status, 'pending_official');
    const replacementReview = { document_id: replacement.document.id, official_source: 'national',
        prior_official_status: 'authorized', confirmed_official_check: true,
        confirmed_not_cancellation: true };
    await assert.rejects(importXml(first.order.id, 161110005, replacementReview), { status: 409 });
    assert.equal((await client.query('SELECT unlinked_at FROM fiscal_documents WHERE id=$1',
        [replacement.document.id])).rows[0].unlinked_at, null);
    const transactional = await importXml(first.order.id, 161110006, replacementReview);
    assert.equal(transactional.document.status, 'pending_official');
    const history = (await client.query(`SELECT id,xml_bytes,unlinked_at FROM fiscal_documents
        WHERE order_id=$1 ORDER BY created_at,id`, [first.order.id])).rows;
    assert.equal(history.length, 3);
    assert.equal(history.filter(row => row.unlinked_at === null).length, 1);
    assert.deepEqual(history.find(row => row.id === imported.document.id).xml_bytes, imported.bytes);
    assert.deepEqual(history.find(row => row.id === replacement.document.id).xml_bytes, replacement.bytes);
    assert.deepEqual(history.find(row => row.id === transactional.document.id).xml_bytes, transactional.bytes);
    assert.equal((await client.query('SELECT shipping_status FROM orders WHERE id=$1',
        [first.order.id])).rows[0].shipping_status, 'cart_inflight');
    console.log('PASS: fiscal document migration is idempotent, private and references orders/profiles');
} finally { await client.end(); }
