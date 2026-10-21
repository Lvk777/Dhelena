import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { checkoutDiscount, pixDiscountOffer, assertCheckoutPriceAcknowledged } from '../src/lib/checkoutDiscount.js';
import { previewCheckout } from '../src/lib/checkoutPreview.js';
import { placeOrder } from '../src/orderService.js';
import { createPixPayment } from '../src/services/mercadoPago.js';
import orderRouter from '../src/routes/orders.js';
import { validateSettingValue } from '../src/lib/publicSettings.js';
import { pool } from '../src/config/db.js';

const id = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const enabled = { PIX_DISCOUNT_ENABLED: 'true' };
const product = (price = 100, extra = {}) => ({ id, name: 'Synthetic', price, sale_price: null, status: 'published',
    category: 'Synthetic', sizes: ['M'], colors: [{ id: 'white', name: 'Synthetic', stock: { M: 3 } }],
    weight: 0.3, package_height: 10, package_width: 15, package_length: 20, ...extra });
const request = (extra = {}) => ({ items: [{ productId: id, colorId: 'white', size: 'M', qty: 1 }],
    coupon_code: '', payment_method: 'pix', shipping_method: 'retirada',
    shipping_address: { cep: '01001000' }, ...extra });
const ack = p => ({ subtotal: p.subtotal, discount: p.discount, shipping_cost: p.shipping_cost, total: p.total });

