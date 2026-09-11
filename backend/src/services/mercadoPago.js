/**
 * Mercado Pago Service — Checkout Transparente via Orders API
 * Uses MERCADO_PAGO_ACCESS_TOKEN (server-side only — NEVER exposed to frontend)
 * Uses MERCADO_PAGO_PUBLIC_KEY (frontend only — for Card Brick tokenization)
 */

import crypto from 'crypto';

const BASE_URL = 'https://api.mercadopago.com';

function getAccessToken() {
    const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    if (!token) throw Object.assign(new Error('MERCADO_PAGO_ACCESS_TOKEN não configurado'), { status: 500 });
    return token;
}

function isTestEnvironment() {
    const token = process.env.MERCADO_PAGO_ACCESS_TOKEN || '';
    // Test tokens start with TEST-
    return token.startsWith('TEST-');
}

async function mpFetch(path, options = {}) {
    const token = getAccessToken();
    const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
    const res = await fetch(url, {
        ...options,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': options.idempotencyKey || crypto.randomUUID(),
            ...(options.headers || {}),
        },
    });
    const data = await res.json();
    if (!res.ok) {
        const msg = data.message || data.error || `Mercado Pago API error (${res.status})`;
        throw Object.assign(new Error(msg), { status: res.status, mpError: data });
    }
    return data;
}

// ─── Test connection ──────────────────────────────────────────
export async function testConnection() {
    try {
        const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;
        if (!token) return { connected: false, error: 'Access Token não configurado' };

        const data = await mpFetch('/users/me');
        return {
            connected: true,
            environment: isTestEnvironment() ? 'Teste' : 'Produção',
            user_id: data.id,
            country: data.country_id,
        };
    } catch (err) {
        return { connected: false, error: err.message };
    }
}

// ─── List available payment methods ───────────────────────────
export async function getPaymentMethods() {
    const data = await mpFetch('/v1/payment_methods');
    return data
        .filter(m => m.status === 'active')
        .map(m => ({
            id: m.id,
            name: m.name,
            payment_type_id: m.payment_type_id,  // credit_card, debit_card, bank_transfer, etc
            thumbnail: m.thumbnail,
            max_allowed_amount: m.max_allowed_amount,
            min_allowed_amount: m.min_allowed_amount,
            max_installments: m.max_allowed_installments || 1,
            accreditation_days: m.accreditation_days || 0,
        }));
}

// ─── Get available payment types (pix, credit_card, debit_card, etc) ───
export async function getAvailablePaymentTypes() {
    const methods = await getPaymentMethods();
    const types = new Set(methods.map(m => m.payment_type_id));
    return {
        pix: types.has('bank_transfer') || methods.some(m => m.id === 'pix'),
        credit_card: types.has('credit_card'),
        debit_card: types.has('debit_card'),
        boleto: types.has('ticket'),
    };
}

// ─── Create Pix payment via Orders API ─────────────────────────
export async function createPixPayment({ orderId, orderNumber, total, payer, idempotencyKey }) {
    const body = {
        type: 'online',
        external_reference: orderNumber,
        total_amount: String(Number(total).toFixed(2)),
        transactions: {
            payments: [{
                amount: String(Number(total).toFixed(2)),
                payment_method: {
                    id: 'pix',
                    type: 'bank_transfer',
                },
            }],
        },
        payer: {
            email: payer.email,
            first_name: payer.first_name,
            last_name: payer.last_name,
            identification: payer.identification,
        },
        description: `Pedido ${orderNumber}`,
    };

    const data = await mpFetch('/v1/orders', {
        method: 'POST',
        body: JSON.stringify(body),
        idempotencyKey: idempotencyKey || `pix-${orderNumber}`,
    });

    // Extract Pix data from response
    const payment = data.transactions?.payments?.[0] || {};
    const pixData = payment.point_of_interaction?.transaction_data || {};

    return {
        mp_order_id: data.id,
        mp_payment_id: payment.id,
        mp_status: payment.status,
        mp_status_detail: payment.status_detail,
        external_reference: data.external_reference,
        pix_qr_code: pixData.qr_code || null,
        pix_qr_code_base64: pixData.qr_code_base64 || null,
        pix_expiration_at: pixData.expiration_date || null,
    };
}

