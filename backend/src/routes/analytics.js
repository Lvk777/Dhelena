import { Router } from 'express';
import { pool } from '../config/db.js';
import { auth, requireAdmin } from '../middleware.js';
import { analyticsLimiter } from '../middleware/rateLimiters.js';
import { logSecurityEvent } from '../middleware/securityLog.js';

const router = Router();

// ─── Allowlist of permitted event names ──────────────────────────
const ALLOWED_EVENTS = new Set([
    'page_view',
    'product_view',
    'add_to_cart',
    'remove_from_cart',
    'favorite',
    'begin_checkout',
    'sign_up',
    'login',
    'order_created',
    'search',
]);

// ─── Helper: parse device info from user-agent ───────────────────
function parseUserAgent(ua) {
    const uaLower = (ua || '').toLowerCase();
    let device_type = 'desktop';
    if (/mobile|android.*mobile|iphone|ipod/.test(uaLower)) device_type = 'mobile';
    else if (/ipad|tablet|android(?!.*mobile)/.test(uaLower)) device_type = 'tablet';

    let browser = 'other';
    if (/edg/.test(uaLower)) browser = 'edge';
    else if (/chrome|crios/.test(uaLower)) browser = 'chrome';
    else if (/safari/.test(uaLower)) browser = 'safari';
    else if (/firefox/.test(uaLower)) browser = 'firefox';

    let os = 'other';
    if (/windows/.test(uaLower)) os = 'windows';
    else if (/mac os|macintosh|iphone|ipad/.test(uaLower)) os = 'macos';
    else if (/android/.test(uaLower)) os = 'android';
    else if (/linux/.test(uaLower)) os = 'linux';

    return { device_type, browser, os };
}

// ─── Helper: parse UTM and referrer ──────────────────────────────
function parseSource(req) {
    const { utm_source, utm_medium, utm_campaign, referrer } = req.body;
    let source = utm_source || null;
    let medium = utm_medium || null;
    let campaign = utm_campaign || null;
    let ref = referrer || req.headers.referer || null;

    // Try to detect source from referrer if no UTM
    if (!source && ref) {
        try {
            const url = new URL(ref);
            const host = url.hostname.replace(/^www\./, '');

            // Classify internal/self-referrals as Direct
            const appHost = (req.headers.host || '').split(':')[0].replace(/^www\./, '');
            const isInternal = host === appHost
                || host.includes('localhost')
                || host.includes('base44')
                || host.includes('preview')
                || host.includes('railway')
                || host.includes('vercel')
                || host.includes('netlify');

            if (isInternal) {
                source = 'direto';
                medium = 'internal';
            } else if (host.includes('google')) { source = 'google'; if (!medium) medium = 'organic'; }
            else if (host.includes('instagram')) { source = 'instagram'; if (!medium) medium = 'social'; }
            else if (host.includes('facebook') || host.includes('fb.com')) { source = 'facebook'; if (!medium) medium = 'social'; }
            else if (host.includes('tiktok')) { source = 'tiktok'; if (!medium) medium = 'social'; }
            else if (host.includes('wa.me') || host.includes('whatsapp')) { source = 'whatsapp'; if (!medium) medium = 'referral'; }
            else source = host;
        } catch { /* not a URL */ }
    }

    // If still no source, it's direct traffic
    if (!source) {
        source = 'direto';
        medium = 'none';
    }

    return { source, medium, campaign, referrer: ref };
}

