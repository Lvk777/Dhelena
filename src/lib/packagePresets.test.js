import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_CLOTHING_PRESET, applyPackagePreset, availablePackagePresets, packageMeasurementsError } from './packagePresets.js';

test('the light-clothing preset is optional and never changes an existing product by loading', () => {
    const oldProduct = { id: 'legacy', weight: '0.3', package_height: '0.4', package_width: '8', package_length: '13' };
    const presets = availablePackagePresets();
    assert.deepEqual(oldProduct, { id: 'legacy', weight: '0.3', package_height: '0.4', package_width: '8', package_length: '13' });
    assert.equal(presets[0].name, 'Padrão — roupas leves');
    const selected = applyPackagePreset(oldProduct, LIGHT_CLOTHING_PRESET);
    assert.deepEqual([selected.package_length, selected.package_width, selected.package_height, selected.weight], ['30', '25', '5', '0.4']);
    assert.equal(selected.id, 'legacy');
    assert.equal(oldProduct.package_height, '0.4');
    selected.weight = '0.65';
    assert.equal(selected.weight, '0.65');
});

test('configured package types remain selectable without accepting invalid or duplicate values', () => {
    const configured = [
        { id: 'coat', name: 'Casaco dobrado', package_height: 12, package_width: 32, package_length: 40, weight: 0.9 },
        { id: 'coat', name: 'Duplicado', package_height: 12, package_width: 32, package_length: 40, weight: 0.9 },
        { id: 'tiny', name: 'Inválido', package_height: 0.4, package_width: 8, package_length: 13, weight: 0.3 },
    ];
    assert.deepEqual(availablePackagePresets(configured).map(preset => preset.id), ['light-clothing', 'coat']);
    assert.equal(packageMeasurementsError(configured[2]), 'Para PAC/SEDEX, use no mínimo 1 × 8 × 13 cm, no máximo 100 cm por lado, 200 cm na soma e 30 kg.');
    assert.equal(packageMeasurementsError({ package_height: 5, package_width: 25, package_length: 30, weight: 0.4 }), null);
});
