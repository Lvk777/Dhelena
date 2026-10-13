import { checkoutCents } from './checkoutDiscount.js';

function invalid(message, status = 400) {
    return Object.assign(new Error(message), { status });
}

export function creditInstallmentPolicy(config = {}, env = process.env) {
    const configured = Number(config.max_installments);
    const maximum = Number.isInteger(configured) && configured > 0 ? Math.min(6, configured) : 6;
    const interestFree = Number(config.interest_free_installments);
    const approved = env.CREDIT_INSTALLMENTS_APPROVED === 'true' && Number.isInteger(interestFree) && interestFree > 1;
    return { max_installments: approved ? Math.min(maximum, interestFree) : 1, interest_free_approved: approved };
}

export function validateCardPaymentChoice(orderMethod, methods, paymentMethodId, installments, config = {}, amount = null) {
    const paymentType = { credito: 'credit_card', debito: 'debit_card' }[orderMethod];
    if (!paymentType) throw invalid('Este pedido não aceita pagamento com cartão', 409);
    if (config.card_enabled === false || (paymentType === 'debit_card' && config.debit_card_enabled === false)) {
        throw invalid('Pagamento com cartão indisponível', 409);
    }
    const selectedMethod = methods.find(method => method.id === paymentMethodId && method.payment_type_id === paymentType);
    if (!selectedMethod) throw invalid('Tipo de cartão não corresponde ao pedido');
    if (amount !== null && ((Number(selectedMethod.min_allowed_amount) > Number(amount))
        || (Number(selectedMethod.max_allowed_amount) > 0 && Number(selectedMethod.max_allowed_amount) < Number(amount)))) {
        throw invalid('Valor não aceito por este cartão');
    }
    const requestedInstallments = Number(installments ?? 1);
    const maxInstallments = Math.min(6, Math.max(1, Number(config.max_installments) || 6));
    if (!Number.isInteger(requestedInstallments) || requestedInstallments < 1 || requestedInstallments > maxInstallments) {
        throw invalid('Parcelamento indisponível');
    }
    if (paymentType === 'debit_card' && requestedInstallments !== 1) {
        throw invalid('Cartão de débito exige pagamento à vista');
    }
    return { paymentType, installments: requestedInstallments };
}

export function assertSupportedInstallments(plans, requested, total) {
    const costs = plans.flatMap(plan => Array.isArray(plan.payer_costs) ? plan.payer_costs : []);
    const selected = costs.find(cost => Number(cost.installments) === requested
        && Number(cost.installment_rate) === 0 && cost.total_amount != null
        && checkoutCents(cost.total_amount) === checkoutCents(total));
    if (!selected) throw invalid('Parcelamento sem juros não disponível neste cartão. Escolha outra opção.', 409);
}
