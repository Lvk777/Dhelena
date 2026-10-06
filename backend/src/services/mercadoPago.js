/**
 * Mercado Pago Service — Checkout Transparente via Orders API
 * Uses MERCADO_PAGO_ACCESS_TOKEN (server-side only — NEVER exposed to frontend)
 * Uses MERCADO_PAGO_PUBLIC_KEY (frontend only — for Card Brick tokenization)
 */

import crypto from 'crypto';
import { normalizePayer, omitEmptyOptional } from '../lib/paymentPayer.js';

const BASE_URL = 'https://api.mercadopago.com';

function getAccessToken() {
    const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    if (!token) throw Object.assign(new Error('MERCADO_PAGO_ACCESS_TOKEN não configurado'), { status: 500 });
    return token;
}

export function getMercadoPagoMode() {
    const mode = process.env.MERCADO_PAGO_MODE;
    return mode === 'test' || mode === 'production' ? mode : 'INDETERMINADO';
}

export function getMercadoPagoReadiness() {
    return {
        mode: getMercadoPagoMode(),
        configured: !!process.env.MERCADO_PAGO_ACCESS_TOKEN && getMercadoPagoMode() !== 'INDETERMINADO',
        public_key_configured: !!process.env.MERCADO_PAGO_PUBLIC_KEY,
        webhook_configured: !!process.env.MERCADO_PAGO_WEBHOOK_SECRET,
    };
}

export function getMercadoPagoEnvironment() {
    return { test: 'Teste', production: 'Produção' }[getMercadoPagoMode()] || 'INDETERMINADO';
}

async function mpFetch(path, options = {}) {
    const token = getAccessToken();
    const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
    const { idempotencyKey, ...fetchOptions } = options;
    const method = (fetchOptions.method || 'GET').toUpperCase();
    const idempotencyHeaders = method === 'GET' ? {} : { 'X-Idempotency-Key': idempotencyKey || crypto.randomUUID() };
    const res = await fetch(url, {
        ...fetchOptions,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...idempotencyHeaders,
            ...(fetchOptions.headers || {}),
        },
    });
    const data = await res.json().catch(() => ({}));
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
            environment: getMercadoPagoEnvironment(),
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
export async function getAvailablePaymentTypes(methods = null) {
    methods ||= await getPaymentMethods();
    const types = new Set(methods.map(m => m.payment_type_id));
    return {
        pix: types.has('bank_transfer') || methods.some(m => m.id === 'pix'),
        credit_card: types.has('credit_card'),
        debit_card: types.has('debit_card'),
        boleto: types.has('ticket'),
    };
}

// ─── Create Pix payment via Orders API ─────────────────────────
export async function createPixPayment({ orderId, orderNumber, total, payer, idempotencyKey, onStage = () => {} }) {
    onStage('build_payload');
    const safePayer = normalizePayer(payer);
    const body = {
        type: 'online',
        processing_mode: 'automatic',
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
        payer: safePayer,
        description: `Pedido ${orderNumber}`,
    };

    onStage('mp_request');
    const data = await mpFetch('/v1/orders', {
        method: 'POST',
        body: JSON.stringify(body),
        idempotencyKey: idempotencyKey || `pix-${orderNumber}`,
    });

    onStage('mp_response_received', data.id);
    // A processed/accredited TEST order may have no QR code.
    onStage('extract_order', data.id);
    const resource = orderResource(data);
    onStage('extract_transaction', data.id);
    const payment = data.transactions?.payments?.[0] || {};
    onStage('extract_qr', data.id);
    const pixData = payment.payment_method || payment.point_of_interaction?.transaction_data || {};

    return {
        mp_order_id: data.id,
        mp_payment_id: payment.id,
        mp_status: payment.status,
        mp_status_detail: payment.status_detail,
        external_reference: data.external_reference,
        pix_qr_code: pixData.qr_code || null,
        pix_qr_code_base64: pixData.qr_code_base64 || null,
        pix_expiration_at: pixData.expiration_date || null,
        provider_resource: resource,
    };
}

