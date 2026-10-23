// ─── Analytics tracking client ─────────────────────────────────────
// Lightweight frontend tracker that sends events to /api/analytics/events
// Optional tracker; activation requires an explicit privacy-reviewed build opt-in.
import { resolveApiBase, apiUrl } from '../api/apiBase.js';

const API_BASE = resolveApiBase(import.meta.env.VITE_API_URL, import.meta.env.PROD);
// No new collection is activated by publishing this preparation sprint.
const ENABLED = import.meta.env.VITE_ANALYTICS_ENABLED === 'true';

const SESSION_KEY = 'dh_session_id';
const ALLOWED_EVENTS = [
    'page_view', 'product_view', 'add_to_cart', 'remove_from_cart',
    'favorite', 'begin_checkout', 'sign_up', 'login', 'order_created', 'search',
];

function getSessionId() {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
        id = 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
}

function parseUTM() {
    const params = new URLSearchParams(window.location.search);
    return {
        utm_source: params.get('utm_source') || '',
        utm_medium: params.get('utm_medium') || '',
        utm_campaign: params.get('utm_campaign') || '',
        referrer: (() => { try { return new URL(document.referrer).origin; } catch { return ''; } })(),
    };
}

let queue = [];
let flushTimer = null;

function flush() {
    if (queue.length === 0) return;
    const events = [...queue];
    queue = [];

    fetch(apiUrl(API_BASE, '/analytics/events'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }),
    }).catch(() => {});
}

export function track(eventName, data = {}) {
    if (!ENABLED) return;
    if (!ALLOWED_EVENTS.includes(eventName)) return;

    const utm = parseUTM();
    queue.push({
        event_name: eventName,
        session_id: getSessionId(),
        page: window.location.pathname,
        ...utm,
        ...data,
    });

    // Batch events — flush every 3 seconds or immediately if 10+ events
    if (queue.length >= 10) {
        clearTimeout(flushTimer);
        flush();
    } else if (!flushTimer) {
        flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 3000);
    }
}

// ─── Auto page view tracking ──────────────────────────────────────
let lastPath = null;
export function trackPageView() {
    const path = window.location.pathname;
    if (path === lastPath) return;
    lastPath = path;
    track('page_view');
}

// ─── Flush on page unload ─────────────────────────────────────────
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', flush);
}
