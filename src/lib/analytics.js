// ─── Analytics tracking client ─────────────────────────────────────
// Lightweight frontend tracker that sends events to /api/analytics/events
// LGPD-compliant: no personal data stored beyond anonymous session ID

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
        referrer: document.referrer || '',
    };
}

let queue = [];
let flushTimer = null;

function flush() {
    if (queue.length === 0) return;
    const events = [...queue];
    queue = [];

    fetch('/api/analytics/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }),
    }).catch(() => {});
}

export function track(eventName, data = {}) {
    if (!ALLOWED_EVENTS.includes(eventName)) return;

    const utm = parseUTM();
    queue.push({
        event_name: eventName,
        session_id: getSessionId(),
        page: window.location.pathname + window.location.search,
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
