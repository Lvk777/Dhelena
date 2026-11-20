export const LIGHT_CLOTHING_PRESET = Object.freeze({
    id: 'light-clothing',
    name: 'Padrão — roupas leves',
    package_height: 5,
    package_width: 25,
    package_length: 30,
    weight: 0.4,
});

export function packageMeasurementsError(values) {
    const height = Number(values.package_height), width = Number(values.package_width);
    const length = Number(values.package_length), weight = Number(values.weight);
    if ([height, width, length, weight].some(value => !Number.isFinite(value) || value <= 0)) {
        return 'Informe as medidas do pacote fechado em cm e o peso total em kg.';
    }
    if (height < 1 || width < 8 || length < 13 || Math.max(height, width, length) > 100
        || height + width + length > 200 || weight > 30) {
        return 'Para PAC/SEDEX, use no mínimo 1 × 8 × 13 cm, no máximo 100 cm por lado, 200 cm na soma e 30 kg.';
    }
    return null;
}

export function availablePackagePresets(configured) {
    const seen = new Set([LIGHT_CLOTHING_PRESET.id]);
    const extras = Array.isArray(configured) ? configured.filter(preset => {
        if (!preset || typeof preset.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(preset.id)
            || seen.has(preset.id) || typeof preset.name !== 'string' || !preset.name.trim()
            || preset.name.length > 80) return false;
        if (packageMeasurementsError(preset)) return false;
        seen.add(preset.id);
        return true;
    }) : [];
    return [LIGHT_CLOTHING_PRESET, ...extras];
}

export function applyPackagePreset(form, preset) {
    return {
        ...form,
        package_height: String(preset.package_height),
        package_width: String(preset.package_width),
        package_length: String(preset.package_length),
        weight: String(preset.weight),
    };
}
