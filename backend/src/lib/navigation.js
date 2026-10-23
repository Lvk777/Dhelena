const SITE_ORIGIN = 'https://dhelenas.com';
const UNSAFE = /[\\\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060\u2066-\u2069\ufeff]/;

export function httpsOrigin(value) {
    if (typeof value !== 'string' || UNSAFE.test(value) || value !== value.trim()) return null;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/'
            ? url.origin : null;
    } catch { return null; }
}

// Browser-independent: shared by the CMS API and the public React link sink.
export function safeNavigation(value, { origin = SITE_ORIGIN, allowedOrigins = [] } = {}) {
    if (typeof value !== 'string' || !value || value.length > 2048 || value !== value.trim()) return null;
    let decoded = value;
    try {
        for (let i = 0; i < 4; i++) {
            if (UNSAFE.test(decoded) || decoded.startsWith('//')) return null;
            const next = decodeURIComponent(decoded);
            if (next === decoded) break;
            decoded = next;
            if (i === 3) return null;
        }
        const base = new URL(origin);
        const url = new URL(value, base);
        const decodedUrl = new URL(decoded, base);
        if (url.origin !== decodedUrl.origin) return null;
        if (url.username || url.password || decodedUrl.username || decodedUrl.password || decodedUrl.pathname.startsWith('//')) return null;
        if (url.origin === base.origin) {
            if (!(value.startsWith('/') || value.startsWith('#') || value.startsWith(base.origin + '/'))) return null;
            if (url.pathname.startsWith('//')) return null;
            return { href: url.pathname + url.search + url.hash, external: false };
        }
        const allowed = Array.isArray(allowedOrigins) ? allowedOrigins.map(httpsOrigin).filter(Boolean) : [];
        if (url.protocol !== 'https:' || !value.startsWith('https://') || !allowed.includes(url.origin)) return null;
        return { href: url.href, external: true };
    } catch { return null; }
}

export function instagramLink(value) {
    if (typeof value !== 'string' || !value) return null;
    const handle = value.startsWith('@') ? value.slice(1) : value;
    if (/^[A-Za-z0-9._]{1,30}$/.test(handle)) return `https://www.instagram.com/${handle}/`;
    const link = safeNavigation(value, { allowedOrigins: ['https://instagram.com', 'https://www.instagram.com'] });
    return link?.external && new URL(link.href).pathname !== '/' ? link.href : null;
}

export function whatsappLink(value) {
    if (typeof value !== 'string' || !value) return null;
    if (value.startsWith('https://')) {
        const link = safeNavigation(value, { allowedOrigins: ['https://wa.me'] });
        if (!link?.external || !/^\/[1-9][0-9]{9,14}$/.test(new URL(link.href).pathname) || /^\/550+$/.test(new URL(link.href).pathname)) return null;
        return link.href;
    }
    if (!/^[+()\d\s-]+$/.test(value)) return null;
    let digits = value.replace(/\D/g, '');
    if ([10, 11].includes(digits.length)) digits = '55' + digits;
    return /^[1-9][0-9]{9,14}$/.test(digits) && !/^550+$/.test(digits) ? `https://wa.me/${digits}` : null;
}

export function validEmail(value) {
    if (typeof value !== 'string' || value.length > 254) return false;
    const parts = value.split('@');
    if (parts.length !== 2) return false;
    const [local, domain] = parts;
    return local.length <= 64 && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..') &&
        /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) && /^[A-Za-z]{2,}$/.test(domain.split('.').at(-1) || '') &&
        domain.includes('.') && domain.split('.').every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label));
}

export function validCnpjFormat(value) {
    if (typeof value !== 'string') return false;
    const compact = value.replace(/[.\-/\s]/g, '').toUpperCase();
    return /^[A-Z0-9]{12}[0-9]{2}$/.test(compact) && !/^(\d)\1{13}$/.test(compact) && compact !== '00000000000100';
}

export function safeMelhorEnvioAuthorizationUrl(mode, value) {
    if (!['sandbox', 'production'].includes(mode)) return null;
    const origin = mode === 'sandbox' ? 'https://sandbox.melhorenvio.com.br' : 'https://melhorenvio.com.br';
    const link = safeNavigation(value, { allowedOrigins: [origin] });
    return link?.external && new URL(link.href).pathname === '/oauth/authorize' ? link.href : null;
}