// ─── Create card payment via Orders API ───────────────────────
export async function createCardPayment({ orderId, orderNumber, total, payer, cardToken, installments, paymentMethodId, paymentType, issuerId, idempotencyKey }) {
    const safePayer = normalizePayer(payer);
    const body = {
        type: 'online',
        processing_mode: 'automatic',
        external_reference: orderNumber,
        total_amount: String(Number(total).toFixed(2)),
        transactions: {
            payments: [{
                amount: String(Number(total).toFixed(2)),
                payment_method: omitEmptyOptional({
                    id: paymentMethodId,
                    type: paymentType,
                    token: cardToken,
                    installments: parseInt(installments) || 1,
                    issuer_id: issuerId ? String(issuerId) : undefined,
                }),
            }],
        },
        payer: safePayer,
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

// Admin-only TEST diagnosis: read provider orders by their store reference.
// The response excludes payer data and credentials.
export async function findTestOrdersByReference(externalReference, createdAt) {
    if (getMercadoPagoMode() !== 'test') {
        throw Object.assign(new Error('Diagnóstico disponível somente no modo TEST'), { status: 409 });
    }
    const created = new Date(createdAt).getTime();
    if (!Number.isFinite(created)) {
        throw Object.assign(new Error('Data do pedido inválida'), { status: 400 });
    }
    const params = new URLSearchParams({
        begin_date: new Date(created - 24 * 60 * 60 * 1000).toISOString(),
        end_date: new Date().toISOString(),
        external_reference: externalReference,
        type: 'online',
        page: '1',
        page_size: '10',
    });
    const result = await mpFetch(`/v1/orders?${params}`, { signal: AbortSignal.timeout(10000) });
    // A full first page or an unexpected response cannot prove absence.
    if (!Array.isArray(result.data) || !Number.isSafeInteger(result.paging?.total)
        || result.paging.total !== result.data.length || result.data.length >= 10
        || result.data.some(order => order.external_reference !== externalReference)) {
        throw Object.assign(new Error('Consulta de Orders inconclusiva; exige conciliação'), { status: 409 });
    }
    const safeCode = (value) => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(value) ? value : null;
    return result.data
        .filter((order) => order.external_reference === externalReference)
        .map((order) => ({
            id: order.id,
            status: safeCode(order.status),
            status_detail: safeCode(order.status_detail),
            processing_mode: safeCode(order.processing_mode),
            transactions: (order.transactions?.payments || []).map((payment) => ({
                status: safeCode(payment.status),
                status_detail: safeCode(payment.status_detail),
                errors: (Array.isArray(payment.errors) ? payment.errors : []).map((error) => ({
                    code: safeCode(error.code),
                    cause: safeCode(error.cause),
                })),
            })),
            errors: (Array.isArray(order.errors) ? order.errors : []).map((error) => ({
                code: safeCode(error.code),
                cause: safeCode(error.cause),
            })),
        }));
}

// ─── Get payment/order status from MP ─────────────────────────
function orderResource(data) {
    const payments = data.transactions?.payments || [];
    const payment = payments[0] || {};
    return {
        mp_order_id: data.id,
        order_status: data.status,
        order_status_detail: data.status_detail,
        mp_status: payment.status,
        mp_status_detail: payment.status_detail,
        mp_payment_id: payment.id,
        payment_count: payments.length,
        transaction_amount: payment.amount,
        transaction_status: payment.status,
        transaction_status_detail: payment.status_detail,
        total_amount: data.total_amount,
        currency_id: data.currency_id || data.currency,
        transaction_currency_id: payment.currency_id || payment.currency || null,
        external_reference: data.external_reference,
    };
}

export async function getOrderStatus(mpOrderId) {
    const data = await mpFetch(`/v1/orders/${encodeURIComponent(mpOrderId)}`);
    return orderResource(data);
}

// ─── Validate webhook signature ───────────────────────────────
export function inspectWebhookSignature(req) {
    const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    const signature = req.headers?.['x-signature'];
    const requestId = req.headers?.['x-request-id'];
    // Only the query value is signed. Never substitute body.data.id.
    const dataId = req.query?.['data.id'];
    const presence = {
        has_signature: typeof signature === 'string' && signature.length > 0,
        has_request_id: typeof requestId === 'string' && requestId.length > 0,
        has_query_data_id: typeof dataId === 'string' && dataId.length > 0,
        secret_configured: typeof secret === 'string' && secret.length > 0,
    };
    const reject = (reason) => ({ valid: false, reason, ...presence });
    if (!presence.secret_configured) return reject('secret_not_configured');
    if (!presence.has_signature) return reject('signature_missing');

    const parts = Object.create(null);
    for (const part of signature.split(',')) {
        const separator = part.indexOf('=');
        if (separator <= 0) return reject('signature_malformed');
        const key = part.slice(0, separator).trim();
        if (parts[key] !== undefined) return reject('signature_malformed');
        parts[key] = part.slice(separator + 1).trim();
    }
    const ts = parts.ts;
    const v1 = parts.v1;
    if (!/^[a-fA-F0-9]{64}$/.test(v1 || '')) return reject('signature_malformed');
    if (ts !== undefined && !/^\d+$/.test(ts)) return reject('timestamp_malformed');

    // Official HMAC manifest: omit only genuinely absent pairs and keep case.
    // Signed, delayed deliveries are handled by deduplication and a fresh GET.
    const manifest = [
        presence.has_query_data_id && `id:${dataId};`,
        presence.has_request_id && `request-id:${requestId};`,
        ts !== undefined && `ts:${ts};`,
    ].filter(Boolean).join('');
    const expected = crypto.createHmac('sha256', secret).update(manifest).digest();
    const received = Buffer.from(v1, 'hex');
    return crypto.timingSafeEqual(expected, received)
        ? { valid: true, reason: 'valid', ...presence }
        : reject('signature_mismatch');
}

export function validateWebhookSignature(req) {
    return inspectWebhookSignature(req).valid;
}

// After-sales uses Orders API only. Return a limited shape without payer or credentials.
export async function getRefundableOrder(mpOrderId) {
    const data = await mpFetch(`/v1/orders/${encodeURIComponent(mpOrderId)}`);
    const payments = data.transactions?.payments || [];
    return {
        id: data.id,
        external_reference: data.external_reference,
        total_amount: data.total_amount,
        currency: data.currency_id || data.currency || payments[0]?.currency_id,
        status: data.status,
        status_detail: data.status_detail,
        payment: payments.length === 1 ? {
            id: payments[0].id, status: payments[0].status, amount: payments[0].amount,
        } : null,
        refunds: (data.transactions?.refunds || []).map(refund => ({
            id: refund.id,
            transaction_id: refund.transaction_id,
            amount: refund.amount,
            status: refund.status,
        })),
    };
}

export async function refundOrder({ mpOrderId, mpPaymentId, amount, full, idempotencyKey }) {
    if (!idempotencyKey || !/^[a-zA-Z0-9_-]{1,128}$/.test(idempotencyKey)) {
        throw Object.assign(new Error('Chave de idempotência inválida'), { status: 400 });
    }
    const body = full ? undefined : JSON.stringify({
        transactions: [{ id: mpPaymentId, amount: (amount / 100).toFixed(2) }],
    });
    const data = await mpFetch(`/v1/orders/${encodeURIComponent(mpOrderId)}/refund`, {
        method: 'POST', idempotencyKey, ...(body ? { body } : {}),
    });
    return {
        id: data.id,
        status: data.status,
        status_detail: data.status_detail,
        refunds: (data.transactions?.refunds || []).map(refund => ({
            id: refund.id,
            transaction_id: refund.transaction_id,
            amount: refund.amount,
            status: refund.status,
        })),
    };
}

export async function cancelPendingOrder(mpOrderId, idempotencyKey) {
    const data = await mpFetch(`/v1/orders/${encodeURIComponent(mpOrderId)}/cancel`, {
        method: 'POST', idempotencyKey,
    });
    return { id: data.id, status: data.status, external_reference: data.external_reference };
}

// ─── Map MP status to internal payment status ─────────────────
export function mapPaymentStatus(mpStatus, statusDetail = null) {
    if (mpStatus === 'processed' && statusDetail === 'accredited') return 'approved';
    const map = {
        'pending': 'pending',
        'in_process': 'pending',
        'approved': 'approved',
        'partially_refunded': 'partially_refunded',
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
