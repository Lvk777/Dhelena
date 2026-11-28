// Run only from a reviewed, one-off operations script. No HTTP route imports this.
const requiredChildren = new Set([
    'coupon_usages', 'notification_logs', 'order_events', 'order_items',
    'order_refunds', 'order_returns', 'stock_movements', 'stock_reservations', 'stock_restorations',
]);
const forbiddenChildren = [...requiredChildren].filter(table => !['order_events', 'order_items'].includes(table));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = reason => { throw new Error(`Limpeza abortada: ${reason}`); };
const sorted = values => [...values].sort();
const sameIds = (actual, expected) => JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected));

async function protectedSnapshot(client, numbers) {
    const { rows: orders } = await client.query('SELECT * FROM orders WHERE order_number = ANY($1::text[]) ORDER BY id', [numbers]);
    if (orders.length !== numbers.length) fail('pedido protegido ausente');
    const ids = orders.map(order => order.id);
    const children = {};
    for (const table of ['order_items', 'order_events', 'stock_reservations', 'stock_movements',
        'stock_restorations', 'order_refunds', 'order_returns', 'notification_logs', 'coupon_usages']) {
        const orderColumn = table === 'stock_reservations' ? 'order_item_id' : 'id';
        const { rows } = await client.query(`SELECT * FROM ${table} WHERE order_id = ANY($1::uuid[]) ORDER BY ${orderColumn}`, [ids]);
        children[table] = rows;
    }
    const { rows: audit } = await client.query('SELECT * FROM audit_logs WHERE entity_id = ANY($1::text[]) ORDER BY id',
        [[...ids.map(String), ...numbers]]);
    return JSON.stringify({ orders, children, audit });
}

export async function cleanUnpaidTestOrders(client, manifest, { apply = false } = {}) {
    const targets = manifest?.orders;
    if (!Array.isArray(targets) || targets.length === 0 || !Array.isArray(manifest.itemIds)
        || !Array.isArray(manifest.eventIds) || !Array.isArray(manifest.protectedNumbers)) fail('manifesto incompleto');
    const ids = targets.map(target => target.id);
    const numbers = targets.map(target => target.number);
    if (new Set(ids).size !== ids.length || new Set(numbers).size !== numbers.length
        || !ids.every(id => uuid.test(id)) || !numbers.every(number => /^DH-\d{4}-\d{6}$/.test(number))
        || !manifest.itemIds.every(id => uuid.test(id)) || !manifest.eventIds.every(id => uuid.test(id))
        || new Set(manifest.itemIds).size !== manifest.itemIds.length
        || new Set(manifest.eventIds).size !== manifest.eventIds.length
        || new Set(manifest.protectedNumbers).size !== manifest.protectedNumbers.length
        || manifest.protectedNumbers.some(number => numbers.includes(number))
        || !manifest.protectedNumbers.includes('DH-2026-000019')) fail('identificadores ou proteção inválidos');

    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try {
        const { rows: maintenance } = await client.query("SELECT value FROM settings WHERE key='maintenance'");
        if (maintenance[0]?.value?.maintenance_mode !== true) fail('manutenção deve estar ON');
        const { rows: referenceTables } = await client.query(`
            SELECT table_name FROM information_schema.columns
            WHERE table_schema='public' AND column_name='order_id' AND data_type='uuid' ORDER BY table_name`);
        if (!sameIds(referenceTables.map(row => row.table_name), [...requiredChildren])) {
            fail('dependências de pedido mudaram');
        }
        const protectedBefore = await protectedSnapshot(client, manifest.protectedNumbers);
        const { rows: orders } = await client.query('SELECT * FROM orders WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [ids]);
        if (orders.length !== targets.length || orders.some(order =>
            !targets.some(target => target.id === order.id && target.number === order.order_number)
            || !['recebido', 'cancelado'].includes(order.status)
            || order.payment_status !== 'pending' || order.paid_at || order.payment_attempt_started_at
            || order.payment_updated_at || order.payment_provider || order.mercado_pago_order_id
            || order.mercado_pago_payment_id || order.mercado_pago_external_reference
            || order.mercado_pago_status || order.mercado_pago_status_detail
            || order.melhor_envio_shipment_id || order.shipping_status
            || order.tracking_code || order.snapshot?.payment_context || order.snapshot?.shipping_operation
            || order.pix_qr_code || order.pix_qr_code_base64)) fail('pedido mudou ou tem vínculo financeiro/operacional');

        for (const table of forbiddenChildren) {
            const { rows } = await client.query(`SELECT 1 FROM ${table} WHERE order_id = ANY($1::uuid[]) LIMIT 1`, [ids]);
            if (rows.length) fail(`há registros em ${table}`);
        }
        const { rows: webhook } = await client.query(`SELECT 1 FROM webhook_events
            WHERE EXISTS (SELECT 1 FROM unnest($1::text[]) AS n(number)
                WHERE payload::text LIKE '%' || n.number || '%') LIMIT 1`, [numbers]);
        if (webhook.length) fail('há webhook relacionado');
        const { rows: items } = await client.query('SELECT id FROM order_items WHERE order_id = ANY($1::uuid[]) ORDER BY id', [ids]);
        const { rows: events } = await client.query('SELECT id FROM order_events WHERE order_id = ANY($1::uuid[]) ORDER BY id', [ids]);
        if (!sameIds(items.map(row => row.id), manifest.itemIds)
            || !sameIds(events.map(row => row.id), manifest.eventIds)) fail('itens ou eventos mudaram');
        const auditBefore = await client.query('SELECT count(*) AS n FROM audit_logs WHERE entity_id = ANY($1::text[])',
            [[...ids, ...numbers]]);

        for (const [table, expected] of [['order_events', manifest.eventIds], ['order_items', manifest.itemIds], ['orders', ids]]) {
            const column = table === 'orders' ? 'id' : 'order_id';
            const { rows } = await client.query(`DELETE FROM ${table} WHERE ${column} = ANY($1::uuid[]) RETURNING id`, [ids]);
            if (!sameIds(rows.map(row => row.id), expected)) fail(`exclusão divergente em ${table}`);
        }
        if (await protectedSnapshot(client, manifest.protectedNumbers) !== protectedBefore) fail('pedido protegido mudou');
        const auditAfter = await client.query('SELECT count(*) AS n FROM audit_logs WHERE entity_id = ANY($1::text[])',
            [[...ids, ...numbers]]);
        if (auditAfter.rows[0].n !== auditBefore.rows[0].n) fail('auditoria mudou');
        await client.query(apply ? 'COMMIT' : 'ROLLBACK');
        return { applied: apply, orders: ids.length, items: items.length, events: events.length,
            auditPreserved: Number(auditAfter.rows[0].n) };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    }
}
