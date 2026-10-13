let sdkPromise;

export function loadMercadoPagoSdk(publicKey, win = window, doc = document, timeoutMs = 12000) {
    const sdkWindow = /** @type {any} */ (win);
    if (typeof publicKey !== 'string' || !publicKey.trim()) return Promise.reject(new Error('Formulário de cartão indisponível.'));
    if (sdkWindow.MercadoPago) return Promise.resolve(new sdkWindow.MercadoPago(publicKey, { locale: 'pt-BR' }));
    if (!sdkPromise) {
        sdkPromise = new Promise((resolve, reject) => {
            const script = doc.createElement('script');
            script.src = 'https://sdk.mercadopago.com/js/v2';
            script.async = true;
            const finish = error => {
                clearTimeout(timer);
                script.onload = script.onerror = null;
                if (error) { script.remove(); reject(error); }
                else resolve(sdkWindow.MercadoPago);
            };
            const timer = setTimeout(() => finish(new Error('O formulário demorou para carregar. Tente novamente.')), timeoutMs);
            script.onload = () => finish(sdkWindow.MercadoPago ? null : new Error('Formulário de cartão indisponível.'));
            script.onerror = () => finish(new Error('Não foi possível carregar o formulário de cartão.'));
            doc.head.appendChild(script);
        }).catch(error => { sdkPromise = null; throw error; });
    }
    return sdkPromise.then(MercadoPago => new MercadoPago(publicKey, { locale: 'pt-BR' }));
}

const VALIDATION_CAUSES = new Set(['incomplete_fields', 'missing_payment_information',
    'no_payment_method_for_provided_bin', 'payment_method_not_in_allowed_types',
    'payment_method_not_in_allowed_methods', 'unauthorized_payment_method',
    'no_installments_in_selected_range', 'no_issuers_found_for_card']);
const INITIALIZATION_CAUSES = new Set(['already_initialized', 'amount_is_not_number', 'container_not_found',
    'fields_setup_failed', 'fields_setup_failed_after_3_tries', 'incorrect_initialization',
    'invalid_sdk_instance', 'missing_amount_property', 'missing_container_id', 'missing_locale_property',
    'missing_required_callbacks', 'settings_empty', 'get_chunk_failed', 'no_chunk_path_provided', 'missing_site_property']);
const TOKEN_CAUSES = new Set(['card_token_creation_failed', 'secure_fields_card_token_creation_failed']);
const COMMUNICATION_CAUSES = new Set(['get_card_bin_payment_methods_failed', 'get_card_issuers_failed',
    'get_identification_types_failed', 'get_payment_installments_failed', 'get_payment_methods_failed']);

export function classifyCardBrickError(error) {
    // Do not retain SDK messages, field values, token details or raw responses.
    const cause = typeof error?.cause === 'string' && /^[a-z_]{1,80}$/.test(error.cause) ? error.cause : null;
    const category = VALIDATION_CAUSES.has(cause) ? 'validation' : TOKEN_CAUSES.has(cause) ? 'tokenization'
        : COMMUNICATION_CAUSES.has(cause) ? 'communication'
            : INITIALIZATION_CAUSES.has(cause) || error?.type === 'critical' ? 'initialization' : 'recoverable';
    return { category, cause, critical: category === 'initialization' };
}

// Cleanup also covers controllers resolving after timeout/navigation/StrictMode.
export function mountCardBrick({ publicKey, amount, isDebit, maxInstallments, containerId,
    onReady, onError, onSubmit, onIssue = (_issue) => {}, loadSdk = loadMercadoPagoSdk, timeoutMs = 20000 }) {
    let disposed = false;
    let ready = false;
    let controller;
    const fatal = () => {
        if (disposed) return;
        disposed = true;
        clearTimeout(timer);
        controller?.unmount?.();
        onError('Não foi possível carregar o formulário de cartão. Tente novamente.');
    };
    const handleError = event => {
        if (disposed) return;
        const issue = classifyCardBrickError(event);
        if (issue.critical) fatal();
        else onIssue(issue);
    };
    const timer = setTimeout(fatal, timeoutMs);
    const started = Promise.resolve().then(async () => {
        if (!(Number(amount) > 0)) throw new Error('Valor inválido');
        const mp = await loadSdk(publicKey);
        if (disposed) return;
        controller = await mp.bricks().create('cardPayment', containerId, {
            initialization: { amount: Number(amount) },
            customization: { paymentMethods: {
                types: { excluded: isDebit ? ['credit_card', 'prepaid_card'] : ['debit_card', 'prepaid_card'] },
                minInstallments: 1, maxInstallments: isDebit ? 1 : Math.min(6, Math.max(1, maxInstallments || 1)),
            }, visual: { style: { theme: 'default' } } },
            callbacks: { onReady: () => { if (!disposed && !ready) { ready = true; clearTimeout(timer); onReady(); } },
                onError: handleError, onSubmit: (form, additional) => {
                    if (disposed) return Promise.reject(new Error('Formulário encerrado.'));
                    return onSubmit(form, additional);
                } },
        });
        if (disposed) await controller?.unmount?.();
    }).catch(fatal);
    return { started, dispose: () => { disposed = true; clearTimeout(timer); controller?.unmount?.(); } };
}

export function safeChallengeUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.port
            && ['www.mercadopago.com.br', 'mercadopago.com.br'].includes(url.hostname)
            && url.pathname.startsWith('/auth/card/validation/') ? url.href : null;
    } catch { return null; }
}
