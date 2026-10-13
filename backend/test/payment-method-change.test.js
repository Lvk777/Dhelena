import test from 'node:test';
import assert from 'node:assert/strict';
import { changeOrderPaymentMethod, changedPaymentPricing, canChangePaymentMethod as backendEligibility } from '../src/lib/paymentMethodChange.js';
import { canChangePaymentMethod } from '../../src/lib/paymentEligibility.js';
import { creditInstallmentPolicy, validateCardPaymentChoice, assertSupportedInstallments } from '../src/lib/paymentChoice.js';
import { publicSetting } from '../src/lib/publicSettings.js';

const user = { id: 'customer', role: 'customer' };
const base = () => ({ id: 'order', user_id: user.id, status: 'recebido', payment_status: 'pending',
    payment_method: 'credito', subtotal: 199.90, discount: 0, shipping_cost: 14.95, total: 214.85,
    snapshot: { items: [{ price_promotion: false }], discount_breakdown: { coupon: 0, promotion: 0, pix: 0 },
        idempotency_fingerprint: 'original-checkout-fingerprint', delivery_estimate: { total_business_days: 5 } } });
const provider = { getMercadoPagoReadiness: () => ({ configured: true, public_key_configured: true, webhook_configured: true }),
    getPaymentMethods: async () => [{ id: 'visa', payment_type_id: 'credit_card' }, { id: 'debelo', payment_type_id: 'debit_card' }] };

function fixture(order = base(), env = {}) {
    let queue = Promise.resolve();
    const queries = [];
    const state = { order, events: 0, stock: 7, couponUses: 1, charges: 0 };
    const db = { async query(sql, args) {
        queries.push(sql);
        if (sql.startsWith('SELECT pg_advisory')) return { rows: [] };
        if (sql.startsWith('SELECT * FROM orders')) return { rows: [structuredClone(state.order)] };
        if (sql.includes('FROM settings')) return { rows: [{ value: { pix_enabled: true, pix_discount: 5 } }] };
        if (sql.startsWith('UPDATE orders')) {
            Object.assign(state.order, { payment_method: args[0], discount: args[1], total: args[2], snapshot: JSON.parse(args[3]) });
            return { rows: [structuredClone(state.order)] };
        }
        if (sql.startsWith('INSERT INTO order_events')) { state.events++; return { rows: [] }; }
        assert.fail(`Unexpected query: ${sql}`);
    } };
    const transaction = callback => {
        const next = queue.then(async () => {
            const before = structuredClone(state);
            try { return await callback(db); } catch (error) { Object.assign(state, before); throw error; }
        });
        queue = next.catch(() => {}); return next;
    };
    return { state, queries,
        preview: (method, owner = user) => changeOrderPaymentMethod('order', owner, { payment_method: method }, null, { transaction, provider, env, preview: true }),
        change: (method, expected_pricing, key = 'synthetic-payment-change-001', owner = user) => changeOrderPaymentMethod('order', owner,
            { payment_method: method, expected_pricing, total: 0, discount: 999 }, key, { transaction, provider, env }) };
}

test('credit installments require commercial approval, cap at six, and cannot be activated by config alone', () => {
    const config = { max_installments: 12, interest_free_installments: 12 };
    assert.deepEqual(creditInstallmentPolicy(config, {}), { max_installments: 1, interest_free_approved: false });
    assert.equal(creditInstallmentPolicy(config, { CREDIT_INSTALLMENTS_APPROVED: 'true' }).max_installments, 6);
    assert.equal(creditInstallmentPolicy({ max_installments: 3, interest_free_installments: 6 }, { CREDIT_INSTALLMENTS_APPROVED: 'true' }).max_installments, 3);
});

