import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAuthorizedNfe, parseManualNfe, reconcileNfe, validNfeKey } from '../src/lib/fiscalXml.js';
import { fiscalXmlImportEnabled, requireFiscalXmlImport, validateFiscalVerification } from '../src/routes/fiscalDocuments.js';

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
    [{ product_sku: 'SKU1', product_name: 'Shorts Angel Marfim P', quantity: 1, subtotal: 30 }], '61738801000143').includes('Frete'));
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
    assert.deepEqual(reconcileNfe(parseAuthorizedNfe(Buffer.from(xml({ freight: '0.00', products: '39.98' }))), order, items, '61738801000143'), ['Valor dos produtos', 'Subtotal das mercadorias', 'Frete']);
    assert.ok(reconcileNfe(parsed, order, items, '00.000.000/0000-00').includes('CNPJ emitente'));
    assert.ok(reconcileNfe(parsed, { ...order, snapshot: { customer: { cpf: '00000000000', name: 'Outra pessoa' } } }, items,
        '61738801000143').includes('Documento do destinatário'));
    assert.ok(reconcileNfe(parsed, order, [{ ...items[0], quantity: 2 }], '61738801000143').includes('Quantidade dos produtos'));
    assert.ok(reconcileNfe(parsed, order, [{ ...items[0], product_sku: 'OUTRO', product_name: 'Outra peça' }],
        '61738801000143').includes('Identificação dos produtos'));
});

test('rejects unsafe, malformed, inconsistent or non-authorized XML', () => {
    for (const input of [xml({ model: '65' }), xml({ status: '110' }), xml({ keyValue: key.slice(0, 43) + (key[43] === '0' ? '1' : '0') }),
        '<!DOCTYPE a [<!ENTITY x "unsafe">]>' + xml(), '<nfeProc><NFe></nfeProc>']) {
        assert.throws(() => parseAuthorizedNfe(Buffer.from(input)));
    }
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
