import test from 'node:test';
import assert from 'node:assert/strict';
import { installmentDefaults as defaults, installmentConfig, installmentVersion, effectiveInstallmentPolicy,
    makeInstallmentApproval, installmentOffers, assertCompleteInstallmentRange, confirmInstallmentOffer } from '../src/lib/installmentPolicy.js';
import { verifyPaymentResourceForOrder } from '../src/lib/paymentVerification.js';
import { guardNativeInstallments } from '../../src/lib/cardInstallmentGuard.js';

const plans = (max = 12, zero = 6) => [{ payment_method_id: 'master', payment_type_id: 'credit_card', issuer: { id: '12749' },
    payer_costs: Array.from({ length: max }, (_, i) => { const n = i + 1, total = n <= zero ? 120 : 144;
        return { installments: n, installment_rate: n <= zero ? 0 : 20, installment_amount: Math.round(total / n * 100) / 100, total_amount: total }; }) }];
const approved = config => ({ ...config, approval: makeInstallmentApproval(config, 'Teste', 'admin') });
test('disabled, unapproved and cross-environment policies stay at one installment', () => {
    assert.equal(effectiveInstallmentPolicy(defaults, 'Teste').max_installments, 1);
    assert.equal(effectiveInstallmentPolicy({ ...defaults, enabled: true }, 'Teste').max_installments, 1);
    assert.equal(effectiveInstallmentPolicy(approved({ ...defaults, enabled: true }), 'Produção').max_installments, 1);
});
for (const max of [6, 12]) test(`approved range ${max} uses provider options and never changes their totals`, () => {
    const config = approved({ ...defaults, enabled: true, max_installments: max });
    const offers = installmentOffers(plans(), config, 120);
    assert.equal(effectiveInstallmentPolicy(config, 'Teste').max_installments, max);
    assert.equal(offers.length, max); assertCompleteInstallmentRange(offers, config);
    assert.equal(offers.at(-1).buyer_total, max === 6 ? 120 : 144);
    assert.equal(offers.at(-1).merchant_net, null);
});
test('seller financing accepts only actual zero-interest plans and invents no boutique fee', () => {
    const config = { ...defaults, interest_payer: 'seller' };
    const offers = installmentOffers(plans(12, 12), config, 120);
    assertCompleteInstallmentRange(offers, config);
    assert.ok(offers.every(o => o.buyer_interest_amount === 0 && o.processing_fee === null && o.merchant_financing_cost === null));
    assert.equal(installmentOffers(plans(12, 1), config, 120).length, 1);
});
test('buyer financing respects the free range and computes interest from the provider total only', () => {
    const offer = installmentOffers(plans(), defaults, 120).find(o => o.installments === 12);
    assert.equal(offer.installment_amount, 12); assert.equal(offer.buyer_interest_rate, 20);
    assert.equal(offer.buyer_interest_amount, 24); assert.equal(offer.buyer_total, 144);
    assert.equal(installmentOffers(plans(12, 1), defaults, 120).some(o => o.installments === 6), true);
    assert.equal(installmentOffers(plans(), { ...defaults, allow_interest: false }, 120).length, 6);
});
test('missing provider quantities, minimum amounts and divergent rounding block the proposed range', () => {
    assert.throws(() => assertCompleteInstallmentRange(installmentOffers(plans(9), defaults, 120), defaults), /10x/);
    const offers = installmentOffers(plans(), { ...defaults, min_installment_amount: 25 }, 120);
    assert.ok(offers.every(o => o.installment_amount >= 25));
    const p = plans(); p[0].payer_costs[11].installment_amount = 11;
    assert.equal(installmentOffers(p, defaults, 120).some(o => o.installments === 12), false);
    const mixed = installmentOffers(plans(), defaults, 120).map(o => ({ ...o, issuer_id: o.installments === 12 ? 'other' : o.issuer_id }));
    assert.throws(() => assertCompleteInstallmentRange(mixed, defaults), /mesma bandeira e emissor/);
});
test('a provider rounding adjustment is retained rather than multiplying the displayed installment', () => {
    const p = [{ payment_method_id: 'master', issuer: { id: 12749 }, payer_costs: [{ installments: 6, installment_rate: 14.32, installment_amount: 9.53, total_amount: 57.16 }] }];
    const offer = installmentOffers(p, { ...defaults, interest_free_installments: 1 }, 50)[0];
    assert.equal(offer.buyer_total, 57.16); assert.equal(offer.buyer_interest_amount, 7.16);
    assert.equal(offer.installment_amount, 9.53);
});

