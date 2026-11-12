// Same narrow browser allowlist, verified by the shared contract tests.
export function safeChallengeUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.port
            && ['www.mercadopago.com.br', 'mercadopago.com.br'].includes(url.hostname)
            && url.pathname.startsWith('/auth/card/validation/') ? url.href : null;
    } catch { return null; }
}
