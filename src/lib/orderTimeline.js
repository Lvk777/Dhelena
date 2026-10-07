const EVENT_LABELS = {
    order_created: 'Pedido recebido',
    payment_pending: 'Aguardando pagamento',
    payment_approved: 'Pagamento confirmado',
    payment_rejected: 'Pagamento recusado',
    payment_refunded: 'Pagamento reembolsado',
    em_separacao: 'Em separação',
    label_generated: 'Etiqueta gerada',
    shipped: 'Postado',
    em_transporte: 'Em trânsito',
    saiu_entrega: 'Saiu para entrega',
    delivered: 'Entregue',
    entregue: 'Entregue',
    cancelled: 'Cancelado',
};

export function orderEventLabel(event, paymentStatus) {
    if (event.event === 'payment_pending' && paymentStatus === 'approved') {
        return 'Pagamento inicialmente pendente';
    }
    return EVENT_LABELS[event.event] || event.description || event.event;
}
