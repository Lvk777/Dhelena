function invalid(message, status = 400) {
    return Object.assign(new Error(message), { status });
}

export function validateCardPaymentChoice(orderMethod, methods, paymentMethodId, installments, config = {}) {
    const paymentType = { credito: 'credit_card', debito: 'debit_card' }[orderMethod];
    if (!paymentType) throw invalid('Este pedido não aceita pagamento com cartão', 409);
    if (config.card_enabled === false || (paymentType === 'debit_card' && config.debit_card_enabled === false)) {
        throw invalid('Pagamento com cartão indisponível', 409);
    }
    const selectedMethod = methods.find(method => method.id === paymentMethodId && method.payment_type_id === paymentType);
    if (!selectedMethod) throw invalid('Tipo de cartão não corresponde ao pedido');
    const requestedInstallments = Number(installments ?? 1);
    const maxInstallments = Math.min(12, Math.max(1, Number(config.max_installments) || 6));
    if (!Number.isInteger(requestedInstallments) || requestedInstallments < 1 || requestedInstallments > maxInstallments) {
        throw invalid('Parcelamento indisponível');
    }
    if (paymentType === 'debit_card' && requestedInstallments !== 1) {
        throw invalid('Cartão de débito exige pagamento à vista');
    }
    return { paymentType, installments: requestedInstallments };
}