test('supported credit plans must be interest-free and exactly match the server total', () => {
    const plans = [{ payer_costs: [{ installments: 6, installment_rate: 0, total_amount: '214.85' }] }];
    assert.doesNotThrow(() => assertSupportedInstallments(plans, 6, 214.85));
    assert.throws(() => assertSupportedInstallments(plans, 5, 214.85));
    assert.throws(() => assertSupportedInstallments(plans, 6, 214.86));
    assert.throws(() => assertSupportedInstallments([{ payer_costs: [{ installments: 6, installment_rate: 10, total_amount: '214.85' }] }], 6, 214.85));
});

test('installment lookup must match both card brand and issuer, with an explicit zero rate', () => {
    const choice = { paymentMethodId: 'master', issuerId: '12749' };
    const plan = { payment_method_id: 'master', payment_type_id: 'credit_card', issuer: { id: '12749' },
        payer_costs: [{ installments: 6, installment_rate: 0, total_amount: 50 }] };
    assert.doesNotThrow(() => assertSupportedInstallments([plan], 6, 50, choice));
    for (const incompatible of [{ ...plan, payment_method_id: 'visa' }, { ...plan, issuer: { id: 'other' } },
        { ...plan, payment_type_id: 'debit_card' }, { ...plan, issuer: undefined }]) {
        assert.throws(() => assertSupportedInstallments([incompatible], 6, 50, choice), { status: 409 });
    }
    for (const rate of [null, undefined, '', 14.32]) {
        assert.throws(() => assertSupportedInstallments([{ ...plan, payer_costs: [{ installments: 6, installment_rate: rate, total_amount: 50 }] }], 6, 50, choice), { status: 409 });
    }
    // Actual TEST observation: R$50 turns into R$57.16 for 6x, so it is not zero-interest.
    assert.throws(() => assertSupportedInstallments([{ ...plan, payer_costs: [{ installments: 6, installment_rate: 14.32, total_amount: 57.16 }] }], 6, 50, choice), { status: 409 });
});

test('public storefront does not promise the CMS installment text before commercial activation', t => {
    const previous = process.env.CREDIT_INSTALLMENTS_APPROVED;
    delete process.env.CREDIT_INSTALLMENTS_APPROVED;
    t.after(() => { if (previous !== undefined) process.env.CREDIT_INSTALLMENTS_APPROVED = previous; });
    const source = { key: 'store', is_public: true, value: { max_installments: 6, interest_free_installments: 6,
        top_bar_text: 'Frete grátis a partir de R$ 499 · Parcelamos em até 6x' } };
    const projected = publicSetting(source);
    assert.equal(projected.value.top_bar_text, 'Frete grátis a partir de R$ 499');
    assert.equal(projected.value.max_installments, 1);
    assert.equal(source.value.max_installments, 6);
});

test('debit type, cash-only installments and provider amount limits are enforced separately', () => {
    const methods = [{ id: 'debelo', payment_type_id: 'debit_card', min_allowed_amount: 1, max_allowed_amount: 100 }];
    assert.doesNotThrow(() => validateCardPaymentChoice('debito', methods, 'debelo', 1, {}, 100));
    assert.throws(() => validateCardPaymentChoice('debito', methods, 'debelo', 2, {}, 100));
    assert.throws(() => validateCardPaymentChoice('credito', methods, 'debelo', 1, {}, 100));
    assert.throws(() => validateCardPaymentChoice('debito', methods, 'debelo', 1, {}, 100.01));
});

for (const [field, value] of Object.entries({ status: 'cancelado', payment_status: 'approved', paid_at: '2026-01-01',
    payment_provider: 'mercado_pago', mercado_pago_order_id: 'ORD1', mercado_pago_payment_id: 'PAY1',
    payment_attempt_started_at: '2026-01-01', payment_attempt_method: 'pix', refunded_amount: 1 })) {
    test(`method change refuses ${field} and never changes reservations`, async () => {
        const f = fixture({ ...base(), [field]: value });
        assert.equal(canChangePaymentMethod(f.state.order), false);
        assert.equal(backendEligibility(f.state.order), canChangePaymentMethod(f.state.order));
        await assert.rejects(f.preview('pix'), { status: 409 });
        assert.equal(f.state.stock, 7); assert.equal(f.state.couponUses, 1); assert.equal(f.state.events, 0);
    });
}

