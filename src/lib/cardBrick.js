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

// Cleanup also covers controllers resolving after timeout/navigation/StrictMode.
export function mountCardBrick({ publicKey, amount, isDebit, maxInstallments, containerId,
    onReady, onError, onSubmit, loadSdk = loadMercadoPagoSdk, timeoutMs = 20000 }) {
    let disposed = false;
    let controller;
    const error = () => {
        if (disposed) return;
        disposed = true;
        clearTimeout(timer);
        controller?.unmount?.();
        onError('Não foi possível carregar o formulário de cartão. Tente novamente.');
    };
    const timer = setTimeout(error, timeoutMs);
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
            callbacks: { onReady: () => { if (!disposed) { clearTimeout(timer); onReady(); } },
                onError: error, onSubmit: (form, additional) => {
                    if (disposed) return Promise.reject(new Error('Formulário encerrado.'));
                    return onSubmit(form, additional);
                } },
        });
        if (disposed) await controller?.unmount?.();
    }).catch(error);
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
