import { pool } from './config/db.js';

// ─── Audit Log ─────────────────────────────────────────────────────
export async function logAudit(adminId, action, entityType, entityId, changes, ip) {
    await pool.query(
        `INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, changes, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [adminId, action, entityType, entityId, changes ? JSON.stringify(changes) : null, ip]
    );
}

// ─── Coupon Validation (server-side) ───────────────────────────────
export async function validateCoupon(code, userId, cartSubtotal, items) {
    const { rows } = await pool.query('SELECT * FROM coupons WHERE code = $1', [code.toUpperCase().trim()]);
    if (rows.length === 0) return { valid: false, error: 'Cupom não encontrado' };

    const c = rows[0];
    if (!c.active) return { valid: false, error: 'Cupom inativo' };

    const now = new Date();
    if (c.valid_from && now < new Date(c.valid_from)) return { valid: false, error: 'Cupom ainda não é válido' };
    if (c.valid_until && now > new Date(c.valid_until)) return { valid: false, error: 'Cupom expirado' };

    if (cartSubtotal < Number(c.min_order_value)) {
        return { valid: false, error: `Valor mínimo do pedido: R$ ${Number(c.min_order_value).toFixed(2)}` };
    }

    if (c.max_uses) {
        const { rows: usageCount } = await pool.query('SELECT COUNT(*) FROM coupon_usages WHERE coupon_id = $1', [c.id]);
        if (parseInt(usageCount[0].count) >= c.max_uses) return { valid: false, error: 'Cupom esgotado' };
    }

    if (c.max_uses_per_customer && userId) {
        const { rows: userUsage } = await pool.query('SELECT COUNT(*) FROM coupon_usages WHERE coupon_id = $1 AND user_id = $2', [c.id, userId]);
        if (parseInt(userUsage[0].count) >= c.max_uses_per_customer) return { valid: false, error: 'Você já usou este cupom' };
    }

    if (c.first_purchase_only && userId) {
        const { rows: prevOrders } = await pool.query('SELECT COUNT(*) FROM orders WHERE user_id = $1 AND status != $2', [userId, 'cancelado']);
        if (parseInt(prevOrders[0].count) > 0) return { valid: false, error: 'Cupom válido apenas para primeira compra' };
    }

    let discount = 0;
    if (c.discount_type === 'percentage') {
        discount = (cartSubtotal * Number(c.discount_value)) / 100;
    } else {
        discount = Number(c.discount_value);
    }
    discount = Math.min(discount, cartSubtotal);

    return {
        valid: true,
        code: c.code,
        discount_type: c.discount_type,
        discount_value: Number(c.discount_value),
        discount,
    };
}

// ─── Stock Adjust (admin manual) ───────────────────────────────────
export async function adjustStock(client, productId, colorId, size, newStock, reason, adminId, orderId = null, type = 'adjust') {
    const { rows: prodRows } = await client.query('SELECT colors FROM products WHERE id = $1 FOR UPDATE', [productId]);
    if (prodRows.length === 0) throw Object.assign(new Error('Produto não encontrado'), { status: 404 });

    const colors = prodRows[0].colors || [];
    const colorIdx = colors.findIndex(c => c.id === colorId);
    if (colorIdx === -1) throw Object.assign(new Error('Cor não encontrada'), { status: 404 });

    const previousStock = colors[colorIdx].stock?.[size] ?? 0;
    const delta = newStock - previousStock;

    if (!colors[colorIdx].stock) colors[colorIdx].stock = {};
    colors[colorIdx].stock[size] = newStock;

    await client.query('UPDATE products SET colors = $1, updated_date = now() WHERE id = $2', [JSON.stringify(colors), productId]);

    await client.query(
        `INSERT INTO stock_movements (product_id, order_id, type, quantity, color_id, size, previous_stock, new_stock, reason, admin_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [productId, orderId, type, delta, colorId, size, previousStock, newStock, reason, adminId]
    );

    return { previousStock, newStock, delta };
}

// ─── Notifications (async, never blocks order) ──────────────────────
export async function sendOrderNotifications(orderId, event) {
    try {
        const { rows: orderRows } = await pool.query(
            `SELECT o.*, u.email as user_email, u.full_name as user_name, u.phone as user_phone
             FROM orders o JOIN profiles u ON o.user_id = u.id WHERE o.id = $1`,
            [orderId]
        );
        if (orderRows.length === 0) return;
        const order = orderRows[0];

        const { rows: settingRows } = await pool.query("SELECT value FROM settings WHERE key = 'notifications'");
        const notifSettings = settingRows[0]?.value || { recipients: [] };
        const recipients = notifSettings.recipients || [];

        for (const r of recipients) {
            if (!r.active) continue;

            const events = r.events || ['order_created', 'payment_approved'];
            if (!events.includes(event)) continue;

            // Email
            if (r.email && notifSettings.email_enabled !== false) {
                await tryNotify(orderId, event, 'email', r.email, () => sendOrderEmail(order, r.email));
            }

            // WhatsApp
            if (r.whatsapp && notifSettings.whatsapp_enabled !== false) {
                await tryNotify(orderId, event, 'whatsapp', r.whatsapp, () => sendOrderWhatsApp(order, r.whatsapp));
            }
        }
    } catch (err) {
        console.error('[Notifications] Error:', err.message);
    }
}

async function tryNotify(orderId, event, channel, recipient, sender) {
    try {
        const { rows: existing } = await pool.query(
            `SELECT * FROM notification_logs WHERE order_id = $1 AND event = $2 AND channel = $3 AND recipient = $4 AND status = 'sent'`,
            [orderId, event, channel, recipient]
        );
        if (existing.length > 0) return;

        const { rows: logRows } = await pool.query(
            `INSERT INTO notification_logs (order_id, event, channel, recipient, status, attempts)
             VALUES ($1, $2, $3, $4, 'retrying', 1)
             ON CONFLICT (order_id, event, channel, recipient)
             DO UPDATE SET attempts = notification_logs.attempts + 1
             RETURNING *`,
            [orderId, event, channel, recipient]
        );

        await sender();

        await pool.query(
            `UPDATE notification_logs SET status = 'sent', sent_at = now() WHERE id = $1`,
            [logRows[0].id]
        );
    } catch (err) {
        await pool.query(
            `UPDATE notification_logs SET status = 'failed', error = $2
             WHERE order_id = $1 AND event = $3 AND channel = $4 AND recipient = $5`,
            [orderId, err.message, event, channel, recipient]
        ).catch(() => {});
        console.error(`[Notify] ${channel} to ${recipient} failed:`, err.message);
    }
}

// ─── Email notification (Resend) ───────────────────────────────────
async function sendOrderEmail(order, recipient) {
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY não configurado');

    const { default: Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    const items = order.snapshot?.items || [];
    const addr = order.shipping_address || {};
    const itemsHtml = items.map(i =>
        `<tr><td style="padding:4px 8px">${i.product_name}</td><td style="padding:4px 8px">${i.color_name || '-'}</td><td style="padding:4px 8px">${i.size || '-'}</td><td style="padding:4px 8px;text-align:center">${i.quantity}</td><td style="padding:4px 8px;text-align:right">R$ ${Number(i.subtotal).toFixed(2)}</td></tr>`
    ).join('');

    const { data, error } = await resend.emails.send({
        from: process.env.EMAIL_FROM || "D'Helenas <noreply@dhelenas.com.br>",
        to: recipient,
        subject: `Novo pedido ${order.order_number}`,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
                <h2 style="color:#2d2926">Novo pedido: ${order.order_number}</h2>
                <p><strong>Cliente:</strong> ${order.user_name || '-'}</p>
                <p><strong>Telefone:</strong> ${order.user_phone || '-'}</p>
                <table border="1" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%">
                    <tr style="background:#f5f5f5"><th style="padding:4px 8px;text-align:left">Produto</th><th style="padding:4px 8px">Cor</th><th style="padding:4px 8px">Tam</th><th style="padding:4px 8px">Qtd</th><th style="padding:4px 8px;text-align:right">Subtotal</th></tr>
                    ${itemsHtml}
                </table>
                <p style="margin-top:12px"><strong>Subtotal:</strong> R$ ${Number(order.subtotal).toFixed(2)}</p>
                <p><strong>Desconto:</strong> R$ ${Number(order.discount).toFixed(2)}</p>
                <p><strong>Frete:</strong> R$ ${Number(order.shipping_cost).toFixed(2)} (${order.shipping_method || '-'})</p>
                <p style="font-size:18px"><strong>Total:</strong> R$ ${Number(order.total).toFixed(2)}</p>
                <hr>
                <p><strong>Entrega:</strong> ${addr.recipient || order.user_name || '-'}</p>
                <p>${addr.street || '-'}, ${addr.number || '-'} ${addr.complement || ''}</p>
                <p>${addr.district || '-'} — ${addr.city || '-'}/${addr.state || '-'}</p>
                <p>CEP: ${addr.zip_code || '-'}</p>
                <hr>
                <p><strong>Pagamento:</strong> ${order.payment_method || '-'}</p>
                <p><strong>Status:</strong> ${order.status}</p>
                <p><strong>Idempotência:</strong> ${order.idempotency_key || 'N/A'}</p>
            </div>
        `,
    });

    if (error) throw new Error(error.message);
    return data;
}

// ─── WhatsApp notification (Cloud API) ────────────────────────────
async function sendOrderWhatsApp(order, recipient) {
    if (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
        throw new Error('WhatsApp não configurado');
    }

    const phone = recipient.replace(/\D/g, '');
    const items = order.snapshot?.items || [];
    const itemsText = items.map(i => `• ${i.quantity}x ${i.product_name} (${i.color_name || '-'}, ${i.size || '-'}) — R$ ${Number(i.subtotal).toFixed(2)}`).join('\n');

    const message = `*Novo pedido ${order.order_number}*\n\n*Cliente:* ${order.user_name || '-'}\n*Telefone:* ${order.user_phone || '-'}\n\n*Itens:*\n${itemsText}\n\n*Subtotal:* R$ ${Number(order.subtotal).toFixed(2)}\n*Desconto:* R$ ${Number(order.discount).toFixed(2)}\n*Frete:* R$ ${Number(order.shipping_cost).toFixed(2)}\n*Total:* R$ ${Number(order.total).toFixed(2)}\n\n*Pagamento:* ${order.payment_method || '-'}\n*Status:* ${order.status}`;

    const response = await fetch(
        `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: phone,
                type: 'text',
                text: { body: message },
            }),
        }
    );

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `WhatsApp API error: ${response.status}`);
    }

    return response.json();
}
