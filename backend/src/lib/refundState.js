// Existing deployments may receive a webhook before migration 011 is applied.
// In that case no refund could have been reserved through this code yet.
export async function refundInFlight(client, orderId) {
    const schema = await client.query("SELECT to_regclass('public.order_refunds') AS relation");
    if (!schema.rows[0]?.relation) return false;
    const { rows } = await client.query(
        `SELECT 1 FROM order_refunds WHERE order_id = $1
         AND status IN ('reserved', 'processing', 'reconciliation_required') LIMIT 1`, [orderId]);
    return rows.length > 0;
}