// ─── Helper: insert a single analytics event ───────────────────
async function insertEvent(req, evt) {
    const { event_name, page, product_id, session_id, utm_source, utm_medium, utm_campaign, referrer } = evt;

    if (!event_name || !ALLOWED_EVENTS.has(event_name)) {
        logSecurityEvent(req, 'suspicious_request', { reason: 'invalid_analytics_event', event_name });
        return false;
    }

    const safePage = (page || '').slice(0, 512);
    const safeProductId = product_id || null;
    const safeSessionId = (session_id || '').slice(0, 128);

    const ua = parseUserAgent(req.headers['user-agent']);
    // Prefer per-event UTM/referrer, fall back to request-level parse
    let source = utm_source || null;
    let medium = utm_medium || null;
    let campaign = utm_campaign || null;
    let ref = referrer || null;
    if (!source && !ref) {
        const parsed = parseSource(req);
        source = parsed.source;
        medium = parsed.medium;
        campaign = parsed.campaign;
        ref = parsed.referrer;
    }

    await pool.query(
        `INSERT INTO analytics_events
            (anonymous_session_id, user_id, event_name, page, product_id,
             source, medium, campaign, referrer, device_type, browser, os)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
            safeSessionId, req.user?.id || null, event_name, safePage, safeProductId,
            source, medium, campaign, (ref || '').slice(0, 512),
            ua.device_type, ua.browser, ua.os,
        ]
    );
    return true;
}

// ─── POST /api/analytics/events (public insert-only) ─────────────
// Accepts either a single event object or a batch: { events: [...] }
router.post('/analytics/events', analyticsLimiter, async (req, res, next) => {
    try {
        const events = req.body.events || [req.body];

        if (!Array.isArray(events) || events.length === 0) {
            return res.status(400).json({ error: 'Nenhum evento enviado' });
        }

        // Cap batch size to prevent abuse
        const batch = events.slice(0, 20);

        for (const evt of batch) {
            await insertEvent(req, evt);
        }

        res.status(201).json({ ok: true });
    } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// ADMIN ANALYTICS ENDPOINTS (read-only, admin only)
// ═════════════════════════════════════════════════════════════════

// ─── Helper: date range from period ───────────────────────────────
function getDateRange(period, customStart, customEnd) {
    const now = new Date();
    let start;
    switch (period) {
        case 'today': start = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
        case 'yesterday':
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
            return { start, end: new Date(now.getFullYear(), now.getMonth(), now.getDate()) };
        case '7d': start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
        case '30d': start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
        case 'this_month': start = new Date(now.getFullYear(), now.getMonth(), 1); break;
        case 'custom': start = customStart ? new Date(customStart) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            return { start, end: customEnd ? new Date(customEnd) : now };
        default: start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }
    return { start, end: now };
}

// ─── GET /api/analytics/overview ──────────────────────────────────
router.get('/analytics/overview', auth, requireAdmin, async (req, res, next) => {
    try {
        const { period = '7d', start: customStart, end: customEnd } = req.query;
        const { start, end } = getDateRange(period, customStart, customEnd);

        // Exclude admin/internal pages from analytics
        const pageExclude = `AND page NOT LIKE '/admin%' AND page NOT LIKE '/login%' AND page NOT LIKE '/api%' AND page NOT LIKE '/preview%' AND page NOT LIKE '/health%'`;
        const baseQuery = `WHERE created_at >= $1 AND created_at < $2 ${pageExclude}`;
        const params = [start, end];

        const [visitors, sessions, pageViews, signUps, productViews, cartAdds, checkouts, orders, revenue] = await Promise.all([
            pool.query(`SELECT COUNT(DISTINCT anonymous_session_id) as cnt FROM analytics_events ${baseQuery} AND event_name != 'page_view'`, params),
            pool.query(`SELECT COUNT(DISTINCT anonymous_session_id) as cnt FROM analytics_events ${baseQuery}`, params),
            pool.query(`SELECT COUNT(*) as cnt FROM analytics_events ${baseQuery} AND event_name = 'page_view'`, params),
            pool.query(`SELECT COUNT(*) as cnt FROM analytics_events ${baseQuery} AND event_name = 'sign_up'`, params),
            pool.query(`SELECT COUNT(*) as cnt FROM analytics_events ${baseQuery} AND event_name = 'product_view'`, params),
            pool.query(`SELECT COUNT(*) as cnt FROM analytics_events ${baseQuery} AND event_name = 'add_to_cart'`, params),
            pool.query(`SELECT COUNT(*) as cnt FROM analytics_events ${baseQuery} AND event_name = 'begin_checkout'`, params),
            pool.query(`SELECT COUNT(*) as cnt FROM analytics_events ${baseQuery} AND event_name = 'order_created'`, params),
            pool.query(`SELECT COALESCE(SUM(total), 0) as revenue FROM orders WHERE created_at >= $1 AND created_at < $2 AND status != 'cancelled'`, params),
        ]);

        // Previous period for comparison
        const duration = end.getTime() - start.getTime();
        const prevStart = new Date(start.getTime() - duration);
        const prevEnd = start;
        const prevParams = [prevStart, prevEnd];
        const prevBaseQuery = `WHERE created_at >= $1 AND created_at < $2 ${pageExclude}`;

        const [prevVisitors, prevOrders, prevRevenue, prevCartAdds, prevCheckouts, prevSignups, prevPageViews] = await Promise.all([
            pool.query(`SELECT COUNT(DISTINCT anonymous_session_id) as cnt FROM analytics_events ${prevBaseQuery} AND event_name != 'page_view'`, prevParams),
            pool.query(`SELECT COUNT(*) as cnt FROM analytics_events ${prevBaseQuery} AND event_name = 'order_created'`, prevParams),
            pool.query(`SELECT COALESCE(SUM(total), 0) as revenue FROM orders WHERE created_at >= $1 AND created_at < $2 AND status != 'cancelled'`, prevParams),
            pool.query(`SELECT COUNT(*) as cnt FROM analytics_events ${prevBaseQuery} AND event_name = 'add_to_cart'`, prevParams),
            pool.query(`SELECT COUNT(*) as cnt FROM analytics_events ${prevBaseQuery} AND event_name = 'begin_checkout'`, prevParams),
            pool.query(`SELECT COUNT(*) as cnt FROM analytics_events ${prevBaseQuery} AND event_name = 'sign_up'`, prevParams),
            pool.query(`SELECT COUNT(*) as cnt FROM analytics_events ${prevBaseQuery} AND event_name = 'page_view'`, prevParams),
        ]);

        const visitorCount = parseInt(visitors.rows[0].cnt);
        const orderCount = parseInt(orders.rows[0].cnt);
        const checkoutCount = parseInt(checkouts.rows[0].cnt);
        const revenueVal = parseFloat(revenue.rows[0].revenue);
        const prevVisitorCount = parseInt(prevVisitors.rows[0].cnt);
        const prevOrderCount = parseInt(prevOrders.rows[0].cnt);
        const prevRevenueVal = parseFloat(prevRevenue.rows[0].revenue);

        const calcChange = (curr, prev) => prev > 0 ? (((curr - prev) / prev) * 100).toFixed(1) : (curr > 0 ? '100.0' : '0.0');

        res.json({
            visitors: visitorCount,
            sessions: parseInt(sessions.rows[0].cnt),
            page_views: parseInt(pageViews.rows[0].cnt),
            new_signups: parseInt(signUps.rows[0].cnt),
            product_views: parseInt(productViews.rows[0].cnt),
            cart_adds: parseInt(cartAdds.rows[0].cnt),
            checkouts_started: checkoutCount,
            orders: orderCount,
            revenue: revenueVal,
            conversion_rate: visitorCount > 0 ? ((orderCount / visitorCount) * 100).toFixed(2) : '0.00',
            // Comparison with previous period
            comparison: {
                visitors: { current: visitorCount, previous: prevVisitorCount, change: calcChange(visitorCount, prevVisitorCount) },
                sessions: { current: parseInt(sessions.rows[0].cnt), previous: parseInt(prevVisitors.rows[0].cnt), change: calcChange(parseInt(sessions.rows[0].cnt), parseInt(prevVisitors.rows[0].cnt)) },
                page_views: { current: parseInt(pageViews.rows[0].cnt), previous: parseInt(prevPageViews.rows[0].cnt), change: calcChange(parseInt(pageViews.rows[0].cnt), parseInt(prevPageViews.rows[0].cnt)) },
                new_signups: { current: parseInt(signUps.rows[0].cnt), previous: parseInt(prevSignups.rows[0].cnt), change: calcChange(parseInt(signUps.rows[0].cnt), parseInt(prevSignups.rows[0].cnt)) },
                cart_adds: { current: parseInt(cartAdds.rows[0].cnt), previous: parseInt(prevCartAdds.rows[0].cnt), change: calcChange(parseInt(cartAdds.rows[0].cnt), parseInt(prevCartAdds.rows[0].cnt)) },
                checkouts: { current: checkoutCount, previous: parseInt(prevCheckouts.rows[0].cnt), change: calcChange(checkoutCount, parseInt(prevCheckouts.rows[0].cnt)) },
                orders: { current: orderCount, previous: prevOrderCount, change: calcChange(orderCount, prevOrderCount) },
                revenue: { current: revenueVal, previous: prevRevenueVal, change: calcChange(revenueVal, prevRevenueVal) },
            },
        });
    } catch (err) { next(err); }
});

// ─── GET /api/analytics/sources ───────────────────────────────────
router.get('/analytics/sources', auth, requireAdmin, async (req, res, next) => {
    try {
        const { period = '7d' } = req.query;
        const { start, end } = getDateRange(period);
        const { rows } = await pool.query(
            `SELECT COALESCE(source, 'direto') as source, COUNT(DISTINCT anonymous_session_id) as visitors
             FROM analytics_events WHERE created_at >= $1 AND created_at < $2
             GROUP BY source ORDER BY visitors DESC`,
            [start, end]
        );
        res.json(rows);
    } catch (err) { next(err); }
});

// ─── GET /api/analytics/devices ────────────────────────────────────
router.get('/analytics/devices', auth, requireAdmin, async (req, res, next) => {
    try {
        const { period = '7d' } = req.query;
        const { start, end } = getDateRange(period);
        const { rows } = await pool.query(
            `SELECT device_type, browser, os, COUNT(DISTINCT anonymous_session_id) as visitors
             FROM analytics_events WHERE created_at >= $1 AND created_at < $2
             GROUP BY device_type, browser, os ORDER BY visitors DESC`,
            [start, end]
        );
        res.json(rows);
    } catch (err) { next(err); }
});

// ─── GET /api/analytics/pages ─────────────────────────────────────
// Excludes admin/internal pages from results
router.get('/analytics/pages', auth, requireAdmin, async (req, res, next) => {
    try {
        const { period = '7d' } = req.query;
        const { start, end } = getDateRange(period);
        const { rows } = await pool.query(
            `SELECT page, COUNT(*) as views, COUNT(DISTINCT anonymous_session_id) as unique_visitors
             FROM analytics_events
             WHERE created_at >= $1 AND created_at < $2 AND event_name = 'page_view'
               AND page NOT LIKE '/admin%'
               AND page NOT LIKE '/login%'
               AND page NOT LIKE '/preview%'
               AND page NOT LIKE '/health%'
               AND page NOT LIKE '/api%'
               AND page NOT LIKE '/reset-password%'
               AND page NOT LIKE '/esqueci%'
               AND page NOT LIKE '/cadastro%'
             GROUP BY page ORDER BY views DESC LIMIT 20`,
            [start, end]
        );
        res.json(rows);
    } catch (err) { next(err); }
});

// ─── GET /api/analytics/campaigns ──────────────────────────────────
router.get('/analytics/campaigns', auth, requireAdmin, async (req, res, next) => {
    try {
        const { period = '7d' } = req.query;
        const { start, end } = getDateRange(period);
        const { rows } = await pool.query(
            `SELECT
                COALESCE(NULLIF(campaign, ''), '(sem campanha)') as campaign,
                COALESCE(NULLIF(source, ''), 'direto') as source,
                COUNT(DISTINCT anonymous_session_id) as sessions,
                COUNT(*) FILTER (WHERE event_name = 'add_to_cart') as add_to_cart,
                COUNT(*) FILTER (WHERE event_name = 'begin_checkout') as checkouts,
                COUNT(*) FILTER (WHERE event_name = 'order_created') as orders
             FROM analytics_events
             WHERE created_at >= $1 AND created_at < $2
               AND page NOT LIKE '/admin%' AND page NOT LIKE '/login%' AND page NOT LIKE '/api%'
             GROUP BY campaign, source
             ORDER BY sessions DESC LIMIT 20`,
            [start, end]
        );
        // Calculate revenue and conversion
        const result = await Promise.all(rows.map(async (r) => {
            const revResult = await pool.query(
                `SELECT COALESCE(SUM(total), 0) as revenue FROM orders
                 WHERE created_at >= $1 AND created_at < $2 AND status != 'cancelled'`,
                [start, end]
            );
            return {
                ...r,
                revenue: parseFloat(revResult.rows[0].revenue) || 0,
                conversion: r.sessions > 0 ? ((r.orders / r.sessions) * 100).toFixed(2) : '0.00',
            };
        }));
        res.json(result);
    } catch (err) { next(err); }
});

// ─── GET /api/analytics/customers ──────────────────────────────────
router.get('/analytics/customers', auth, requireAdmin, async (req, res, next) => {
    try {
        const { period = '7d' } = req.query;
        const { start, end } = getDateRange(period);

        const [total, newInPeriod, recurring, buyers, nonBuyers, avgTicket] = await Promise.all([
            pool.query('SELECT COUNT(*) as cnt FROM profiles WHERE role = $1', ['customer']),
            pool.query('SELECT COUNT(*) as cnt FROM profiles WHERE role = $1 AND created_at >= $2 AND created_at < $3', ['customer', start, end]),
            pool.query(`SELECT COUNT(DISTINCT user_id) as cnt FROM orders WHERE user_id IS NOT NULL AND status != 'cancelled' GROUP BY user_id HAVING COUNT(*) > 1`),
            pool.query(`SELECT COUNT(DISTINCT user_id) as cnt FROM orders WHERE user_id IS NOT NULL AND status != 'cancelled' AND created_at >= $1 AND created_at < $2`, [start, end]),
            pool.query(`SELECT COUNT(*) as cnt FROM profiles WHERE role = 'customer' AND id NOT IN (SELECT DISTINCT user_id FROM orders WHERE user_id IS NOT NULL)`),
            pool.query(`SELECT COALESCE(AVG(total), 0) as avg FROM orders WHERE status != 'cancelled' AND created_at >= $1 AND created_at < $2`, [start, end]),
        ]);

        // Customer growth over time (daily)
        const growth = await pool.query(
            `SELECT DATE(created_at) as date, COUNT(*) as new_customers
             FROM profiles WHERE role = 'customer' AND created_at >= $1 AND created_at < $2
             GROUP BY DATE(created_at) ORDER BY date`,
            [start, end]
        );

        res.json({
            total_customers: parseInt(total.rows[0].cnt),
            new_in_period: parseInt(newInPeriod.rows[0].cnt),
            recurring_customers: recurring.rows.length,
            buyers_in_period: parseInt(buyers.rows[0].cnt),
            non_buyers: parseInt(nonBuyers.rows[0].cnt),
            avg_ticket: parseFloat(avgTicket.rows[0].avg),
            growth: growth.rows,
        });
    } catch (err) { next(err); }
});

// ─── GET /api/analytics/geo ────────────────────────────────────────
router.get('/analytics/geo', auth, requireAdmin, async (req, res, next) => {
    try {
        const { period = '7d' } = req.query;
        const { start, end } = getDateRange(period);

        // Since we don't store geo on analytics_events, return empty for now
        // This can be extended when geo is captured
        res.json({ top_cities: [], top_states: [], top_countries: [] });
    } catch (err) { next(err); }
});

// ─── GET /api/analytics/funnel ────────────────────────────────────
router.get('/analytics/funnel', auth, requireAdmin, async (req, res, next) => {
    try {
        const { period = '7d' } = req.query;
        const { start, end } = getDateRange(period);
        const { rows } = await pool.query(
            `SELECT event_name, COUNT(DISTINCT anonymous_session_id) as unique_users
             FROM analytics_events WHERE created_at >= $1 AND created_at < $2
               AND event_name IN ('page_view','product_view','add_to_cart','begin_checkout','sign_up','order_created')
             GROUP BY event_name ORDER BY MIN(created_at)`,
            [start, end]
        );
        res.json(rows);
    } catch (err) { next(err); }
});

// ─── GET /api/analytics/products ──────────────────────────────────
router.get('/analytics/products', auth, requireAdmin, async (req, res, next) => {
    try {
        const { period = '7d' } = req.query;
        const { start, end } = getDateRange(period);
        const [viewed, cartAdded] = await Promise.all([
            pool.query(
                `SELECT ae.product_id, p.name, COUNT(*) as views
                 FROM analytics_events ae LEFT JOIN products p ON ae.product_id = p.id
                 WHERE ae.created_at >= $1 AND ae.created_at < $2 AND ae.event_name = 'product_view'
                 GROUP BY ae.product_id, p.name ORDER BY views DESC LIMIT 10`,
                [start, end]
            ),
            pool.query(
                `SELECT ae.product_id, p.name, COUNT(*) as adds
                 FROM analytics_events ae LEFT JOIN products p ON ae.product_id = p.id
                 WHERE ae.created_at >= $1 AND ae.created_at < $2 AND ae.event_name = 'add_to_cart'
                 GROUP BY ae.product_id, p.name ORDER BY adds DESC LIMIT 10`,
                [start, end]
            ),
        ]);
        res.json({ most_viewed: viewed.rows, most_added_to_cart: cartAdded.rows });
    } catch (err) { next(err); }
});

export default router;
