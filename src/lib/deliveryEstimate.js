export const DELIVERY_BUSINESS_DAYS_NOTE = 'A contagem começa no primeiro dia útil seguinte à confirmação do pagamento. Não contam sábados, domingos e feriados aplicáveis. A preparação inclui a entrega efetiva à transportadora.';

export function deliveryEstimateLabel(quote) {
    const estimate = quote?.delivery_estimate;
    if (estimate?.total_business_days != null) {
        return `Até ${estimate.total_business_days} dias úteis após a confirmação do pagamento (até ${estimate.preparation_business_days} de preparação e postagem + até ${estimate.carrier_business_days} de transporte)`;
    }
    const carrier = estimate?.carrier_business_days;
    return carrier != null
        ? `Transporte: até ${carrier} dias úteis. Prazo de preparação ainda não confirmado.`
        : 'Prazo total de entrega ainda não confirmado.';
}

export function orderDeliveryEstimateLabel(order) {
    if (order?.snapshot?.delivery_estimate) return deliveryEstimateLabel(order.snapshot);
    // Historic orders keep their original duration; never add today's preparation.
    return order?.shipping_delivery_time != null
        ? `Prazo registrado na compra: ${order.shipping_delivery_time} dia(s) úteis`
        : 'Prazo não registrado neste pedido.';
}
