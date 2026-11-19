import test from 'node:test';
import assert from 'node:assert/strict';
import { assessNfe, parseAuthorizedNfe, parseManualNfe, reconcileNfe, validNfeKey } from '../src/lib/fiscalXml.js';
import { confirmFiscalEquivalence, fiscalContextHash, fiscalXmlImportEnabled, parseFiscalXmlUpload, requireFiscalXmlImport, reviewFromAudit, validateFiscalEquivalence, validateFiscalVerification } from '../src/routes/fiscalDocuments.js';

function accessKey() {
    const prefix = '3526116173880100014355026161110001394826583';
    for (let digit = 0; digit <= 9; digit += 1) if (validNfeKey(prefix + digit)) return prefix + digit;
    throw new Error('No check digit');
}
const key = accessKey();
const xml = ({ model = '55', status = '100', keyValue = key, freight = '9.98', products = '30.00', total = '39.98' } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${keyValue}"><ide><cUF>35</cUF><mod>${model}</mod><tpAmb>1</tpAmb><nNF>161110001</nNF><serie>026</serie><tpEmis>3</tpEmis><cNF>94826583</cNF><dhEmi>2026-11-16T12:00:00-03:00</dhEmi></ide><emit><CNPJ>61738801000143</CNPJ><xNome>Dhelenas</xNome></emit><dest><CPF>12345678909</CPF><xNome>Cliente</xNome></dest><det><prod><cProd>SKU1</cProd><xProd>Shorts Angel Marfim P</xProd><qCom>1</qCom><vUnCom>${products}</vUnCom><vProd>${products}</vProd></prod></det><total><ICMSTot><vProd>${products}</vProd><vFrete>${freight}</vFrete><vDesc>0.00</vDesc><vNF>${total}</vNF></ICMSTot></total></infNFe><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo/></Signature></NFe><protNFe><infProt><chNFe>${keyValue}</chNFe><cStat>${status}</cStat><nProt>235260655386875</nProt><dhRecbto>2026-11-16T12:01:00-03:00</dhRecbto></infProt></protNFe></nfeProc>`;

const manual = () => ({ key, number: '161110001', series: '26', issuedAt: '2026-11-16T12:00',
    protocol: '235260655386875', issuerCnpj: '61738801000143', issuerName: 'Dhelenas',
    recipientDocument: '12345678909', recipientName: 'Cliente',
    items: [{ code: 'SKU1', name: 'Shorts Angel Marfim P', quantity: '1', productValue: '30.00' }],
    productValue: '30.00', shippingValue: '9.98', totalValue: '39.98' });

test('manual NF-e data is normalized and reconciled without claiming authorization', () => {
    const data = parseManualNfe(manual());
    assert.equal(data.model, '55');
    assert.equal(data.authorizedAt, null);
    assert.equal(data.productCents, 3000);
    assert.deepEqual(reconcileNfe(data, { subtotal: 30, discount: 0, shipping_cost: 9.98, total: 39.98,
        snapshot: { customer: { cpf: '12345678909', name: 'Cliente' } } },
    [{ product_sku: 'SKU1', product_name: 'Shorts Angel Marfim P', quantity: 1, subtotal: 30 }], '61738801000143'), []);
    const divergent = parseManualNfe({ ...manual(), productValue: '39.98', shippingValue: '0',
        items: [{ ...manual().items[0], productValue: '39.98' }] });
    assert.ok(reconcileNfe(divergent, { subtotal: 30, discount: 0, shipping_cost: 9.98, total: 39.98,
        snapshot: { customer: { cpf: '12345678909', name: 'Cliente' } } },
    [{ product_sku: 'SKU1', product_name: 'Shorts Angel Marfim P', quantity: 1, subtotal: 30 }], '61738801000143').some(message => message.startsWith('Frete:')));
});

test('manual entry rejects inconsistent fiscal identities, totals and items', () => {
    for (const changed of [
        { number: '2' }, { series: '2' }, { issuedAt: '2026-10-16T12:00' },
        { protocol: '123' }, { issuerCnpj: '00000000000000' }, { issuedAt: '2026-11-31T12:00' },
        { items: [] }, { items: [{ ...manual().items[0], quantity: 0 }] },
        { totalValue: '40.00' }, { productValue: '40.00' },
    ]) assert.throws(() => parseManualNfe({ ...manual(), ...changed }));
});

test('accepts the structural authorization fields but does not claim official status', () => {
    const parsed = parseAuthorizedNfe(Buffer.from(xml()));
    assert.equal(parsed.key, key);
    assert.equal(parsed.protocol, '235260655386875');
    assert.equal(parsed.shippingCents, 998);
    const order = { subtotal: 30, discount: 0, shipping_cost: 9.98, total: 39.98,
        snapshot: { customer: { cpf: '123.456.789-09', name: 'Cliente' } } };
    const items = [{ product_sku: 'SKU1', product_name: 'Shorts Angel Marfim P', quantity: 1, subtotal: 30 }];
    assert.deepEqual(reconcileNfe(parsed, order, items, '61.738.801/0001-43'), []);
    assert.deepEqual(reconcileNfe(parsed, order, [{ product_name: 'Shorts Angel', color_name: 'Marfim', size: 'P', quantity: 1, subtotal: 30 }], '61738801000143'), []);
    assert.deepEqual(assessNfe(parseAuthorizedNfe(Buffer.from(xml({ freight: '0.00', products: '39.98' }))), order, items, '61738801000143').issues.map(issue => issue.code), ['item_value', 'subtotal', 'shipping']);
    assert.ok(assessNfe(parsed, order, items, '00.000.000/0000-00').issues.some(issue => issue.code === 'issuer'));
    assert.ok(reconcileNfe(parsed, { ...order, snapshot: { customer: { cpf: '00000000000', name: 'Outra pessoa' } } }, items,
        '61738801000143').some(message => message.startsWith('Documento da cliente:')));
    assert.ok(assessNfe(parsed, order, [{ ...items[0], quantity: 2 }], '61738801000143').issues.some(issue => issue.code === 'quantity'));
    assert.ok(reconcileNfe(parsed, order, [{ ...items[0], product_sku: 'OUTRO', product_name: 'Outra peça' }],
        '61738801000143').some(message => message.startsWith('Produto da nota')));
});

test('abbreviated name is reviewable only with the exact recipient document and matching name prefix', () => {
    const data = parseAuthorizedNfe(Buffer.from(xml()));
    data.recipientName = 'Nataly Helena de Souza Freitas';
    const order = { subtotal: 30, shipping_cost: 9.98, discount: 0, total: 39.98,
        snapshot: { customer: { cpf: '12345678909', name: 'Nataly  Helena' } } };
    const items = [{ id: '11111111-1111-4111-8111-111111111111', product_name: 'Shorts Angel Marfim P',
        product_sku: 'SKU1', quantity: 1, subtotal: 30 }];
    const assessment = assessNfe(data, order, items, '61738801000143');
    assert.equal(assessment.abbreviatedName, true);
    assert.deepEqual(assessment.issues.map(issue => issue.code), ['recipient_name']);
    assert.match(assessment.issues[0].message, /Nataly  Helena/);
    assert.deepEqual(assessNfe(data, order, items, '61738801000143', { recipientConfirmed: true }).issues, []);
    const wrongCpf = structuredClone(order); wrongCpf.snapshot.customer.cpf = '00000000000';
    assert.equal(assessNfe(data, wrongCpf, items, '61738801000143').abbreviatedName, false);
    assert.ok(assessNfe(data, wrongCpf, items, '61738801000143', { recipientConfirmed: true }).issues.some(issue => issue.code === 'recipient_document'));
    const conflicting = structuredClone(order); conflicting.snapshot.customer.name = 'Nataly Maria';
    assert.equal(assessNfe(data, conflicting, items, '61738801000143').abbreviatedName, false);
});

test('formatting only is accepted; distinct SKU and color need a specific administrative review', () => {
    const data = parseAuthorizedNfe(Buffer.from(xml()));
    data.recipientName = 'Nataly Helena de Souza Freitas';
    data.items[0] = { code: '127', name: 'SHORTS Angel  Marfim P', quantity: 1,
        productCents: 3000, unitCents: 3000 };
    const order = { subtotal: 30, shipping_cost: 9.98, discount: 0, total: 39.98,
        snapshot: { customer: { cpf: '12345678909', name: 'Nataly Helena' } } };
    const row = { id: '11111111-1111-4111-8111-111111111111', product_name: 'Shorts Angel',
        product_sku: '2026@', color_name: 'Bege', size: 'P', quantity: 1, subtotal: 30 };
    const assessment = assessNfe(data, order, [row], '61738801000143');
    assert.deepEqual(assessment.issues.map(issue => issue.code), ['recipient_name', 'product_identity']);
    assert.equal(assessment.productCandidate.fiscalColor, 'marfim');
    assert.match(assessment.issues[1].message, /Bege.*2026@.*Marfim.*127/i);
    assert.deepEqual(assessNfe(data, order, [row], '61738801000143', {
        recipientConfirmed: true, productConfirmed: true,
        orderItemId: row.id, fiscalIndex: 0 }).issues, []);
    assert.ok(assessNfe(data, order, [row], '61738801000143', {
        recipientConfirmed: true, productConfirmed: true,
        orderItemId: '22222222-2222-4222-8222-222222222222', fiscalIndex: 0 }).issues.length);
    const formatted = { ...data, recipientName: 'Nataly Helena',
        items: [{ ...data.items[0], code: '2026@', name: 'SHORTS  ÁNGEL Bege  P' }] };
    assert.deepEqual(assessNfe(formatted, order, [row], '61738801000143').issues, []);
    const wrongSize = { ...data, items: [{ ...data.items[0], name: 'Shorts Angel Marfim M' }] };
    assert.equal(assessNfe(wrongSize, order, [row], '61738801000143').productCandidate, null);
    const wrongQuantity = { ...data, items: [{ ...data.items[0], quantity: 2 }] };
    assert.equal(assessNfe(wrongQuantity, order, [row], '61738801000143').productCandidate, null);
    const differentDescription = { ...data, items: [{ ...data.items[0], name: 'Bermuda Clara P' }] };
    const described = assessNfe(differentDescription, order, [row], '61738801000143');
    assert.equal(described.productCandidate.sameBase, false);
    assert.ok(described.issues.some(issue => issue.code === 'product_identity'));
    const wrongValue = { ...data, items: [{ ...data.items[0], productCents: 2500 }] };
    assert.equal(assessNfe(wrongValue, order, [row], '61738801000143').productCandidate, null);
});

test('equivalence submission requires separate confirmations, reason, evidence and exact identifiers', () => {
    const valid = { document_id: '11111111-1111-4111-8111-111111111111',
        order_item_id: '22222222-2222-4222-8222-222222222222', fiscal_index: 0,
        confirmed_recipient: false, confirmed_product_code: true, confirmed_product_variant: true,
        reason: 'Variante sintética conferida no cadastro', evidence: 'Cadastro original da peça e variante' };
    assert.equal(validateFiscalEquivalence(valid).productConfirmed, true);
    assert.equal(validateFiscalEquivalence({ ...valid, confirmed_recipient: true,
        confirmed_product_code: false, confirmed_product_variant: false }).recipientConfirmed, true);
    for (const changed of [{ confirmed_product_code: false }, { confirmed_recipient: true },
        { confirmed_product_variant: false }, { reason: 'curto' }, { evidence: '' },
        { document_id: 'outro' }, { fiscal_index: -1 }]) {
        assert.throws(() => validateFiscalEquivalence({ ...valid, ...changed }));
    }
});

test('audit replay combines only current, specific product and name decisions', () => {
    const context = 'b'.repeat(64), xmlHash = 'a'.repeat(64);
    const product = { changes: { xml_sha256: xmlHash, comparison_sha256: context,
        fields_compared: ['product_code','product_color'], order_item_id: 'item-1', fiscal_index: 0,
        reason: 'Produto conferido', evidence: 'Ficha de cadastro' }, created_at: '2026-11-19T12:00:00Z' };
    const name = { changes: { xml_sha256: xmlHash, comparison_sha256: context,
        fields_compared: ['recipient_name'], reason: 'Nome conferido', evidence: 'Documento consultado' },
    created_at: '2026-11-19T12:01:00Z' };
    const partial = reviewFromAudit([product], xmlHash, context);
    assert.equal(partial.review.productConfirmed, true);
    assert.equal(partial.review.recipientConfirmed, false);
    assert.equal(partial.records.length, 1);
    const complete = reviewFromAudit([product, name], xmlHash, context);
    assert.equal(complete.review.productConfirmed, true);
    assert.equal(complete.review.recipientConfirmed, true);
    assert.equal(complete.records.length, 2);
    assert.equal(reviewFromAudit([product], xmlHash, 'changed').stale, true);
});

test('a reviewed comparison is bound to the exact customer, item, variant and amounts', () => {
    const order = { snapshot: { customer: { name: 'Nataly Helena', cpf: '12345678909' } },
        subtotal: '30.00', shipping_cost: '9.98', discount: '0.00', total: '39.98' };
    const item = { id: '11111111-1111-4111-8111-111111111111', product_name: 'Shorts Angel',
        product_sku: '2026@', color_name: 'Bege', size: 'P', quantity: 1, subtotal: '30.00' };
    const original = fiscalContextHash(order, [item], '61738801000143');
    assert.equal(fiscalContextHash(order, [item], '61738801000143'), original);
    assert.notEqual(fiscalContextHash(order, [{ ...item, color_name: 'Marfim' }], '61738801000143'), original);
    assert.notEqual(fiscalContextHash({ ...order, total: '40.00' }, [item], '61738801000143'), original);
    assert.notEqual(fiscalContextHash({ ...order, snapshot: { customer: { ...order.snapshot.customer, cpf: '00000000000' } } }, [item], '61738801000143'), original);
});

test('equivalence is atomic, audited and leaves XML, payment, stock and shipping untouched', async () => {
    const data = parseAuthorizedNfe(Buffer.from(xml()));
    data.recipientName = 'Nataly Helena de Souza Freitas';
    data.items[0] = { code: '127', name: 'Shorts Angel Marfim P', quantity: 1, productCents: 3000, unitCents: 3000 };
    const order = { id: '33333333-3333-4333-8333-333333333333', subtotal: '30.00', shipping_cost: '9.98',
        discount: '0.00', total: '39.98', payment_status: 'approved', shipping_status: 'cart_inflight',
        snapshot: { customer: { cpf: '12345678909', name: 'Nataly Helena' } } };
    const item = { id: '22222222-2222-4222-8222-222222222222', product_id: '44444444-4444-4444-8444-444444444444',
        product_name: 'Shorts Angel', product_sku: '2026@', color_name: 'Bege', size: 'P', quantity: 1, subtotal: '30.00' };
    const document = { id: '11111111-1111-4111-8111-111111111111', access_key: key, origin: 'xml',
        xml_sha256: 'a'.repeat(64), xml_bytes: Buffer.from('<original/>'), parsed_data: data,
        status: 'needs_review', differences: ['old'] };
    const input = { document_id: document.id, order_item_id: item.id, fiscal_index: 0,
        confirmed_recipient: false, confirmed_product_code: true, confirmed_product_variant: true,
        reason: 'Cadastro da cor comercial foi conferido', evidence: 'Ficha da variante e documento de identificação' };
    const calls = [], audits = [];
    const db = { async connect() { return { release() {}, async query(sql, params) {
        calls.push({ sql, params });
        if (sql.includes('FROM orders')) return { rows: [order] };
        if (sql.includes('FROM fiscal_documents')) return { rows: [document] };
        if (sql.includes('FROM order_items')) return { rows: [item] };
        if (sql.includes('FROM settings')) return { rows: [{ value: { document: '61738801000143' } }] };
        if (sql.includes('FROM audit_logs')) return { rows: audits };
        if (sql.startsWith('UPDATE fiscal_documents')) {
            document.differences = JSON.parse(params[1]); document.status = params[2];
            return { rowCount: 1, rows: [document] };
        }
        if (sql.includes("'fiscal.equivalence_confirmed'")) audits.push({ changes: JSON.parse(params[2]), created_at: new Date().toISOString() });
        return { rows: [] };
    } }; } };
    const result = await confirmFiscalEquivalence(order.id, '55555555-5555-4555-8555-555555555555', input, db);
    assert.equal(result.status, 'needs_review');
    assert.deepEqual(result.analysis.issues.map(issue => issue.code), ['recipient_name']);
    assert.equal(result.differences.length, 1);
    assert.equal(calls.at(-1).sql, 'COMMIT');
    const audit = calls.find(call => call.sql.startsWith('INSERT INTO audit_logs'));
    assert.ok(audit);
    assert.equal(JSON.parse(audit.params[2]).official_status_verified, false);
    assert.equal(JSON.parse(audit.params[2]).shipping_released, false);
    assert.equal(document.xml_bytes.toString(), '<original/>');
    assert.equal(order.payment_status, 'approved');
    assert.equal(order.shipping_status, 'cart_inflight');
    assert.equal(calls.some(call => /UPDATE orders|UPDATE products|INSERT INTO stock|shipping_operations/i.test(call.sql)), false);
    await assert.rejects(confirmFiscalEquivalence(order.id, '55555555-5555-4555-8555-555555555555',
        input, db), { status: 409 });
    assert.equal(calls.at(-1).sql, 'ROLLBACK');
    const nameResult = await confirmFiscalEquivalence(order.id, '55555555-5555-4555-8555-555555555555',
        { ...input, order_item_id: undefined, fiscal_index: undefined,
            confirmed_recipient: true, confirmed_product_code: false, confirmed_product_variant: false,
            reason: 'Nome abreviado conferido com documento', evidence: 'Documento sintético de identificação' }, db);
    assert.equal(nameResult.status, 'pending_official');
    assert.deepEqual(nameResult.differences, []);
    assert.equal(audits.length, 2);
    document.status = 'needs_review'; audits.length = 0;
    data.items[0].quantity = 2;
    await assert.rejects(confirmFiscalEquivalence(order.id, '55555555-5555-4555-8555-555555555555', input, db), { status: 409 });
    data.items[0].quantity = 1; data.items[0].productCents = 2500;
    await assert.rejects(confirmFiscalEquivalence(order.id, '55555555-5555-4555-8555-555555555555', input, db), { status: 409 });
    assert.equal(audits.length, 0);
    const busyDb = { async connect() { return { release() {}, async query(sql) {
        if (sql.includes('FROM orders')) throw Object.assign(new Error('busy'), { code: '55P03' });
        return {};
    } }; } };
    await assert.rejects(confirmFiscalEquivalence(order.id, '55555555-5555-4555-8555-555555555555', input, busyDb),
        error => error.status === 409 && /Outra operação/.test(error.message));
});

test('rejects unsafe, malformed, inconsistent or non-authorized XML', () => {
    for (const input of [xml({ model: '65' }), xml({ status: '110' }), xml({ keyValue: key.slice(0, 43) + (key[43] === '0' ? '1' : '0') }),
        '<!DOCTYPE a [<!ENTITY x "unsafe">]>' + xml(), '<nfeProc><NFe></nfeProc>']) {
        assert.throws(() => parseAuthorizedNfe(Buffer.from(input)));
    }
});

test('PDF-converted XML is rejected with 422 rather than internal server error', () => {
    const convertedPdfXml = '<?xml version="1.0"?><document><page><text>DANFE</text></page></document>';
    assert.throws(() => parseFiscalXmlUpload(Buffer.from(convertedPdfXml)), error =>
        error.status === 422 && /XML fiscal autorizado/.test(error.message)
            && /PDF/.test(error.message));
    assert.throws(() => parseFiscalXmlUpload(Buffer.from('<nfeProc><NFe></nfeProc>')), error =>
        error.status === 422 && /Estrutura XML inválida/.test(error.message));
    assert.equal(parseFiscalXmlUpload(Buffer.from(xml())).key, key);
});

test('fiscal routes fail closed before a missing production table can be queried', () => {
    assert.equal(fiscalXmlImportEnabled({}), false);
    assert.equal(fiscalXmlImportEnabled({ FISCAL_XML_IMPORT_ENABLED: 'false' }), false);
    let status, body, nextCalled = false;
    const res = { status(code) { status = code; return this; }, json(value) { body = value; return this; } };
    requireFiscalXmlImport({}, res, () => { nextCalled = true; }, {});
    assert.equal(status, 503);
    assert.match(body.error, /indisponível/);
    assert.equal(nextCalled, false);
    requireFiscalXmlImport({}, res, () => { nextCalled = true; }, { FISCAL_XML_IMPORT_ENABLED: 'true' });
    assert.equal(nextCalled, true);
});

test('official verification requires separate authorization and full-content attestations', () => {
    const input = { access_key: key, protocol: '235260655386875', source: 'national',
        confirmed_authorized: true, confirmed_document_matches: true };
    assert.deepEqual(validateFiscalVerification(input), { key, protocol: input.protocol, source: input.source });
    assert.throws(() => validateFiscalVerification({ ...input, confirmed_authorized: false }), /correspondência/);
    assert.throws(() => validateFiscalVerification({ ...input, confirmed_document_matches: false }), /correspondência/);
    assert.throws(() => validateFiscalVerification({ ...input, source: 'untrusted' }), /portal oficial/);
});
