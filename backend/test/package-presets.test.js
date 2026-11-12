import test from 'node:test';
import assert from 'node:assert/strict';
import { publicSetting, validateSettingValue } from '../src/lib/publicSettings.js';
import { validateProductForPublication } from '../src/routes/catalog.js';

const preset = { id: 'coat', name: 'Casaco dobrado', package_height: 12,
    package_width: 32, package_length: 40, weight: 0.9 };

test('admins can save measured package types while public settings omit them', () => {
    assert.doesNotThrow(() => validateSettingValue('shipping', { pickup_enabled: false, package_presets: [preset] }));
    const publicRow = publicSetting({ id: 'fixture', key: 'shipping', is_public: true,
        value: { pickup_enabled: false, package_presets: [preset] } });
    assert.equal(Object.hasOwn(publicRow.value, 'package_presets'), false);
});

test('package types cannot bypass parcel limits or overwrite the built-in choice', () => {
    assert.throws(() => validateSettingValue('shipping', { package_presets: [{ ...preset, package_height: 0.4 }] }), /limites PAC\/SEDEX/);
    assert.throws(() => validateSettingValue('shipping', { package_presets: [preset, preset] }), /Identificação/);
    assert.throws(() => validateSettingValue('shipping', { package_presets: [{ ...preset, id: 'light-clothing' }] }), /Identificação/);
    assert.throws(() => validateSettingValue('shipping', { package_presets: [{ ...preset, weight: '0.9' }] }), /Medidas/);
});

test('publishing still rejects the old sub-centimeter SEDEX package', () => {
    const product = { status: 'published', price: 30, weight: 0.4, package_height: 0.4,
        package_width: 25, package_length: 30, sizes: ['P'],
        colors: [{ id: 'beige', name: 'Bege', stock: { P: 1 } }] };
    assert.throws(() => validateProductForPublication(product), /limites PAC\/SEDEX/);
    assert.doesNotThrow(() => validateProductForPublication({ ...product, package_height: 5 }));
});
