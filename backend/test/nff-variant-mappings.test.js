import test from 'node:test';
import assert from 'node:assert/strict';
import { saveNffVariantMapping } from '../src/routes/fiscalDocuments.js';
import { resolveReusableMappings } from '../src/lib/fiscalProductMappings.js';

const productId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const input = { color_id: 'bege', size: 'P', code: '127', description: 'Shorts Angel Marfim P', confirmed_match: true };
const item = { id: '33333333-3333-4333-8333-333333333333', product_id: productId,
    color_id: 'bege', color_name: 'Bege', product_name: 'Shorts Angel', size: 'P', quantity: 1, subtotal: '30.00' };
function fixture() {
    const calls = [], mappings = [];
    const db = { async connect() { return { release() {}, async query(sql, params) {
        calls.push(sql);
        if (sql.includes('FROM products')) return { rows: [{ id: productId, name: 'Shorts Angel',
            colors: [{ id: 'bege', name: 'Bege' }], sizes: ['P'] }] };
        if (sql.includes('FROM settings')) return { rows: [{ value: { document: '61738801000143' } }] };
        if (sql.includes("action='fiscal.product_mapping_saved'")) return { rows: mappings };
        if (sql.includes("VALUES($1,'fiscal.product_mapping_saved'")) mappings.push({ id: `mapping-${mappings.length}`,
            changes: JSON.parse(params[2]) });
        return { rows: [] };
    } }; } };
    return { db, calls, mappings };
}

test('administrator attests a catalog variant once and a second synthetic note reuses only the exact match', async () => {
    const { db, calls, mappings } = fixture();
    const saved = await saveNffVariantMapping(productId, actorId, input, db);
    assert.equal(saved.saved, true);
    assert.equal(mappings.length, 1);
    assert.equal(mappings[0].changes.confirmation, 'admin_checked_nff_catalog_and_variant');
    const nfe = { issuerCnpj: '61738801000143', items: [{ code: '127', name: input.description,
        quantity: 1, productCents: 3000 }] };
    assert.deepEqual(resolveReusableMappings(nfe, [item], mappings).productMatches,
        [{ orderItemId: item.id, fiscalIndex: 0 }]);
    assert.equal(resolveReusableMappings({ ...nfe, items: [{ ...nfe.items[0], name: 'Outro produto P' }] }, [item], mappings).productMatches.length, 0);
    assert.equal(resolveReusableMappings({ ...nfe, items: [{ ...nfe.items[0], quantity: 2 }] }, [item], mappings).productMatches.length, 0);
    assert.equal(resolveReusableMappings(nfe, [{ ...item, color_name: 'Azul' }], mappings).productMatches.length, 0);
    assert.equal((await saveNffVariantMapping(productId, actorId, input, db)).saved, false);
    assert.equal(mappings.length, 1);
    assert.equal(calls.some(sql => /UPDATE orders|UPDATE fiscal_documents|UPDATE products|shipping_operations/i.test(sql)), false);
});

test('missing attestation, wrong variant and conflicting reuse fail without a new mapping', async () => {
    const { db, mappings } = fixture();
    await assert.rejects(saveNffVariantMapping(productId, actorId, { ...input, confirmed_match: false }, db), { status: 422 });
    await assert.rejects(saveNffVariantMapping(productId, actorId, { ...input, size: 'G' }, db), { status: 409 });
    await assert.rejects(saveNffVariantMapping(productId, actorId, { ...input, expected_color_name: 'Marfim' }, db), { status: 409 });
    mappings.push({ id: 'other', changes: { issuer_cnpj: '61738801000143', fiscal_code: '127',
        fiscal_description: 'shorts angel marfim p', product_id: 'other-product', color_id: 'azul', size: 'p' } });
    await assert.rejects(saveNffVariantMapping(productId, actorId, input, db), { status: 409 });
    assert.equal(mappings.length, 1);
});
