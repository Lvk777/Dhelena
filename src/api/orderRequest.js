export function buildPlaceOrderRequest(args = {}) {
    const { idempotencyKey, ...payload } = args;
    return {
        method: 'POST',
        headers: { 'X-Idempotency-Key': idempotencyKey },
        body: JSON.stringify(payload),
    };
}
