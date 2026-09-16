const EXPECTED_CURRENCY = 'BRL';

function mismatch(field) {
    return Object.assign(new Error(`Pagamento não corresponde ao pedido (${field})`), {
        status: 409,
        code: 'PAYMENT_MISMATCH',
        field,
    });
}

function amountInCents(value) {
    const amount = Number(value);
    return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function resourceAmount(resource) {
    return resource?.total_amount ?? resource?.transaction_amount ?? resource?.amount;
}

/** Strictly validate an official provider resource against a server order. */
export function verifyPaymentResourceForOrder(order, resource) {
    if (!resource || typeof resource !== 'object') throw mismatch('resource');
    if (resource.external_reference !== order.order_number) throw mismatch('external_reference');
    if (amountInCents(resourceAmount(resource)) !== amountInCents(order.total)) throw mismatch('amount');
    if (resource.currency_id !== EXPECTED_CURRENCY) throw mismatch('currency');
    if (!resource.mp_status) throw mismatch('status');
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

function mergeOfficialResources(orderResource, paymentResource) {
    const resources = [orderResource, paymentResource].filter(Boolean);
    if (resources.length === 0) return null;

    // Every value the provider supplied must agree with the local order. Missing
    // fields may be completed by the companion payment/order resource.
    for (const resource of resources) {
        if (resource.external_reference != null && resource.external_reference !== orderResource?.external_reference && orderResource?.external_reference != null) {
            throw mismatch('external_reference');
        }
        if (resourceAmount(resource) != null && resourceAmount(orderResource) != null
            && amountInCents(resourceAmount(resource)) !== amountInCents(resourceAmount(orderResource))) {
            throw mismatch('amount');
        }
        if (resource.currency_id != null && orderResource?.currency_id != null && resource.currency_id !== orderResource.currency_id) {
            throw mismatch('currency');
        }
    }

    return {
        mp_status: paymentResource?.mp_status || orderResource?.mp_status,
        mp_status_detail: paymentResource?.mp_status_detail || orderResource?.mp_status_detail || null,
        mp_payment_id: paymentResource?.mp_payment_id || orderResource?.mp_payment_id || null,
        external_reference: paymentResource?.external_reference || orderResource?.external_reference,
        total_amount: resourceAmount(paymentResource) ?? resourceAmount(orderResource),
        currency_id: paymentResource?.currency_id || orderResource?.currency_id,
    };
}

/** Fetch provider state by server-persisted IDs, then apply the strict checks. */
export async function getVerifiedPaymentForOrder(order, provider, initialOrderResource = null) {
    let orderResource = initialOrderResource;
    let paymentResource = null;
    let orderError = null;

    if (!orderResource && order.mercado_pago_order_id) {
        try {
            orderResource = await provider.getOrderStatus(order.mercado_pago_order_id);
        } catch (error) {
            orderError = error;
        }
    }

    const paymentId = orderResource?.mp_payment_id || order.mercado_pago_payment_id;
    if (paymentId) paymentResource = await provider.getPaymentStatus(paymentId);

    if (!orderResource && !paymentResource) {
        if (orderError) throw orderError;
        throw Object.assign(new Error('Pedido sem pagamento do Mercado Pago'), { status: 409, code: 'PAYMENT_NOT_CREATED' });
    }

    const merged = mergeOfficialResources(orderResource, paymentResource);
    return verifyPaymentResourceForOrder(order, merged);
}

export function hasPaymentStateChanged(order, resource, internalStatus) {
    return order.mercado_pago_status !== resource.mp_status
        || order.mercado_pago_status_detail !== resource.mp_status_detail
        || order.payment_status !== internalStatus
        || (resource.mp_payment_id && String(order.mercado_pago_payment_id || '') !== String(resource.mp_payment_id));
}
