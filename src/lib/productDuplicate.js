const fields = [
    'category', 'subcategory', 'collection', 'description',
    'short_description', 'details', 'price', 'sale_price', 'cost_price',
    'installments', 'images', 'colors', 'sizes', 'badges', 'composition',
    'modeling', 'length', 'lining', 'transparency', 'elasticity', 'care',
    'measurements', 'weight', 'package_height', 'package_width',
    'package_length', 'size_guide_id', 'custom_measurements',
];

export function canDuplicateProduct(product) {
    return !!product && product.status !== 'archived' && Number(product.sold_count || 0) === 0;
}

export function productDuplicateDraft(product) {
    if (!canDuplicateProduct(product)) throw new Error('Produto histórico não pode ser duplicado. Cadastre uma nova peça.');
    const data = Object.fromEntries(fields.filter(field => product[field] !== undefined).map(field => [field, product[field]]));
    return {
        ...data,
        colors: Array.isArray(product.colors) ? product.colors.map(color => ({
            ...color,
            stock: Object.fromEntries(Object.keys(color.stock || {}).map(size => [size, 0])),
        })) : [],
        name: `${product.name} (cópia)`,
        sku: '',
        status: 'draft',
    };
}
