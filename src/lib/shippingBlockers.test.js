import { describe, expect, it } from 'vitest';
import { shippingPreparationBlockers } from './shippingBlockers';

const order = { payment_status: 'approved', status: 'pago', shipping_status: 'draft' };
const ready = { environment: 'production', status: 'draft', purchase_enabled: false };
const fiscalDocument = { status: 'verified', differences: [] };
const check = overrides => shippingPreparationBlockers({ order, ready, fiscalDocument,
    fiscalEnabled: true, ...overrides });

describe('preparation blockers', () => {
    it('allows preparation with a verified fiscal document even when purchase remains disabled', () => {
        expect(check()).toEqual([]);
    });
    it('explains fiscal divergence and official check separately', () => {
        const divergent = check({ fiscalDocument: { status: 'needs_review', differences: ['Produto'] } });
        expect(divergent.some(reason => /diverge/.test(reason))).toBe(true);
        expect(divergent.some(reason => /portal oficial/.test(reason))).toBe(true);
        expect(check({ fiscalDocument: { status: 'pending_official', differences: [] } }).join(' ')).toMatch(/portal oficial/);
        expect(check({ fiscalLoadError: 'Falhou' }).join(' ')).toMatch(/consultar a nota fiscal/);
    });
    it('preserves the external in-flight lock regardless of fiscal regularization', () => {
        expect(check({ ready: { ...ready, status: 'cart_inflight' } }).join(' ')).toMatch(/duplicidade/);
        expect(check({ ready: { ...ready, status: 'cart_uncertain' } }).join(' ')).toMatch(/Concilie/);
    });
    it('shows an invalid old SEDEX package independently of the provider reconciliation block', () => {
        const result = check({ order: { ...order, shipping_quote_id: '2' }, ready: { ...ready,
            status: 'cart_inflight', carrier: 'Correios', service: 'SEDEX',
            packages: [{ height: 0.4, width: 8, length: 13, weight: 0.3 }] } });
        expect(result.join(' ')).toMatch(/duplicidade/);
        expect(result.join(' ')).toMatch(/medidas ou o peso/);
        expect(result.join(' ')).toMatch(/Não use dimensões estimadas/);
    });
    it('does not impose Correios-only measurements on another carrier', () => {
        const result = check({ ready: { ...ready, carrier: 'Outra transportadora', service: 'Express',
            packages: [{ height: 0.4, width: 8, length: 13, weight: 0.3 }] } });
        expect(result).toEqual([]);
    });
    it('explains payment, cancellation, environment, flag and busy state', () => {
        expect(check({ order: { ...order, payment_status: 'pending' } }).join(' ')).toMatch(/pagamento/);
        expect(check({ order: { ...order, status: 'cancelado' } }).join(' ')).toMatch(/cancelado/);
        expect(check({ ready: null }).join(' ')).toMatch(/dados operacionais/);
        expect(check({ fiscalEnabled: false }).join(' ')).toMatch(/homologação/);
        expect(check({ busy: true }).join(' ')).toMatch(/Aguarde/);
    });
});
