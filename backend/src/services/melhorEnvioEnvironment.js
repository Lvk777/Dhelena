export const MELHOR_ENVIO_USER_AGENT_FALLBACK = "D'Helenas (atendimento@dhelenas.com.br)";
export const MELHOR_ENVIO_OAUTH_SCOPES = 'shipping-calculate cart-read cart-write shipping-checkout shipping-generate shipping-print shipping-tracking users-read';

export function melhorEnvioUserAgent(mode) {
    const configured = process.env[`MELHOR_ENVIO_${mode.toUpperCase()}_USER_AGENT`] || process.env.MELHOR_ENVIO_USER_AGENT;
    if (configured && !/[\r\n\u0000]/.test(configured)) return configured;
    if (mode === 'sandbox') return MELHOR_ENVIO_USER_AGENT_FALLBACK;
    throw Object.assign(new Error('Contato técnico Melhor Envio de produção não configurado.'), { status: 503 });
}

export function melhorEnvioEnvironment(mode) {
    if (!['sandbox', 'production'].includes(mode)) {
        throw Object.assign(new Error('Ambiente Melhor Envio inválido.'), { status: 503 });
    }
    return {
        mode,
        base: mode === 'sandbox' ? 'https://sandbox.melhorenvio.com.br' : 'https://melhorenvio.com.br',
        tokenKey: `melhor_envio_${mode}_oauth`,
        statePrefix: mode === 'sandbox' ? 'melhor_envio_oauth_state_' : 'melhor_envio_production_oauth_state_',
        codePrefix: mode === 'sandbox' ? 'melhor_envio_oauth_code_' : 'melhor_envio_production_oauth_code_',
        route: mode === 'sandbox' ? '/api/integrations/melhor-envio/oauth' : '/api/integrations/melhor-envio/oauth/production',
    };
}

export function melhorEnvioOAuthSettings(mode) {
    if (!['sandbox', 'production'].includes(mode)) return null;
    const prefix = `MELHOR_ENVIO_${mode.toUpperCase()}_`;
    // Legacy variables belong exclusively to Sandbox, never to production.
    const value = name => process.env[prefix + name] || (mode === 'sandbox' ? process.env['MELHOR_ENVIO_' + name] : undefined);
    const clientId = value('CLIENT_ID'), clientSecret = value('CLIENT_SECRET'), redirectUri = value('REDIRECT_URI');
    if (!clientId || !clientSecret || !redirectUri || !process.env.INTEGRATION_ENCRYPTION_KEY) return null;
    try {
        if (mode === 'production') melhorEnvioUserAgent(mode);
        const uri = new URL(redirectUri);
        const environment = melhorEnvioEnvironment(mode);
        if (uri.username || uri.password || uri.search || uri.hash || uri.pathname !== `${environment.route}/callback`) return null;
        if (uri.protocol !== 'https:' && (mode === 'production' || process.env.NODE_ENV === 'production')) return null;
        if (!['http:', 'https:'].includes(uri.protocol)) return null;
        return { ...environment, clientId, clientSecret, redirectUri };
    } catch { return null; }
}

export function isManagedMelhorEnvioConfig(key) {
    return typeof key === 'string' && (/^melhor_envio_(?:sandbox|production)_oauth(?:_|$)/.test(key) || key.startsWith('melhor_envio_oauth_'));
}
