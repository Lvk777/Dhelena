import { expect, test } from 'vitest';
import { orderStatusLabel } from './products';

test('a full refund is shown as Reembolsado even if the operational state remains approved', () => {
    expect(orderStatusLabel({status:'pagamento_aprovado',payment_status:'refunded'})).toBe('Reembolsado');
    expect(orderStatusLabel({status:'pagamento_aprovado',payment_status:'partially_refunded'})).toBe('Parcialmente reembolsado');
    expect(orderStatusLabel({status:'pagamento_aprovado',payment_status:'approved'})).toBe('Pagamento aprovado');
    expect(orderStatusLabel({status:'cancelado',payment_status:'refunded'})).toBe('Cancelado');
});
