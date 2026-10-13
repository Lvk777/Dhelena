import { strictCents } from './installmentPolicy.js';
const EXPECTED_CURRENCY = 'BRL';

function mismatch(field) {
    return Object.assign(new Error(`Pagamento não corresponde ao pedido (${field})`), {
        status: 409,
        code: 'PAYMENT_MISMATCH',
        field,
    });
}

function amountInCents(value) {
    if (!/^\d+(?:\.\d{1,2})?$/.test(String(value ?? ''))) return null;
    const amount = Number(value);
    return Number.isSafeInteger(Math.round(amount * 100)) ? Math.round(amount * 100) : null;
}

/** Strictly validate an official provider resource against a server order. */
export function verifyPaymentResourceForOrder(order, resource) {
    if (!resource || typeof resource !== 'object') throw mismatch('resource');
    if (!resource.mp_order_id || (order.mercado_pago_order_id && resource.mp_order_id !== order.mercado_pago_order_id)) throw mismatch('mp_order_id');
    if (resource.external_reference !== order.order_number) throw mismatch('external_reference');
    const expected = amountInCents(order.total);
    if (expected === null || amountInCents(resource.total_amount) !== expected) throw mismatch('total_amount');
    if (amountInCents(resource.transaction_amount) !== expected) throw mismatch('transaction_amount');
    if (resource.currency_id !== EXPECTED_CURRENCY) throw mismatch('currency');
    if (resource.transaction_currency_id && resource.transaction_currency_id !== EXPECTED_CURRENCY) throw mismatch('transaction_currency');
    if (resource.payment_count !== 1) throw mismatch('payment_count');
    const offer = order.snapshot?.card_installment_offer;
    if (offer) {
        if (resource.payment_method_type !== 'credit_card' || resource.payment_method_id !== offer.payment_method_id) throw mismatch('card_method');
        if (Number(resource.payment_installments) !== offer.installments) throw mismatch('installments');
        if (strictCents(resource.payment_installment_amount) !== strictCents(offer.installment_amount)) throw mismatch('installment_amount');
        if (resource.payment_issuer_id != null && String(resource.payment_issuer_id) !== offer.issuer_id) throw mismatch('issuer');
        if (strictCents(offer.original_amount) !== expected) throw mismatch('offer_original_amount');
    }
    if (!resource.mp_payment_id || (order.mercado_pago_payment_id && resource.mp_payment_id !== order.mercado_pago_payment_id)) throw mismatch('mp_payment_id');
    if (!resource.order_status || !resource.transaction_status) throw mismatch('status');
    if (resource.mp_status !== resource.transaction_status || resource.mp_status_detail !== resource.transaction_status_detail) throw mismatch('transaction_status');
    if ((resource.order_status === 'processed' && resource.order_status_detail === 'accredited')
        !== (resource.transaction_status === 'processed' && resource.transaction_status_detail === 'accredited')) throw mismatch('accreditation');
    return resource;
}

export function isVerifiedPaymentForOrder(order, resource) {
    try {
        verifyPaymentResourceForOrder(order, resource);
        return true;
    } catch {
        return false;
    }
}

/** Orders API PAY IDs are transaction IDs, not legacy /v1/payments IDs. */
export async function getVerifiedPaymentForOrder(order, provider, initialOrderResource = null, candidateOrderId = null) {
    const mpOrderId = candidateOrderId || order.mercado_pago_order_id;
    if (!mpOrderId) throw Object.assign(new Error('Pedido sem order do Mercado Pago'), { status: 409, code: 'PAYMENT_NOT_CREATED' });
    const resource = initialOrderResource || await provider.getOrderStatus(mpOrderId);
    if (resource?.mp_order_id !== mpOrderId) throw mismatch('mp_order_id');
    return verifyPaymentResourceForOrder(order, resource);
}

export function hasPaymentStateChanged(order, resource, internalStatus) {
    return order.mercado_pago_order_id !== resource.mp_order_id
        || order.mercado_pago_external_reference !== resource.external_reference
        || order.mercado_pago_status !== resource.mp_status
        || order.mercado_pago_status_detail !== resource.mp_status_detail
        || order.payment_status !== internalStatus
        || (resource.mp_payment_id && String(order.mercado_pago_payment_id || '') !== String(resource.mp_payment_id));
}
