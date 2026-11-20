const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function fiscalMappingKey(issuerCnpj, item) {
    const issuer = String(issuerCnpj ?? '').replace(/\D/g, '');
    const code = String(item?.code ?? '').trim();
    const description = normalize(item?.name);
    return issuer.length === 14 && code && description ? { issuer, code, description } : null;
}

export function orderVariantIdentity(row) {
    const productId = String(row?.product_id ?? '');
    const colorId = String(row?.color_id ?? '');
    const size = normalize(row?.size);
    return productId && colorId && size ? { productId, colorId, size } : null;
}

const sameKey = (entry, key) => entry?.issuer_cnpj === key.issuer
    && entry?.fiscal_code === key.code && entry?.fiscal_description === key.description;
const sameVariant = (entry, variant) => entry?.product_id === variant.productId
    && entry?.color_id === variant.colorId && entry?.size === variant.size;

export function reusableMappingDecision(rows, key, variant) {
    if (!key || !variant) return 'unavailable';
    const existing = rows.filter(row => sameKey(row.changes, key));
    if (!existing.length) return 'new';
    return existing.every(row => sameVariant(row.changes, variant)) ? 'existing' : 'conflict';
}

export function resolveReusableMappings(nfe, orderItems, rows) {
    const productMatches = [], mappingAuditIds = [];
    for (const [fiscalIndex, item] of nfe.items.entries()) {
        const key = fiscalMappingKey(nfe.issuerCnpj, item);
        if (!key || nfe.items.filter(other => {
            const otherKey = fiscalMappingKey(nfe.issuerCnpj, other);
            return otherKey && sameKey({ issuer_cnpj: otherKey.issuer,
                fiscal_code: otherKey.code, fiscal_description: otherKey.description }, key);
        }).length !== 1) continue;
        const applicable = rows.filter(row => sameKey(row.changes, key));
        if (!applicable.length) continue;
        const variants = new Set(applicable.map(row => JSON.stringify({ productId: row.changes.product_id,
            colorId: row.changes.color_id, size: row.changes.size })));
        if (variants.size !== 1) continue;
        const matchingRows = orderItems.filter(row => {
            const variant = orderVariantIdentity(row);
            return variant && applicable.every(saved => sameVariant(saved.changes, variant)
                && (!saved.changes.order_color || saved.changes.order_color === row.color_name)
                && (!saved.changes.order_product_name || saved.changes.order_product_name === row.product_name));
        });
        if (matchingRows.length !== 1) continue;
        const row = matchingRows[0];
        if (Number(row.quantity) !== item.quantity
            || Math.round(Number(row.subtotal) * 100) !== item.productCents) continue;
        productMatches.push({ orderItemId: row.id, fiscalIndex });
        mappingAuditIds.push(applicable[0].id);
    }
    const rowIds = productMatches.map(match => match.orderItemId);
    return rowIds.length === new Set(rowIds).size ? { productMatches, mappingAuditIds }
        : { productMatches: [], mappingAuditIds: [] };
}

export async function loadReusableMappings(client, nfe) {
    const codes = [...new Set(nfe.items.map(item => String(item.code ?? '').trim()).filter(Boolean))];
    if (!codes.length) return [];
    const { rows } = await client.query(`SELECT id,changes FROM audit_logs
        WHERE action='fiscal.product_mapping_saved' AND changes->>'issuer_cnpj'=$1
        AND changes->>'fiscal_code'=ANY($2::text[]) ORDER BY created_at,id`,
    [nfe.issuerCnpj, codes]);
    return rows;
}
