import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProductWrite, productWriteConflict } from '../src/routes/catalog.js';

test('optional blank product SKUs become SQL NULL on create and update', () => {
    const original = { name: 'Peça de teste', sku: '   ', status: 'published' };
    assert.deepEqual(normalizeProductWrite(original), { ...original, sku: null });
    assert.equal(original.sku, '   ', 'the original request should not be mutated');
    assert.deepEqual(normalizeProductWrite({ sku: '' }), { sku: null });
    assert.deepEqual(normalizeProductWrite({ sku: null }), { sku: null });
});

test('normalization preserves real SKUs and does not clear an omitted SKU on PATCH', () => {
    assert.deepEqual(normalizeProductWrite({ sku: '  LUA-42  ' }), { sku: 'LUA-42' });
    assert.deepEqual(normalizeProductWrite({ name: 'Peça corrigida' }), { name: 'Peça corrigida' });
    assert.throws(() => normalizeProductWrite({ sku: 123 }), { status: 400 });
});

test('a repeated nonempty SKU produces a useful 409 instead of a server error', () => {
    const pgError = Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505', constraint: 'products_sku_key',
    });
    const result = productWriteConflict(pgError);
    assert.equal(result.status, 409);
    assert.match(result.message, /SKU já está cadastrado/);
    assert.doesNotMatch(result.message, /duplicate key|constraint/i);
    const ordinaryError = new Error('unrelated database failure');
    assert.equal(productWriteConflict(ordinaryError), ordinaryError);
});
