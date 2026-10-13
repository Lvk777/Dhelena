export function deliveryEstimateLabel(quote) {
    const estimate = quote?.delivery_estimate;
    if (estimate?.total_business_days != null) {
        return `Até ${estimate.total_business_days} dias úteis após a confirmação do pagamento (${estimate.preparation_business_days} de preparação + até ${estimate.carrier_business_days} de transporte)`;
    }
    const carrier = estimate?.carrier_business_days;
    return carrier != null
        ? `Transporte: até ${carrier} dias úteis. Prazo de preparação ainda não confirmado.`
        : 'Prazo total de entrega ainda não confirmado.';
}