// ─── Create card payment via Orders API ───────────────────────
export async function createCardPayment({ orderId, orderNumber, total, payer, cardToken, installments, paymentMethodId, issuerId, idempotencyKey }) {
    const body = {
        type: 'online',
        external_reference: orderNumber,
        total_amount: String(Number(total).toFixed(2)),
        transactions: {
            payments: [{
                amount: String(Number(total).toFixed(2)),
                payment_method: {
                    id: paymentMethodId,
                    type: 'credit_card',
                    token: cardToken,
                    installments: parseInt(installments) || 1,
                    issuer_id: issuerId ? String(issuerId) : undefined,
                },
            }],
        },
        payer: {
            email: payer.email,
            first_name: payer.first_name,
            last_name: payer.last_name,
            identification: payer.identification,
        },
        description: `Pedido ${orderNumber}`,
    };

    const data = await mpFetch('/v1/orders', {
        method: 'POST',
        body: JSON.stringify(body),
        idempotencyKey: idempotencyKey || `card-${orderNumber}`,
    });

    const payment = data.transactions?.payments?.[0] || {};

    return {
        mp_order_id: data.id,
        mp_payment_id: payment.id,
        mp_status: payment.status,
        mp_status_detail: payment.status_detail,
        external_reference: data.external_reference,
        installments: payment.installments || installments,
    };
}

// ─── Get payment/order status from MP ─────────────────────────
export async function getOrderStatus(mpOrderId) {
    const data = await mpFetch(`/v1/orders/${mpOrderId}`);
    const payment = data.transactions?.payments?.[0] || {};
    return {
        mp_status: payment.status,
        mp_status_detail: payment.status_detail,
        mp_payment_id: payment.id,
        total_amount: data.total_amount,
        external_reference: data.external_reference,
    };
}

export async function getPaymentStatus(mpPaymentId) {
    const data = await mpFetch(`/v1/payments/${mpPaymentId}`);
    return {
        mp_status: data.status,
        mp_status_detail: data.status_detail,
        mp_payment_id: data.id,
        external_reference: data.external_reference,
        transaction_amount: data.transaction_amount,
    };
}

// ─── Validate webhook signature ───────────────────────────────
export function validateWebhookSignature(req) {
    const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    if (!secret) return false;

    // Mercado Pago sends x-signature header: "ts=...,v1=..."
    const signature = req.headers['x-signature'] || req.headers['x-signature'];
    const requestId = req.headers['x-request-id'];

    if (!signature) return false;

    // Parse the signature header
    const parts = signature.split(',').reduce((acc, part) => {
        const [key, value] = part.split('=');
        acc[key.trim()] = value.trim();
        return acc;
    }, {});

    const ts = parts.ts;
    const v1 = parts.v1;

    if (!ts || !v1) return false;

    // Validate timestamp (reject if older than 5 minutes)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(ts)) > 300) return false;

    // The manifest to hash depends on the notification type
    // For Orders API webhooks, the body contains data.id
    const dataId = req.body?.data?.id || '';
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;

    // Use Node's crypto to validate
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(manifest);
    const computed = hmac.digest('hex');

    return computed === v1;
}

// ─── Map MP status to internal payment status ─────────────────
export function mapPaymentStatus(mpStatus) {
    const map = {
        'pending': 'pending',
        'in_process': 'pending',
        'approved': 'approved',
        'rejected': 'rejected',
        'cancelled': 'rejected',
        'refunded': 'refunded',
        'charged_back': 'refunded',
    };
    return map[mpStatus] || 'pending';
}

// ─── PT-BR labels for payment status ───────────────────────────
export const PAYMENT_STATUS_PT = {
    pending: 'Aguardando pagamento',
    approved: 'Pago',
    rejected: 'Recusado',
    refunded: 'Reembolsado',
    in_process: 'Em análise',
    cancelled: 'Cancelado',
};
