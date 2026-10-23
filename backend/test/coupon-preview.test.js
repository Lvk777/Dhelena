import test from 'node:test';
import assert from 'node:assert/strict';
import { couponPreviewSubtotal, validateCoupon } from '../src/services.js';

const id = 'e6dfe65b-f491-41e2-b54d-5c4499a69be7';
const productDb = { query: async () => ({ rows: [{ id, price: '189.90', sale_price: null }] }) };

test('coupon preview resolves catalog prices from the actual frontend payload', async () => {
    const subtotal = await couponPreviewSubtotal([{ productId: id, qty: 2 }], productDb);
    assert.equal(subtotal, 379.8);
    const db = { query: async () => ({ rows: [{ id: 'fixture', code: 'FIXTURE', active: true,
        min_order_value: 300, discount_type: 'percentage', discount_value: 10 }] }) };
    const result = await validateCoupon('FIXTURE', null, subtotal, [], { db });
    assert.equal(result.valid, true);
    assert.equal(result.discount, 37.98);
});

test('coupon preview ignores forged browser prices and uses catalog sale price', async () => {
    const db = { query: async () => ({ rows: [{ id, price: '189.90', sale_price: '150.00' }] }) };
    assert.equal(await couponPreviewSubtotal([{ productId: id, qty: 2, price: 999999 }], db), 300);
});

test('coupon preview rejects invalid carts before querying', async () => {
    const db = { query: async () => { assert.fail('invalid cart queried the database'); } };
    for (const items of [null, [], [{ productId: 'invalid', qty: 1 }], [{ productId: id, qty: 0 }],
        [{ productId: id, qty: -1 }], [{ productId: id, qty: 1.5 }], [{ productId: id, qty: '1' }]]) {
        await assert.rejects(couponPreviewSubtotal(items, db), { status: 400 });
    }
});

test('coupon preview rejects missing products and invalid catalog prices', async () => {
    const items = [{ productId: id, qty: 1 }];
    await assert.rejects(couponPreviewSubtotal(items, { query: async () => ({ rows: [] }) }), { status: 404 });
    await assert.rejects(couponPreviewSubtotal(items, { query: async () => ({ rows: [{ id, price: 'invalid' }] }) }), { status: 500 });
});