function fixture({ price = 100, sale_price = null, promotions = [], coupon = null, quote = 20,
    shipping = {}, stock = 3, env = enabled } = {}) {
    let state = { products: [product(price, { sale_price, colors: [{ id: 'white', name: 'Synthetic', stock: { M: stock } }] })],
        orders: [], movements: [], usages: [], orderItems: [] };
    const settings = { payments: { pix_enabled: true, pix_discount_enabled: true, pix_discount: 5 }, address: { cep: '01001000' },
        shipping: { pickup_enabled: true, melhor_envio_enabled: true, free_shipping_enabled: true, free_shipping_threshold: 499, ...shipping } };
    const queries = [];
    const db = { async query(sql, values = []) {
        queries.push(sql);
        if (/^SELECT value FROM settings/.test(sql)) return { rows: [{ value: settings[sql.match(/key = '([^']+)'/)[1]] }] };
        if (sql.startsWith('SELECT key,value FROM settings')) return { rows: Object.entries(settings).map(([key, value]) => ({ key, value })) };
        if (sql.includes('FROM products')) return { rows: structuredClone(state.products.filter(p => Array.isArray(values[0]) ? values[0].includes(p.id) : p.id === values[0])) };
        if (sql.startsWith('UPDATE products')) { state.products.find(p => p.id === values[2]).colors = JSON.parse(values[0]); return { rows: [] }; }
        if (sql.startsWith('SELECT pg_advisory') || sql.startsWith('SELECT id FROM profiles')) return { rows: [] };
        if (sql.includes('FROM orders WHERE idempotency_key')) return { rows: state.orders.filter(o => o.idempotency_key === values[0]) };
        if (sql.includes('FROM look_promotions')) return { rows: promotions };
        if (sql.includes('FROM coupons')) return { rows: coupon && coupon.code === values[0] ? [coupon] : [] };
        if (sql.includes('SELECT COUNT(*) FROM coupon_usages')) return { rows: [{ count: state.usages.length }] };
        if (sql.includes('SELECT COUNT(*) FROM orders')) return { rows: [{ count: state.orders.length }] };
        if (sql.includes('SELECT COALESCE(MAX(split_part')) return { rows: [{ last_number: state.orders.length }] };
        if (sql.startsWith('INSERT INTO stock_movements')) { state.movements.push(values); return { rows: [] }; }
        if (sql.startsWith('INSERT INTO coupon_usages')) { state.usages.push(values); return { rows: [] }; }
        if (sql.startsWith('INSERT INTO order_items')) { state.orderItems.push(values); return { rows: [] }; }
        if (sql.startsWith('INSERT INTO order_events')) return { rows: [] };
        if (sql.startsWith('INSERT INTO audit_logs')) return { rows: [] };
        if (sql.includes('INSERT INTO orders')) {
            const order = { id: '33333333-3333-4333-8333-333333333333', order_number: values[0], user_id: values[1],
                payment_method: values[2], shipping_cost: values[4], discount: values[5], subtotal: values[7], total: values[8],
                snapshot: JSON.parse(values[9]), idempotency_key: values[11] };
            state.orders.push(order); return { rows: [order] };
        }
        assert.fail(`Unexpected fixture query: ${sql}`);
    } };
    const quoteShipping = async () => [{ id: 1, price: quote, company: 'Synthetic', name: 'Mock', delivery_time: 3 }];
    const options = { db, env, quoteShipping };
    const transaction = async callback => {
        const before = structuredClone(state);
        try { return await callback(db); } catch (error) { state = before; throw error; }
    };
    return { db, settings, queries, options, get state() { return state; },
        preview: body => previewCheckout(body, userId, options),
        place: (body, key = 'synthetic-key-000000001') => placeOrder(userId, body, key, {
            transaction, quoteShipping, env, notify: async () => {},
            pixReadiness: () => ({ configured: true, webhook_configured: true }),
        }) };
}

test('Pix offer stays off without its explicit operator gate and approved percentage', () => {
    assert.deepEqual(pixDiscountOffer({ pix_discount: 5 }, {}), { enabled: false, percentage: 0 });
    assert.equal(pixDiscountOffer({ pix_discount: 5 }, enabled).enabled, false);
    assert.equal(pixDiscountOffer({ pix_discount_enabled: true, pix_discount: 5 }, { PIX_DISCOUNT_ENABLED: 'false' }).enabled, false);
    assert.equal(pixDiscountOffer({ pix_discount_enabled: true, pix_discount: 5, pix_enabled: false }, enabled).enabled, false);
    assert.deepEqual(pixDiscountOffer({ pix_discount_enabled: true, pix_discount: 5 }, enabled), { enabled: true, percentage: 5 });
});

test('admin Pix percentage is validated before saving and supports two decimal places', () => {
    for (const percentage of [0, 5, 7.5, 30]) {
        assert.doesNotThrow(() => validateSettingValue('payments', { pix_discount_enabled: false, pix_discount: percentage }));
    }
    for (const percentage of [-1, 30.01, 100, 5.001, '5', null, Infinity, NaN]) {
        assert.throws(() => validateSettingValue('payments', { pix_discount_enabled: false, pix_discount: percentage }), { status: 400 });
    }
    assert.throws(() => validateSettingValue('payments', { pix_discount_enabled: 'true', pix_discount: 5 }), { status: 400 });
    assert.throws(() => validateSettingValue('payments', { pix_discount_enabled: true, pix_discount: 0 }), { status: 400 });
});

test('configured Pix percentage is calculated from products in cents; disabling either gate restores full total', async () => {
    const f = fixture({ price: 19.99, quote: 12.34 });
    f.settings.payments.pix_discount = 7.5;
    const body = request({ shipping_method: 'melhor_envio', shipping_quote_id: 1 });
    const preview = await f.preview(body);
    assert.deepEqual(ack(preview), { subtotal: 19.99, discount: 1.50, shipping_cost: 12.34, total: 30.83 });
    const order = await f.place({ ...body, expected_pricing: ack(preview) });
    assert.equal(order.snapshot.pix_discount_percentage, 7.5);
    assert.equal(order.snapshot.discount_breakdown.pix, 1.50);
    f.settings.payments.pix_discount_enabled = false;
    assert.equal((await f.preview(body)).total, 32.33);
    assert.equal(order.total, 30.83);
});

test('disabled pickup rejects preview and final order without consuming stock or coupons', async () => {
    const f = fixture({ shipping: { pickup_enabled: false } });
    await assert.rejects(f.preview(request()), { status: 400 });
    await assert.rejects(f.place(request()), { status: 400 });
    assert.equal(f.state.products[0].colors[0].stock.M, 3);
    assert.equal(f.state.orders.length, 0);
    assert.equal(f.state.movements.length, 0);
    assert.equal(f.state.usages.length, 0);
});

test('approved business-day total is identical in checkout preview and final order snapshot', async () => {
    const f = fixture({ env: { SHIPPING_PREPARATION_ENABLED: 'true' }, shipping: { pickup_enabled: false, melhor_envio_extra_days: 2 } });
    const body = request({ shipping_method: 'melhor_envio', shipping_quote_id: 1, delivery_time: 1 });
    const preview = await f.preview(body);
    const order = await f.place({ ...body, expected_pricing: ack(preview), expected_delivery_estimate: preview.delivery_estimate });
    assert.equal(preview.delivery_estimate.total_business_days, 5);
    assert.deepEqual(order.snapshot.delivery_estimate, preview.delivery_estimate);
    assert.equal(order.snapshot.shipping_delivery_time, 5);
    assert.equal(order.total, preview.total);
});

test('a changed delivery promise rolls back the order and allows a fresh preview', async () => {
    const f = fixture({ env: { SHIPPING_PREPARATION_ENABLED: 'true' }, shipping: { pickup_enabled: false, melhor_envio_extra_days: 2 } });
    const body = request({ shipping_method: 'melhor_envio', shipping_quote_id: 1 });
    const preview = await f.preview(body);
    f.settings.shipping.melhor_envio_extra_days = 3;
    await assert.rejects(f.place({ ...body, expected_pricing: ack(preview), expected_delivery_estimate: preview.delivery_estimate }), { status: 409 });
    assert.equal(f.state.orders.length, 0);
    assert.equal(f.state.products[0].colors[0].stock.M, 3);
    const refreshed = await f.preview(body);
    assert.equal(refreshed.delivery_estimate.total_business_days, 6);
    const order = await f.place({ ...body, expected_pricing: ack(refreshed), expected_delivery_estimate: refreshed.delivery_estimate });
    assert.equal(order.snapshot.shipping_delivery_time, 6);
});

test('5% Pix applies only to products and leaves paid freight unchanged', async () => {
    const f = fixture();
    const result = await f.preview(request({ shipping_method: 'melhor_envio', shipping_quote_id: 1, total: 1, shipping_cost: 0 }));
    assert.deepEqual(ack(result), { subtotal: 100, discount: 5, shipping_cost: 20, total: 115 });
    assert.equal(result.discount_breakdown.pix, 5);
    assert.equal(f.queries.some(sql => /^(UPDATE|INSERT|DELETE)/.test(sql)), false);
    assert.equal(f.state.products[0].colors[0].stock.M, 3);
});

test('subtotal and Pix round once in integer cents, including half-cent boundaries', async () => {
    for (const [price, qty, discount, total] of [[199.90, 1, 10, 189.90], [0.10, 3, 0.02, 0.28], [29.90, 3, 4.49, 85.21]]) {
        const f = fixture({ price });
        const result = await f.preview(request({ items: [{ productId: id, colorId: 'white', size: 'M', qty }] }));
        assert.equal(result.discount, discount); assert.equal(result.total, total);
    }
});

test('selected coupon prevails over a larger Pix discount without accumulating', async () => {
    const f = fixture({ coupon: { id: 'coupon', code: 'KEEP', active: true, discount_type: 'percentage', discount_value: 1, min_order_value: 0 } });
    const result = await f.preview(request({ coupon_code: 'KEEP' }));
    assert.equal(result.total, 99); assert.equal(result.discount_breakdown.coupon, 1);
    assert.equal(result.discount_breakdown.pix, 0); assert.equal(result.pix_discount_reason, 'coupon');
    const order = await f.place(request({ coupon_code: 'KEEP', expected_pricing: ack(result) }));
    assert.equal(order.total, 99); assert.equal(f.state.usages.length, 1);
});

test('automatic price campaign prevails and Pix adds no second discount', async () => {
    const f = fixture({ promotions: [{ name: 'Synthetic', min_items: 1, discount_percent: 10 }] });
    const result = await f.preview(request());
    assert.equal(result.total, 90); assert.equal(result.discount_breakdown.promotion, 10);
    assert.equal(result.discount_breakdown.pix, 0); assert.equal(result.pix_discount_reason, 'price_promotion');
    assert.equal((await f.place(request({ expected_pricing: ack(result) }))).total, result.total);
});

test('sale-priced products, including mixed baskets, cannot also receive Pix discount', async () => {
    const f = fixture({ price: 100, sale_price: 80 });
    const second = '44444444-4444-4444-8444-444444444444';
    f.state.products.push(product(100, { id: second }));
    const result = await f.preview(request({ items: [...request().items, { productId: second, colorId: 'white', size: 'M', qty: 1 }] }));
    assert.equal(result.subtotal, 180); assert.equal(result.total, 180);
    assert.equal(result.discount_breakdown.pix, 0); assert.equal(result.pix_discount_reason, 'price_promotion');
});

test('existing coupon/campaign combination is preserved without adding Pix', () => {
    const result = checkoutDiscount({ subtotal: 100, lines: [{}], couponCode: 'KEEP', couponDiscount: 10,
        promotions: [{ discount_percent: 10, stacks_with_coupon: true }], paymentMethod: 'pix',
        paymentConfig: { pix_discount_enabled: true, pix_discount: 5 }, env: enabled });
    assert.equal(result.discount, 20); assert.equal(result.discount_breakdown.pix, 0);
});

test('invalid coupon is rejected instead of silently replaced by Pix', async () => {
    const f = fixture();
    await assert.rejects(f.preview(request({ coupon_code: 'UNKNOWN' })), { status: 400 });
    assert.equal(f.state.orders.length, 0);
});

test('free shipping threshold uses product subtotal AFTER Pix, at the cent boundary', async () => {
    const body = request({ shipping_method: 'melhor_envio', shipping_quote_id: 1 });
    const below = await fixture({ price: 525.26, quote: 29.90 }).preview(body);
    const above = await fixture({ price: 525.27, quote: 29.90 }).preview(body);
    assert.deepEqual(ack(below), { subtotal: 525.26, discount: 26.26, shipping_cost: 0, total: 499 });
    assert.equal(above.shipping_cost, 0);
    assert.equal((await fixture({ price: 525.25, quote: 29.90 }).preview(body)).shipping_cost, 29.90);
    const f = fixture({ price: 499, quote: 29.90 });
    const result = await f.preview(body);
    assert.deepEqual(ack(result), { subtotal: 499, discount: 24.95, shipping_cost: 29.90, total: 503.95 });
    const order = await f.place({ ...body, expected_pricing: ack(result) });
    assert.equal(order.total, result.total); assert.equal(order.shipping_cost, 29.90);
});

test('credit/debit and a disabled offer retain the existing total', async () => {
    for (const payment_method of ['credito', 'debito']) {
        const result = await fixture().preview(request({ payment_method }));
        assert.equal(result.total, 100); assert.equal(result.discount, 0);
    }
    const result = await fixture({ env: {} }).preview(request());
    assert.equal(result.total, 100); assert.equal(result.pix_discount_percentage, 0);
});

test('unknown quote ID, invalid dimensions, and unavailable stock block preview', async () => {
    const f = fixture();
    await assert.rejects(f.preview(request({ shipping_method: 'melhor_envio', shipping_quote_id: 9 })), { status: 409 });
    f.state.products[0].weight = 0;
    await assert.rejects(f.preview(request({ shipping_method: 'melhor_envio', shipping_quote_id: 1 })), { status: 400 });
    await assert.rejects(fixture({ stock: 0 }).preview(request()), { status: 409 });
});

test('repeated variants are checked against aggregate stock without reserving it', async () => {
    const f = fixture({ stock: 1 });
    await assert.rejects(f.preview(request({ items: [...request().items, ...request().items] })), { status: 409 });
    assert.equal(f.state.products[0].colors[0].stock.M, 1);
    assert.equal(f.state.movements.length, 0);
});

test('final order matches preview, debits stock once, and retry does not reprice', async () => {
    const f = fixture({ price: 199.90 });
    const preview = await f.preview(request());
    const body = request({ expected_pricing: ack(preview), subtotal: 1, discount: 199, total: 1 });
    const order = await f.place(body);
    assert.deepEqual(ack(order), ack(preview));
    assert.equal(order.snapshot.discount_breakdown.pix, 10);
    assert.equal(f.state.products[0].colors[0].stock.M, 2);
    assert.equal(f.state.movements.length, 1);
    assert.equal((await f.place(body)).id, order.id);
    assert.equal(f.state.orders.length, 1); assert.equal(f.state.movements.length, 1);
});

test('missing or stale preview causes transactional rollback without losing stock', async () => {
    const f = fixture();
    await assert.rejects(f.place(request()), { status: 409 });
    assert.equal(f.state.orders.length, 0); assert.equal(f.state.movements.length, 0);
    assert.equal(f.state.products[0].colors[0].stock.M, 3);
    const preview = await f.preview(request());
    f.state.products[0].price = 200;
    await assert.rejects(f.place(request({ expected_pricing: ack(preview) })), { status: 409 });
    assert.equal(f.state.orders.length, 0); assert.equal(f.state.products[0].colors[0].stock.M, 3);
});

test('an archived item in an old cart fails preview and order creation without reserving stock', async () => {
    const f = fixture();
    const body = request();
    const preview = await f.preview(body);
    f.state.products[0].status = 'archived';
    await assert.rejects(f.preview(body), { status: 409 });
    await assert.rejects(f.place({ ...body, expected_pricing: ack(preview) }), { status: 409 });
    assert.equal(f.state.orders.length, 0);
    assert.equal(f.state.movements.length, 0);
    assert.equal(f.state.products[0].colors[0].stock.M, 3);
});

test('a changed coupon or quote also invalidates the acknowledged final amount', () => {
    assert.throws(() => assertCheckoutPriceAcknowledged({ subtotal: 100, discount: 5, shipping_cost: 20, total: 115 },
        { subtotal: 100, discount: 10, shipping_cost: 20, total: 110 }), { status: 409 });
    assert.throws(() => assertCheckoutPriceAcknowledged({ subtotal: 100, discount: 5, shipping_cost: 20, total: 115 },
        { subtotal: 100, discount: 5, shipping_cost: 21, total: 116 }), { status: 409 });
});

test('Mercado Pago mock receives precisely the persisted final total and idempotency key', async () => {
    const f = fixture({ price: 199.90, quote: 14.95 });
    const body = request({ shipping_method: 'melhor_envio', shipping_quote_id: 1 });
    const preview = await f.preview(body);
    const order = await f.place({ ...body, expected_pricing: ack(preview) });
    const oldFetch = global.fetch; const oldToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    process.env.MERCADO_PAGO_ACCESS_TOKEN = 'synthetic-mock-only';
    let payload;
    global.fetch = async (url, options) => {
        assert.equal(url, 'https://api.mercadopago.com/v1/orders'); assert.equal(options.method, 'POST');
        assert.equal(options.headers['X-Idempotency-Key'], `pix-${order.id}`);
        payload = JSON.parse(options.body);
        return { ok: true, json: async () => ({ id: 'mock-order', external_reference: order.order_number,
            transactions: { payments: [{ id: 'mock-payment', status: 'pending' }] } }) };
    };
    try {
        await createPixPayment({ orderId: order.id, orderNumber: order.order_number, total: order.total,
            payer: { email: 'synthetic@example.invalid', first_name: 'Synthetic' }, idempotencyKey: `pix-${order.id}` });
        assert.equal(payload.total_amount, '204.85');
        assert.equal(payload.transactions.payments[0].amount, payload.total_amount);
        assert.equal(Number(payload.total_amount), preview.total);
    } finally { global.fetch = oldFetch; if (oldToken === undefined) delete process.env.MERCADO_PAGO_ACCESS_TOKEN; else process.env.MERCADO_PAGO_ACCESS_TOKEN = oldToken; }
});

test('HTTP preview ignores crafted prices, returns the reviewable breakdown, and writes nothing', async () => {
    const f = fixture(); const original = pool.query; const oldGate = process.env.PIX_DISCOUNT_ENABLED;
    pool.query = f.db.query; process.env.PIX_DISCOUNT_ENABLED = 'true';
    const app = express(); app.use(express.json()); app.use('/api', orderRouter);
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/checkout/preview`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify(request({ total: 1, pix_discount: 100, subtotal: 1 })) });
        assert.equal(response.status, 200); const data = await response.json();
        assert.equal(data.discount_breakdown.pix, 5); assert.equal(data.total, 95);
        assert.equal(f.queries.some(sql => /^(UPDATE|INSERT|DELETE)/.test(sql)), false);
    } finally {
        pool.query = original; if (oldGate === undefined) delete process.env.PIX_DISCOUNT_ENABLED; else process.env.PIX_DISCOUNT_ENABLED = oldGate;
        server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
});
