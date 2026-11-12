const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export function parseOperationalStart(value) {
    const raw = value?.start_at;
    if (typeof raw !== 'string' || !ISO_UTC.test(raw) || !Number.isFinite(Date.parse(raw))
        || new Date(raw).toISOString() !== (raw.includes('.') ? raw : raw.replace('Z', '.000Z'))) {
        throw Object.assign(new Error('Início operacional inválido; indicadores indisponíveis.'), { status: 503 });
    }
    return new Date(raw);
}

const scopedOrders = `WITH scoped AS (
    SELECT o.id, o.user_id, o.created_at, o.paid_at, o.payment_status, o.status, o.total,
        COALESCE(r.refunded, 0) AS refunded
    FROM orders o
    LEFT JOIN LATERAL (
        SELECT SUM(amount) AS refunded FROM order_refunds
        WHERE order_id = o.id AND status = 'processed'
    ) r ON true
    WHERE o.created_at >= $1
)`;
const paid = `paid_at IS NOT NULL AND payment_status IN ('approved', 'partially_refunded', 'refunded')`;

export async function readLaunchSummary(db) {
    const { rows: settings } = await db.query("SELECT value FROM settings WHERE key = 'operational_start'");
    if (!settings.length) return { configured: false };
    const startAt = parseOperationalStart(settings[0].value);
    const params = [startAt];
    const totals = await db.query(`${scopedOrders} SELECT COUNT(*)::int AS orders,
            COUNT(*) FILTER (WHERE ${paid})::int AS paid_orders,
            COUNT(DISTINCT user_id) FILTER (WHERE ${paid})::int AS buyers,
            COALESCE(SUM(total) FILTER (WHERE ${paid}), 0) AS gross_paid,
            COALESCE(SUM(refunded) FILTER (WHERE ${paid}), 0) AS refunds,
            COUNT(*) FILTER (WHERE ${paid} AND refunded > total)::int AS refund_inconsistencies
            FROM scoped`, params);
    const daily = await db.query(`${scopedOrders}, paid_days AS (
            SELECT (paid_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
                SUM(total - refunded) AS revenue FROM scoped WHERE ${paid} GROUP BY day
        ) SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(p.revenue, 0) AS revenue
            FROM generate_series((now() AT TIME ZONE 'America/Sao_Paulo')::date - 6,
                (now() AT TIME ZONE 'America/Sao_Paulo')::date, interval '1 day') AS d(day)
            LEFT JOIN paid_days p ON p.day = d.day ORDER BY d.day`, params);
    const monthly = await db.query(`${scopedOrders} SELECT to_char(date_trunc('month', paid_at AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM') AS month,
            SUM(total - refunded) AS revenue FROM scoped WHERE ${paid}
            GROUP BY month ORDER BY month DESC LIMIT 6`, params);
    const statuses = await db.query(`${scopedOrders} SELECT status, COUNT(*)::int AS count FROM scoped GROUP BY status ORDER BY status`, params);
    const topProducts = await db.query(`SELECT oi.product_name AS name, SUM(oi.subtotal) AS gross_sales
            FROM order_items oi JOIN orders o ON o.id = oi.order_id
            WHERE o.created_at >= $1 AND o.paid_at IS NOT NULL
              AND o.payment_status IN ('approved','partially_refunded','refunded')
            GROUP BY oi.product_name ORDER BY gross_sales DESC LIMIT 5`, params);
    const recent = await db.query(`SELECT id, order_number, total, created_at, payment_status FROM orders
            WHERE created_at >= $1 ORDER BY created_at DESC LIMIT 5`, params);
    const stock = await db.query("SELECT COUNT(*)::int AS published FROM products WHERE status = 'published'");
    const row = totals.rows[0];
    const grossPaid = Number(row.gross_paid);
    const refundsValue = Number(row.refunds);
    return {
        configured: true, start_at: startAt.toISOString(),
        orders: row.orders, paid_orders: row.paid_orders, buyers: row.buyers,
        gross_paid: grossPaid, refunds: refundsValue,
        net_revenue: Math.round((grossPaid - refundsValue) * 100) / 100,
        average_paid_order: row.paid_orders ? Math.round(grossPaid * 100 / row.paid_orders) / 100 : 0,
        profit: row.paid_orders === 0 ? 0 : null,
        profit_note: 'Lucro líquido requer custos, tarifas e despesas conciliados; não representa saldos externos.',
        refund_inconsistencies: row.refund_inconsistencies,
        published_products: stock.rows[0].published,
        daily: daily.rows, monthly: monthly.rows.reverse(), statuses: statuses.rows,
        top_products: topProducts.rows, recent_orders: recent.rows,
    };
}
