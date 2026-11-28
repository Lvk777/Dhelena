const labels = {
    cart_inflight: 'Envio aguardando confirmação',
    cart_uncertain: 'Envio aguardando confirmação',
    cart_created: 'Envio preparado, aguardando compra',
    purchase_inflight: 'Compra aguardando confirmação',
    purchase_uncertain: 'Compra aguardando confirmação',
    purchased: 'Etiqueta comprada',
    generating: 'Etiqueta em geração',
    generated: 'Etiqueta disponível',
    posted: 'Encomenda postada',
    in_transit: 'Em transporte',
    out_for_delivery: 'Saiu para entrega',
    delivered: 'Entregue',
};

export function shippingStatusLabel(status) {
    return labels[status] || 'Situação do envio indisponível';
}
