import crypto from 'crypto';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
        return Object.keys(value).sort().reduce((result, key) => {
            if (value[key] !== undefined) result[key] = stableValue(value[key]);
            return result;
        }, {});
    }
    return value;
}

export function normalizeIdempotencyKey(value) {
    const key = typeof value === 'string' ? value.trim() : '';
    if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
        throw Object.assign(new Error('X-Idempotency-Key inválida'), { status: 400 });
    }
    return key;
}

/**
 * Hash only the fields that can legitimately influence checkout. Browser-only
 * prices, totals, dimensions, freight values and service labels are excluded.
 */
export function createOrderRequestFingerprint(body = {}) {
    const items = Array.isArray(body.items)
        ? body.items.map((item) => ({
            productId: item.productId,
            colorId: item.colorId,
            size: item.size,
            qty: Number.parseInt(item.qty, 10),
        })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
        : [];

    const trustedRequest = {
        items,
        coupon_code: typeof body.coupon_code === 'string' ? body.coupon_code.trim().toUpperCase() : '',
        payment_method: body.payment_method || null,
        shipping_method: body.shipping_method || null,
        shipping_quote_id: body.shipping_quote_id == null ? null : String(body.shipping_quote_id),
        shipping_address: body.shipping_address || null,
        customer: body.customer || null,
    };

    return crypto.createHash('sha256').update(JSON.stringify(stableValue(trustedRequest))).digest('hex');
}

export function assertMatchingIdempotencyRequest(existingOrder, fingerprint) {
    const storedFingerprint = existingOrder.idempotency_fingerprint || existingOrder.snapshot?.idempotency_fingerprint;
    if (!storedFingerprint || storedFingerprint !== fingerprint) {
        throw Object.assign(new Error('X-Idempotency-Key já utilizada em outra requisição'), { status: 409 });
    }
    return existingOrder;
}
