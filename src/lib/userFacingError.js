const contexts = /** @type {Array<[RegExp, string]>} */ ([
    [/\/fiscal(?:\/|$)/, 'nota fiscal'],
    [/\/shipping(?:\/|$)/, 'envio'],
    [/\/stock(?:\/|$)/, 'estoque'],
    [/\/payment|\/payments|\/refund/, 'pagamento'],
    [/\/checkout|\/orders(?:\/|$)/, 'pedido'],
    [/\/products(?:\/|$)/, 'produto'],
]);

export function operationContext(path = '') {
    return contexts.find(([pattern]) => pattern.test(path))?.[1] || 'operação';
}

const technical = /(?:\b(?:HTTP|status|error|exception|request|response|timeout|fetch|undefined|null|SQL|JSON|stack|trace)\b|\b(?:cart|purchase)_(?:inflight|uncertain)\b|\b(?:4|5)\d\d\b|[{}<>])/i;
const readable = message => typeof message === 'string' && message.length >= 10 && message.length <= 350
    && /[áàâãéêíóôõúç]|\b(?:não|pedido|nota|envio|pagamento|estoque|produto|arquivo|chave|confira|informe|aguarde|acesso|conta|sessão|limite|dados|frete|etiqueta|cliente)\b/i.test(message)
    && !technical.test(message);

export function userFacingErrorMessage(status, path = '', serverMessage = '') {
    const area = operationContext(path);
    if (status === 0) return `Não foi possível conectar para consultar ${area}. Confira a internet e tente novamente. Antes de repetir uma ação financeira ou de envio, confira se ela já foi concluída.`;
    if (status === 401) return 'Sua sessão expirou. Entre novamente e retome a operação. Os dados já preenchidos nesta página foram mantidos.';
    if (status === 500) return `Não foi possível concluir a operação de ${area} agora. Tente novamente; se persistir, avise o suporte.`;
    if (status === 503) return `O serviço de ${area} está temporariamente indisponível. Aguarde e tente novamente sem repetir cobranças ou envios pendentes.`;
    if (readable(serverMessage)) return serverMessage;
    const messages = {
        400: `Os dados de ${area} não foram aceitos. Confira os campos e tente novamente.`,
        402: 'O pagamento não foi concluído. Confira a situação do pedido e a forma de pagamento antes de tentar novamente.',
        403: `Seu acesso não permite esta operação de ${area}. Confira suas permissões com a administração.`,
        404: `Não encontramos ${area} solicitado. Atualize a página e confira o registro.`,
        409: `Esta operação de ${area} conflita com uma alteração recente. Atualize os dados e confira antes de tentar novamente.`,
        422: `Os dados de ${area} precisam de correção. Confira os campos indicados e tente novamente.`,
        429: 'Houve muitas tentativas em pouco tempo. Aguarde alguns minutos antes de tentar novamente.',
    };
    return messages[status] || `Não foi possível concluir a operação de ${area}. Confira os dados e tente novamente.`;
}

export function userFacingError(error, path = '') {
    if (!error) return userFacingErrorMessage(0, path);
    const message = error.response?.data?.error || error.message;
    if (error.status == null && readable(message)) return message;
    return userFacingErrorMessage(Number(error.status) || 0, path, message);
}
