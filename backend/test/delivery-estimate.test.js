import test from 'node:test';
import assert from 'node:assert/strict';
import { withDeliveryEstimate } from '../src/lib/deliveryEstimate.js';
import { deliveryEstimateLabel } from '../../src/lib/deliveryEstimate.js';
import { selectedDelivery, selectedDeliveryCost, shippingContextKey } from '../../src/lib/shippingSelection.js';
import { validateSettingValue } from '../src/lib/publicSettings.js';

const approved = { SHIPPING_PREPARATION_ENABLED: 'true' };
test('unapproved preparation is neither advertised nor presented as total transit time', () => {
    for (const env of [{}, { SHIPPING_PREPARATION_ENABLED: 'false' }]) {
        const quote = withDeliveryEstimate({ delivery_time: 3 }, { melhor_envio_extra_days: 2 }, env);
        assert.equal(quote.delivery_estimate.total_business_days, null);
        assert.equal(quote.delivery_estimate.preparation_business_days, null);
        assert.match(deliveryEstimateLabel(quote), /Transporte: até 3 dias úteis/);
        assert.doesNotMatch(deliveryEstimateLabel(quote), /2 de preparação/);
    }
});
test('approved preparation and conservative carrier range add business days without inventing calendar dates', () => {
    const quote = withDeliveryEstimate({ price: 29.9, delivery_time: 3, delivery_time_min: 2, delivery_time_max: 5 }, {}, approved);
    assert.equal(quote.delivery_estimate.total_business_days, 7);
    assert.equal(quote.price, 29.9);
    assert.equal(quote.delivery_estimate.starts_at, 'payment_confirmation');
    assert.match(deliveryEstimateLabel(quote), /7 dias úteis após a confirmação do pagamento/);
    assert.equal(Object.keys(quote.delivery_estimate).some(key => key.includes('date')), false);
});
test('missing and invalid carrier durations never turn into zero-day transport promises', () => {
    for (const delivery_time of [undefined, null, '', -1, 1.5, 'bad', true, 999]) {
        const quote = withDeliveryEstimate({ delivery_time }, {}, approved);
        assert.equal(quote.delivery_estimate.total_business_days, null);
        assert.match(deliveryEstimateLabel(quote), /ainda não confirmado/);
    }
    assert.equal(withDeliveryEstimate({ delivery_time: 0 }, {}, approved).delivery_estimate.total_business_days, 2);
});
test('preparation validates integer durations and supports an explicitly approved zero', () => {
    assert.equal(withDeliveryEstimate({ delivery_time: '4' }, { melhor_envio_extra_days: 0 }, approved).delivery_estimate.total_business_days, 4);
    for (const value of [-1, 1.5, '2', 366]) assert.throws(() => validateSettingValue('shipping', { melhor_envio_extra_days: value }), { status: 400 });
    assert.doesNotThrow(() => validateSettingValue('shipping', { melhor_envio_extra_days: 2 }));
    assert.equal(withDeliveryEstimate({ delivery_time: 3 }, { melhor_envio_extra_days: -2 }, approved).delivery_estimate.total_business_days, null);
});
test('stale pickup selection is invalidated immediately when pickup is disabled', () => {
    const key = shippingContextKey('01001000', []);
    const pickup = { method: 'retirada', cost: 0 };
    assert.equal(selectedDelivery(pickup, key, false), null);
    assert.equal(selectedDeliveryCost(pickup, key, true, false), null);
});