test('Orders API keeps the original charge while a 12x buyer-financed quote keeps the provider total', () => {
    const plans = [{ payment_method_id: 'master', issuer: { id: 12749 }, payer_costs: [
        { installments: 12, installment_rate: 22.11, installment_amount: '50.88', total_amount: '610.55' },
    ] }];
    const offer = installmentOffers(plans, defaults, 500)[0];
    assert.equal(offer.original_amount, 500);
    assert.equal(offer.buyer_total, 610.55);
    assert.equal(offer.buyer_interest_amount, 110.55);
    assert.equal(offer.installment_amount, 50.88);
    const order = { total: 500, order_number: 'MOCK', snapshot: { card_installment_offer: offer } };
    const resource = { mp_order_id: 'ORD', external_reference: 'MOCK', total_amount: '500.00', transaction_amount: '500.00', currency_id: 'BRL',
        payment_count: 1, mp_payment_id: 'PAY', order_status: 'processed', order_status_detail: 'accredited', transaction_status: 'processed',
        transaction_status_detail: 'accredited', mp_status: 'processed', mp_status_detail: 'accredited', payment_method_type: 'credit_card',
        payment_method_id: 'master', payment_installments: 12, payment_installment_amount: '50.88', payment_issuer_id: '12749' };
    assert.equal(verifyPaymentResourceForOrder(order, resource), resource);
});
test('tampered buyer totals, rates, counts, issuer, brand and policy versions are rejected', () => {
    const offers = installmentOffers(plans(), defaults, 120), offer = offers.at(-1);
    assert.deepEqual(confirmInstallmentOffer(offers, offer, 'master', 12749, 12), offer);
    for (const [key, value] of Object.entries({ buyer_total: 120, buyer_interest_rate: 0, installments: 6, issuer_id: 'other', payment_method_id: 'visa', policy_version: 'old' })) {
        assert.throws(() => confirmInstallmentOffer(offers, { ...offer, [key]: value }, 'master', 12749, 12), { status: 409 });
    }
});
test('configuration change invalidates the quote and approval scope; unknown provider fields fail closed', () => {
    const config = approved({ ...defaults, enabled: true });
    assert.notEqual(installmentVersion(config), installmentVersion({ ...config, min_installment_amount: 10 }));
    assert.equal(effectiveInstallmentPolicy({ ...config, max_installments: 11 }, 'Teste').max_installments, 1);
    for (const rate of [null, undefined, '', false, ' ']) { const p = plans(); p[0].payer_costs[0].installment_rate = rate;
        assert.equal(installmentOffers(p, defaults, 120).some(o => o.installments === 1), false); }
    assert.equal(installmentOffers([{ ...plans()[0], payment_type_id: 'debit_card' }], defaults, 120).length, 0);
});
test('invalid admin settings and incorrect commercial promises are refused', () => {
    for (const invalid of [{ max_installments: 13 }, { max_installments: 0 }, { min_installment_amount: 0.001 },
        { enabled: 'true' }, { interest_payer: 'arbitrary_rate' }, { commercial_message: '12x sem juros' }, { max_installments: 2, interest_free_installments: 3 }]) {
        assert.throws(() => installmentConfig({ ...defaults, ...invalid }), { status: 400 });
    }
});
test('processed card values must match the immutable offer while original amount remains unchanged', () => {
    const offer = installmentOffers(plans(), defaults, 120).at(-1);
    const order = { total: 120, order_number: 'MOCK', snapshot: { card_installment_offer: offer } };
    const resource = { mp_order_id: 'ORD', external_reference: 'MOCK', total_amount: '120.00', transaction_amount: '120.00', currency_id: 'BRL',
        payment_count: 1, mp_payment_id: 'PAY', order_status: 'processed', order_status_detail: 'accredited', transaction_status: 'processed',
        transaction_status_detail: 'accredited', mp_status: 'processed', mp_status_detail: 'accredited', payment_method_type: 'credit_card',
        payment_method_id: 'master', payment_installments: 12, payment_installment_amount: '12.00', payment_issuer_id: '12749' };
    assert.equal(verifyPaymentResourceForOrder(order, resource), resource);
    for (const [key, value] of Object.entries({ transaction_amount: '144.00', total_amount: '144.00', payment_installment_amount: '10.00', payment_installments: 6, payment_method_id: 'visa', payment_issuer_id: 'other' })) {
        assert.throws(() => verifyPaymentResourceForOrder(order, { ...resource, [key]: value }), { code: 'PAYMENT_MISMATCH' });
    }
});
test('native selector guard leaves SDK fields intact and filters only server-approved installment options', () => {
    let callback, listener, selected; const options = [1, 2, 6, 12].map(n => ({ value: String(n), textContent: `${n}x de R$10`, hidden: false, disabled: false }));
    const select = { options, value: '12', disabled: false }; let offers = [{ installments: 1 }, { installments: 12 }];
    const root = { querySelectorAll: () => [select], addEventListener: (_type, cb) => { listener = cb; }, removeEventListener: () => { listener = null; } };
    class Observer { constructor(cb) { callback = cb; } observe() {} disconnect() { callback = null; } }
    const guard = guardNativeInstallments(root, () => offers, n => { selected = n; }, Observer);
    assert.equal(selected, 12); assert.equal(options[1].hidden, true); assert.equal(options[2].disabled, true);
    offers = []; guard.refresh(); assert.equal(select.disabled, true); assert.equal(selected, null);
    offers = [{ installments: 1 }]; callback(); assert.equal(select.disabled, false); assert.equal(options[3].hidden, true);
    listener(); guard.dispose(); assert.equal(listener, null); assert.equal(callback, null);
});
