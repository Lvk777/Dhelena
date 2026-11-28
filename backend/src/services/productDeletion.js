import { withTransaction } from '../config/db.js';

const labels = {
    order_items: 'itens de pedidos',
    stock_reservations: 'reservas de estoque',
    stock_movements: 'movimentações de estoque',
    favorites: 'favoritos',
    analytics_events: 'eventos de análise',
    look_promotions: 'promoções',
};

const identifier = value => `"${value.replaceAll('"', '""')}"`;
const blocked = reason => Object.assign(new Error(`Produto não pode ser excluído: ${reason}.`), { status: 409 });

function assertNoInventory(product) {
    if (!Array.isArray(product.colors)) throw blocked('estoque precisa de conferência');
    for (const color of product.colors) {
        const stock = color?.stock ?? {};
        if (!color || typeof color !== 'object' || typeof stock !== 'object'
            || Array.isArray(stock)) throw blocked('estoque precisa de conferência');
        for (const value of Object.values(stock)) {
            const quantity = Number(value);
            if (!Number.isSafeInteger(quantity) || quantity < 0) throw blocked('estoque precisa de conferência');
            if (quantity > 0) throw blocked('há unidades em estoque');
        }
    }
    const sold = Number(product.sold_count);
    if (!Number.isSafeInteger(sold) || sold < 0) throw blocked('contagem de vendas precisa de conferência');
    if (sold > 0) throw blocked('há contagem legada de vendas');
}

async function referencedColumns(client) {
    const { rows: foreignKeys } = await client.query(`
        SELECT n.nspname AS schema_name, t.relname AS table_name,
               a.attname AS column_name, array_length(fk.conkey, 1) AS key_count
        FROM pg_constraint fk
        JOIN pg_class t ON t.oid = fk.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN LATERAL unnest(fk.conkey) AS key(attnum) ON true
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = key.attnum
        WHERE fk.contype = 'f' AND fk.confrelid = 'public.products'::regclass`);
    if (foreignKeys.some(key => key.key_count !== 1)) throw blocked('existe vínculo composto que exige conferência');
    const { rows: productColumns } = await client.query(`
        SELECT c.table_schema AS schema_name, c.table_name, c.column_name
        FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public' AND c.column_name = 'product_id'
          AND c.data_type = 'uuid' AND t.table_type = 'BASE TABLE'`);
    const keys = new Map();
    for (const key of [...foreignKeys, ...productColumns]) {
        if (key.schema_name !== 'public') throw blocked('existe vínculo fora do esquema público');
        keys.set(`${key.schema_name}.${key.table_name}.${key.column_name}`, key);
    }
    return { keys: [...keys.values()], foreignKeys: new Set(foreignKeys.map(key =>
        `${key.schema_name}.${key.table_name}.${key.column_name}`)) };
}

export async function deleteProductPermanently(productId, adminId, ip, transaction = withTransaction) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId)) {
        throw Object.assign(new Error('ID de produto inválido'), { status: 400 });
    }
    return transaction(async client => {
        const { rows } = await client.query('SELECT id, name, sku, status, colors, sold_count FROM public.products WHERE id = $1 FOR UPDATE', [productId]);
        const product = rows[0];
        if (!product) return null;

        const { keys, foreignKeys } = await referencedColumns(client);
        // A product row lock serializes foreign-key inserts. Tables with an unbound
        // product_id must be locked against concurrent inserts before checking them.
        for (const key of keys) {
            const relation = `${identifier(key.schema_name)}.${identifier(key.table_name)}`;
            if (!foreignKeys.has(`${key.schema_name}.${key.table_name}.${key.column_name}`)) {
                await client.query(`LOCK TABLE ${relation} IN SHARE MODE`);
            }
            const found = await client.query(`SELECT 1 FROM ${relation} WHERE ${identifier(key.column_name)} = $1 LIMIT 1`, [productId]);
            if (found.rows.length) throw blocked(`há ${labels[key.table_name] || `registros em ${key.table_name}`} vinculados`);
        }
        // These references have no FK to products. Preserve them rather than
        // leaving a promotion or a historical order pointing at a deleted SKU.
        await client.query('LOCK TABLE public.order_items, public.look_promotions IN SHARE MODE');
        if (product.sku) {
            const bySku = await client.query('SELECT 1 FROM public.order_items WHERE product_sku = $1 LIMIT 1', [product.sku]);
            if (bySku.rows.length) throw blocked('há itens de pedidos com este SKU');
        }
        const promotion = await client.query("SELECT 1 FROM public.look_promotions WHERE eligible_products::text LIKE '%' || $1::text || '%' LIMIT 1", [productId]);
        if (promotion.rows.length) throw blocked('há promoções vinculadas');
        assertNoInventory(product);

        const deleted = await client.query('DELETE FROM public.products WHERE id = $1 RETURNING id, name, sku', [productId]);
        if (deleted.rows.length !== 1) throw blocked('o produto mudou durante a operação');
        await client.query(`INSERT INTO public.audit_logs (admin_id, action, entity_type, entity_id, changes, ip_address)
            VALUES ($1, 'product.delete', 'product', $2, $3, $4)`,
        [adminId, productId, JSON.stringify({ name: product.name, sku: product.sku, previous_status: product.status }), ip]);
        return deleted.rows[0];
    });
}
