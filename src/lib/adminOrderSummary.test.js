import test from 'node:test';
import assert from 'node:assert/strict';
import { adminOrderSummary } from './adminOrderSummary.js';

test('admin list displays the original customer and item count from a listed order', () => {
    const order = { order_number: 'DH-2026-000019', snapshot: {
        customer: { name: 'Cliente de teste', email: 'teste@example.invalid', phone: '11900000000', cpf: '00000000000' },
        items: [{ product_name: 'Peça histórica' }],
    } };
    const summary = adminOrderSummary(order);
    assert.equal(summary.customer_name, 'Cliente de teste');
    assert.equal(summary.customer_email, 'teste@example.invalid');
    assert.equal(summary.item_count, 1);
});

test('actual item rows take precedence over the order snapshot', () => {
    const summary = adminOrderSummary({ items: [{}, {}], snapshot: { items: [{}] }, customer_name: 'Nome atual' });
    assert.equal(summary.item_count, 2);
    assert.equal(summary.customer_name, 'Nome atual');
});
