const LEGACY_SIZES = ['PP', 'P', 'M', 'G', 'GG'];

export function effectiveSizes(product) {
    return Array.isArray(product.sizes) && product.sizes.length ? product.sizes : ['Único'];
}

function invalidStock() {
    return Object.assign(new Error('Estoque de catálogo inválido'), { status: 500 });
}

export function stockKeys(product, color, size) {
    const sizes = effectiveSizes(product);
    if (!sizes.includes(size)) return [];
    const stock = color.stock || {};
    const keys = Object.keys(stock);
    const legacy = sizes.length === 1 && size === 'Único'
        && keys.some(key => LEGACY_SIZES.includes(key))
        && keys.every(key => key === size || LEGACY_SIZES.includes(key));
    return legacy ? [size, ...LEGACY_SIZES].filter(key => Object.hasOwn(stock, key)) : [size];
}

export function stockForSize(product, color, size) {
    const keys = stockKeys(product, color, size);
    if (!keys.length) return 0;
    return keys.reduce((total, key) => {
        const value = Number(color.stock?.[key] ?? 0);
        if (!Number.isSafeInteger(value) || value < 0) throw invalidStock();
        return total + value;
    }, 0);
}

// Called only while the product row is locked. Keep legacy keys intact so a
// customer's first purchase never performs an implicit catalog migration.
export function reserveVariantStock(product, color, size, quantity) {
    const previousStock = stockForSize(product, color, size);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > previousStock) {
        throw Object.assign(new Error('Estoque insuficiente'), { status: 409 });
    }
    let remaining = quantity;
    for (const key of stockKeys(product, color, size)) {
        const take = Math.min(remaining, Number(color.stock?.[key] ?? 0));
        color.stock[key] -= take;
        remaining -= take;
        if (!remaining) break;
    }
    return { previousStock, newStock: previousStock - quantity };
}

export function restoreVariantStock(product, color, size, quantity) {
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw invalidStock();
    if (!effectiveSizes(product).includes(size)) {
        throw Object.assign(new Error('Variação alterada; estoque exige reconciliação'), { status: 409 });
    }
    const previousStock = stockForSize(product, color, size);
    const key = stockKeys(product, color, size)[0] || size;
    color.stock ||= {};
    color.stock[key] = Number(color.stock[key] ?? 0) + quantity;
    return { previousStock, newStock: previousStock + quantity };
}
