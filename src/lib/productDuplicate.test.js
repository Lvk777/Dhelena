import test from 'node:test';
import assert from 'node:assert/strict';
import { canDuplicateProduct, productDuplicateDraft } from './productDuplicate.js';

test('historical archived or sold products cannot be duplicated', () => {
    assert.equal(canDuplicateProduct({ status: 'archived', sold_count: 0 }), false);
    assert.equal(canDuplicateProduct({ status: 'draft', sold_count: 1 }), false);
    assert.throws(() => productDuplicateDraft({ status: 'archived', sold_count: 1 }), /histórico/);
});

test('a new duplicate is a draft without inherited stock', () => {
    const original = { name: 'Nova peça', status: 'published', sold_count: 0, price: 30,
        colors: [{ id: 'bege', stock: { P: 2, M: 3 } }] };
    const draft = productDuplicateDraft(original);
    assert.equal(draft.status, 'draft');
    assert.equal(draft.sku, '');
    assert.equal(draft.price, 30);
    assert.deepEqual(draft.colors[0].stock, { P: 0, M: 0 });
    assert.deepEqual(original.colors[0].stock, { P: 2, M: 3 });
});
