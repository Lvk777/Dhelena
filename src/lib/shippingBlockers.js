export function shippingPreparationBlockers({ order, ready, fiscalDocument, fiscalLoadError = '', fiscalEnabled = false, busy = false }) {
    const reasons = [];
    if (busy) reasons.push('Aguarde a operação em andamento.');
    if (order.payment_status !== 'approved') reasons.push('O pagamento ainda não foi confirmado. Confira a conciliação financeira.');
    if (order.status === 'cancelado') reasons.push('O pedido foi cancelado. Confira o histórico antes de qualquer envio.');
    if (!ready?.environment) reasons.push('Os dados operacionais do envio não foram carregados. Atualize a página e confira a configuração.');
    const state = ready?.status || order.shipping_status;
    if (['cart_inflight', 'cart_uncertain'].includes(state))
        reasons.push('O Melhor Envio ainda não confirmou a tentativa anterior. Concilie o histórico com o provedor antes de tentar novamente; uma nova tentativa pode gerar duplicidade.');
    if (ready?.environment === 'production') {
        if (!fiscalEnabled) reasons.push('A importação fiscal está indisponível. Solicite a homologação antes de preparar o envio.');
        else if (fiscalLoadError) reasons.push('Não foi possível consultar a nota fiscal. Atualize o pedido e confira o vínculo fiscal.');
        else if (fiscalDocument?.differences?.length) reasons.push('A nota fiscal ainda diverge do pedido. Resolva as diferenças indicadas na seção Nota fiscal.');
        else if (fiscalDocument?.status !== 'verified') reasons.push('Falta concluir a comparação com o pedido e registrar a conferência da autorização no portal oficial.');
    }
    return reasons;
}