test('all three methods share the existing order; duplicate and concurrent requests mutate it once', async () => {
    const f = fixture();
    for (const [index, method] of ['debito', 'pix', 'credito'].entries()) {
        const preview = await f.preview(method);
        const key = `synthetic-payment-change-${index}`;
        const [first, retry] = await Promise.all([f.change(method, preview, key), f.change(method, preview, key)]);
        assert.equal(first.id, 'order'); assert.equal(retry.payment_method, method);
        assert.equal(first.total, 214.85); assert.equal(first.snapshot.idempotency_fingerprint, 'original-checkout-fingerprint');
        assert.deepEqual(first.snapshot.delivery_estimate, { total_business_days: 5 });
    }
    assert.equal(f.state.events, 3); assert.equal(f.state.stock, 7); assert.equal(f.state.couponUses, 1); assert.equal(f.state.charges, 0);
    assert.equal(f.queries.some(sql => /stock|coupon_usages|INSERT INTO orders/.test(sql)), false);
});

test('ownership, reused keys and stale previews reject without changing the financial choice', async () => {
    const f = fixture(); const preview = await f.preview('pix');
    await assert.rejects(f.preview('pix', { id: 'other', role: 'customer' }), { status: 404 });
    await assert.rejects(f.change('pix', { ...preview, total: 0 }), { status: 409 });
    assert.equal(f.state.order.payment_method, 'credito');
    await f.change('pix', preview);
    await assert.rejects(f.change('debito', preview), { status: 409 });
    // A payment starts after preview: it must not be reset by the change.
    f.state.order.payment_attempt_started_at = '2026-01-01';
    await assert.rejects(f.change('debito', preview, 'synthetic-payment-change-002'), { status: 409 });
    assert.equal(f.state.order.payment_method, 'pix'); assert.equal(f.state.events, 1);
});

test('future homologated Pix switch rounds once, affects products only and preserves paid freight', async () => {
    const f = fixture(base(), { PIX_DISCOUNT_ENABLED: 'true' });
    const preview = await f.preview('pix');
    assert.equal(preview.discount, 10); assert.equal(preview.shipping_cost, 14.95); assert.equal(preview.total, 204.85);
    const changed = await f.change('pix', preview);
    assert.equal(changed.snapshot.discount_breakdown.pix, 10);
    const card = await f.preview('debito');
    assert.equal(card.total, 214.85);
    await f.change('debito', card, 'synthetic-payment-change-002');
    assert.equal(f.state.stock, 7); assert.equal(f.state.couponUses, 1);
});

test('coupon, promotion, free freight and legacy pricing survive method changes', () => {
    for (const order of [
        { ...base(), coupon_code: 'KEEP', discount: 15, total: 199.85, snapshot: { ...base().snapshot, discount_breakdown: { coupon: 15, promotion: 0, pix: 0 } } },
        { ...base(), snapshot: { ...base().snapshot, items: [{ price_promotion: true }] } },
        { ...base(), discount: 15, snapshot: { ...base().snapshot, discount_breakdown: { coupon: 0, promotion: 15, pix: 0 } } },
    ]) {
        const pricing = changedPaymentPricing(order, 'pix', { pix_discount: 5 }, { PIX_DISCOUNT_ENABLED: 'true' });
        assert.equal(pricing.discount, order.discount); assert.equal(pricing.discount_breakdown.pix, 0);
    }
    assert.equal(changedPaymentPricing({ ...base(), shipping_cost: 0 }, 'pix', { pix_discount: 5 }, { PIX_DISCOUNT_ENABLED: 'true' }).shipping_cost, 0);
    assert.equal(changedPaymentPricing({ ...base(), snapshot: {} }, 'debito', {}, {}).total, 214.85);
    assert.throws(() => changedPaymentPricing({ ...base(), snapshot: {} }, 'pix', { pix_discount: 5 }, { PIX_DISCOUNT_ENABLED: 'true' }));
});
