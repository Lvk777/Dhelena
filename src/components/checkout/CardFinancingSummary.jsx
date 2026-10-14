import React from 'react';
import { formatBRL } from '@/data/products';

export default function CardFinancingSummary({ order }) {
    const offer = order.snapshot?.card_installment_offer;
    if (!offer) return null;
    return <div className="text-sm space-y-1 mt-3 border-t pt-3">
        <p>Condição registrada na tentativa de pagamento</p>
        <p>Compra original: {formatBRL(offer.original_amount)}</p>
        <p>{offer.installments}x de {formatBRL(offer.installment_amount)} · Juros da cliente: {formatBRL(offer.buyer_interest_amount)}</p>
        <p>Total da cliente: <strong>{formatBRL(offer.buyer_total)}</strong></p>
        <p className="text-xs text-muted-foreground">A confirmação depende do status do pagamento. Ajustes residuais de centavos seguem o provedor.</p>
    </div>;
}
