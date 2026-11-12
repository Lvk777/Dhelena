import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileCart } from './cartReconciliation.js';

const product = (id, status = 'published', stock = 1) => ({
    id, status, sizes: ['PP'], colors: [{ id: 'bege', stock: { PP: stock } }],
});
const item = (productId, qty = 1, size = 'PP') => ({ productId, colorId: 'bege', size, qty });

test('an archived item from an old cart stays removable while a published item is preserved', () => {
    const cart = [item('old'), item('new')];
    const result = reconcileCart(cart, [product('old', 'archived'), product('new')]);
    assert.deepEqual(result.unavailableItems, [cart[0]]);
    assert.deepEqual(result.lines.map((line) => line.productId), ['new']);
    assert.deepEqual(result.invalidLines, []);
    assert.deepEqual(cart, [item('old'), item('new')]);
});

test('a deleted product is unavailable without dropping the valid cart entry', () => {
    const result = reconcileCart([item('deleted'), item('new')], [product('new')]);
    assert.deepEqual(result.unavailableItems.map((entry) => entry.productId), ['deleted']);
    assert.deepEqual(result.lines.map((line) => line.productId), ['new']);
});

test('zero stock, changed variant, and excess quantity remain visible but block checkout', () => {
    const cart = [item('empty'), item('changed', 1, 'G'), item('limited', 2), item('new')];
    const result = reconcileCart(cart, [product('empty', 'published', 0), product('changed'), product('limited'), product('new')]);
    assert.deepEqual(result.unavailableItems, []);
    assert.deepEqual(result.invalidLines.map((line) => line.productId), ['empty', 'changed', 'limited']);
    assert.deepEqual(result.lines.map((line) => line.productId), ['empty', 'changed', 'limited', 'new']);
});

test('legacy cart metadata is retained without changing quantity or discount inputs', () => {
    const legacy = { ...item('new'), price: 999, coupon: 'OLD', addedAt: '2025-01-01' };
    const result = reconcileCart([legacy], [product('new')]);
    assert.equal(result.lines[0].qty, 1);
    assert.equal(result.lines[0].productId, 'new');
    assert.equal(result.lines[0].coupon, 'OLD');
    assert.deepEqual(result.invalidLines, []);
});

test('an old cart with only removed products or malformed quantities cannot proceed', () => {
    const removed = reconcileCart([item('archived'), item('deleted')], [product('archived', 'archived')]);
    assert.equal(removed.lines.length, 0);
    assert.deepEqual(removed.unavailableItems.map((entry) => entry.productId), ['archived', 'deleted']);
    const malformed = reconcileCart([{ ...item('new'), qty: '1' }], [product('new')]);
    assert.equal(malformed.lines.length, 1);
    assert.equal(malformed.invalidLines.length, 1);
});

test('a temporary empty catalog response never changes a saved cart', () => {
    const cart = [item('new'), item('old')];
    const unavailable = reconcileCart(cart, []);
    assert.equal(unavailable.lines.length, 0);
    assert.equal(unavailable.unavailableItems.length, 2);
    assert.deepEqual(cart, [item('new'), item('old')]);

    const restored = reconcileCart(cart, [product('new'), product('old', 'archived')]);
    assert.deepEqual(restored.lines.map((line) => line.productId), ['new']);
    assert.deepEqual(restored.unavailableItems.map((line) => line.productId), ['old']);
});
