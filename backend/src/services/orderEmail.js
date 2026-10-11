import { Resend } from 'resend';
import { pool } from '../config/db.js';
import { validEmail } from '../lib/navigation.js';

export const EMAIL_EVENTS = {
    order_created: ['order_received', 'Pedido recebido'],
    payment_approved: ['payment_approved', 'Pagamento aprovado'],
    order_separation: ['order_separation', 'Pedido em separação'],
    order_shipped: ['order_shipped', 'Pedido enviado'],
    order_delivered: ['order_delivered', 'Pedido entregue'],
    order_cancelled: ['order_cancelled', 'Pedido cancelado'],
};

function failure(code) {
    return Object.assign(new Error('E-mail transacional indisponível; revise a configuração autorizada.'), { code, status: 503 });
}

function mailbox(value) {
    if (typeof value !== 'string' || /[\r\n\u0000]/.test(value)) return null;
    if (validEmail(value)) return { email: value, name: '' };
    const match = value.match(/^([^<>\r\n]*)<([^<>]+)>$/);
    return match && validEmail(match[2]) ? { name: match[1].trim(), email: match[2] } : null;
}

export function orderEmailConfig(settings = {}, env = process.env) {
    const emails = settings.emails || {}, general = settings.general || {};
    const existing = mailbox(env.EMAIL_FROM);
    const sender = emails.sender_email || existing?.email;
    const allowed = [...(env.EMAIL_ALLOWED_SENDERS || '').split(',').map(value => value.trim()), existing?.email].filter(validEmail).map(value => value.toLowerCase());
    const name = emails.sender_name || existing?.name || "D'Helenas";
    const replyTo = emails.reply_to || env.EMAIL_REPLY_TO || general.email;
    if (!validEmail(sender) || !allowed.includes(sender.toLowerCase()) || !validEmail(replyTo) ||
        typeof name !== 'string' || name.length > 100 || /[<>\r\n\u0000"]/.test(name)) throw failure('EMAIL_CONFIG_INVALID');
    return { from: `${name} <${sender}>`, replyTo };
}

export function orderEmailReadiness(settings = {}, env = process.env) {
    let senderReady = false;
    try { orderEmailConfig(settings, env); senderReady = true; } catch { /* Unconfigured, never expose values. */ }
    return { api_key_configured: !!env.RESEND_API_KEY, sender_and_reply_to_ready: senderReady, domain_verification: 'external_gate' };
}

export function escapeEmailHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function buildOrderEmail(order, recipient, event, config) {
    if (!validEmail(recipient) || !EMAIL_EVENTS[event]) throw failure('EMAIL_CONFIG_INVALID');
    const esc = escapeEmailHtml;
    const money = value => Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '0.00';
    const title = EMAIL_EVENTS[event][1];
    const items = (order.snapshot?.items || []).map(item => `<tr><td style="padding:12px 8px">${esc(item.product_name)}<br><small>${esc(item.color_name)} / ${esc(item.size)}</small></td><td style="padding:12px 8px;text-align:center">${esc(item.quantity)}</td><td style="padding:12px 8px;text-align:right">R$ ${money(item.subtotal)}</td></tr>`).join('');
    const addr = order.shipping_address || {};
    return {
        ...config, to: recipient, subject: `${title}: ${String(order.order_number || '').replace(/[\r\n]/g, '')}`,
        html: `<div style="font-family:'DM Sans',sans-serif;max-width:600px;margin:0 auto;color:#292526">
            <div style="padding:28px 24px;border-bottom:2px solid #a5925a"><h1 style="font-family:Georgia,serif;margin:0">D'Helenas</h1></div>
            <div style="padding:24px"><h2>${title}</h2><p>Pedido ${esc(order.order_number)}</p>
            <p><strong>Cliente:</strong> ${esc(order.user_name || '-')}</p>
            <table style="border-collapse:collapse;width:100%;border-bottom:1px solid #ddd"><thead><tr><th align="left">Peça</th><th>Qtd.</th><th align="right">Subtotal</th></tr></thead><tbody>${items}</tbody></table>
            <p>Subtotal: R$ ${money(order.subtotal)}<br>Desconto: R$ ${money(order.discount)}<br>Frete: R$ ${money(order.shipping_cost)}</p>
            <p style="font-size:20px"><strong>Total: R$ ${money(order.total)}</strong></p>
            <p><strong>Entrega:</strong> ${esc(addr.recipient || order.user_name || '-')}<br>${esc(addr.street || '')} ${esc(addr.number || '')} ${esc(addr.complement || '')}<br>${esc(addr.district || '')} / ${esc(addr.city || '')} ${esc(addr.state || '')}<br>${esc(addr.zip_code || '')}</p>
            <p><strong>Pagamento:</strong> ${esc(order.payment_method || '-')}<br><strong>Status:</strong> ${esc(order.status)}</p></div>
            <div style="padding:20px 24px;background:#eadfe3;font-size:12px">Moda que conecta histórias.</div></div>`,
        text: `${title}\nPedido ${order.order_number}\nTotal: R$ ${money(order.total)}\nStatus: ${order.status}`,
    };
}

export async function sendOrderEmail(order, recipient, event = 'order_created', { db = pool, send, env = process.env } = {}) {
    const { rows } = await db.query('SELECT key, value FROM settings WHERE key = ANY($1::text[])', [['emails', 'general']]);
    const settings = Object.fromEntries(rows.map(row => [row.key, row.value]));
    const config = orderEmailConfig(settings, env);
    if (!env.RESEND_API_KEY && !send) throw failure('EMAIL_CONFIG_INVALID');
    const payload = buildOrderEmail(order, recipient, event, config);
    try {
        const dispatch = send || (data => new Resend(env.RESEND_API_KEY).emails.send(data));
        const result = await dispatch(payload);
        if (result?.error || !result?.data?.id) throw failure('EMAIL_DELIVERY_FAILED');
        return { id: result.data.id };
    } catch { throw failure('EMAIL_DELIVERY_FAILED'); }
}
