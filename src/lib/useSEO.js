import { useEffect } from 'react';

/**
 * Dynamic SEO hook — updates document title and meta tags.
 * Call from any page to set page-specific metadata.
 *
 * @param {object} opts
 * @param {string} opts.title — page title (without site suffix)
 * @param {string} opts.description — meta description
 * @param {string} [opts.image] — OG image URL
 * @param {string} [opts.url] — canonical URL path (e.g. "/produto/vestido-helena")
 */
export default function useSEO({ title, description, image, url } = {}) {
    useEffect(() => {
        const siteName = "D'Helenas";
        const fullTitle = title ? `${title} — ${siteName}` : `${siteName} — Moda que conecta histórias`;
        const desc = description || "Moda feminina e acessórios. Método Ponte: moda que conecta histórias, mulheres e gerações.";
        const ogImage = image || "https://huxwnoxkqtmpvxrapmyz.supabase.co/storage/v1/object/public/store-assets/banners/1789029748596-1rl93n.webp";
        const canonical = url ? `${window.location.origin}${url}` : window.location.href;

        // Title
        document.title = fullTitle;

        // Helper to set or create meta tag
        const setMeta = (selector, attr, content) => {
            let el = document.querySelector(selector);
            if (!el) {
                el = document.createElement('meta');
                const [attrName, attrValue] = selector.replace(/[[\]"]/g, '').split('=');
                el.setAttribute(attrName, attrValue);
                document.head.appendChild(el);
            }
            el.setAttribute(attr, content);
        };

        // Standard meta
        setMeta('meta[name="description"]', 'content', desc);

        // Open Graph
        setMeta('meta[property="og:title"]', 'content', fullTitle);
        setMeta('meta[property="og:description"]', 'content', desc);
        setMeta('meta[property="og:image"]', 'content', ogImage);
        setMeta('meta[property="og:url"]', 'content', canonical);

        // Twitter
        setMeta('meta[name="twitter:title"]', 'content', fullTitle);
        setMeta('meta[name="twitter:description"]', 'content', desc);
        setMeta('meta[name="twitter:image"]', 'content', ogImage);

        // Canonical link
        let link = document.querySelector('link[rel="canonical"]');
        if (!link) {
            link = document.createElement('link');
            link.setAttribute('rel', 'canonical');
            document.head.appendChild(link);
        }
        link.setAttribute('href', canonical);

        return () => {
            // Reset to defaults on unmount
            document.title = `${siteName} — Moda que conecta histórias`;
        };
    }, [title, description, image, url]);
}
