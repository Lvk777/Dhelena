export function resolveApiBase(configuredUrl, production = false) {
    if (!configuredUrl) {
        if (production) throw new Error('VITE_API_URL é obrigatória em produção; a API não pode usar o fallback /api do SPA.');
        return '/api';
    }
    const url = new URL(configuredUrl);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
        throw new Error('VITE_API_URL deve usar HTTPS, exceto em desenvolvimento local.');
    }
    if (url.search || url.hash) throw new Error('VITE_API_URL não deve conter query ou fragmento.');
    const pathname = url.pathname.replace(/\/+$/, '');
    if (pathname && pathname !== '/api') throw new Error('VITE_API_URL deve apontar para a origem ou para /api.');
    return `${url.origin}/api`;
}

export function apiUrl(base, path) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('/api/')) {
        throw new Error('Rota de API inválida');
    }
    return `${base}${path}`;
}
