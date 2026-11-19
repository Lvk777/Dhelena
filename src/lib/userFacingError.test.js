import { expect, test } from 'vitest';
import { userFacingErrorMessage } from './userFacingError';
import { shippingStatusLabel } from './shippingStatusLabel';

test('known HTTP failures have contextual, actionable Portuguese messages', () => {
    for (const status of [400, 401, 402, 403, 404, 409, 422, 429, 500, 503]) {
        const message = userFacingErrorMessage(status, '/orders/fixture/fiscal', `HTTP ${status} Internal Error`);
        expect(message.length).toBeGreaterThan(30);
        expect(message).not.toMatch(/HTTP|Internal Error|\b[45]\d\d\b/);
    }
    expect(userFacingErrorMessage(422, '/fiscal/import', 'O arquivo não é o XML fiscal autorizado da NF-e.')).toContain('XML fiscal autorizado');
    expect(userFacingErrorMessage(409, '/shipping/label')).toContain('envio');
    expect(userFacingErrorMessage(402, '/payment/card')).toContain('pagamento');
    expect(userFacingErrorMessage(0, '/checkout/orders')).toContain('internet');
    expect(userFacingErrorMessage(500, '/stock/adjust')).toContain('estoque');
    expect(userFacingErrorMessage(500, '/products')).toContain('produto');
});

test('internal shipping states are translated without changing the stored state', () => {
    expect(shippingStatusLabel('cart_inflight')).toBe('Envio aguardando confirmação');
    expect(shippingStatusLabel('purchase_uncertain')).toBe('Compra aguardando confirmação');
    expect(shippingStatusLabel('cart_inflight')).not.toContain('cart_');
});
