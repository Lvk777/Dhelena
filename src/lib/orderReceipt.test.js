import assert from 'node:assert/strict';
import test from 'node:test';
import { orderReceiptText } from './orderReceipt.js';

test('receipt uses the order snapshot without creating an order or claiming payment approval', () => {
    const receipt = orderReceiptText({ id: 'synthetic-order', order_number: 'DH-MOCK-1',
        created_at: '2026-10-21T12:00:00Z', subtotal: 20, discount: 0, shipping_cost: 9.9, total: 29.9,
        payment_method: 'pix', shipping_method: 'melhor_envio',
        snapshot: { items: [{ product_name: 'Produto fictício', quantity: 1, color_name: 'Azul', size: 'M', subtotal: 20 }],
            delivery_estimate: { total_business_days: 5 } },
        shipping_address: { street: 'Rua Teste', number: '1', district: 'Centro', city: 'São Paulo', state: 'SP', cep: '01001000' },
    });
    assert.match(receipt, /DH-MOCK-1/);
    assert.match(receipt, /Produto fictício/);
    assert.match(receipt, /R\$\s*29,90/);
    assert.match(receipt, /5 dia\(s\) útil\(eis\)/);
    assert.doesNotMatch(receipt, /pagamento (aprovado|confirmado)/i);
});
