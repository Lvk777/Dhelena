import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// ─── Helper: key generator (trusted proxy IP + optional user) ─────
const keyGenerator = (req) => {
    // Never read X-Forwarded-For directly. Express applies the constrained
    // proxy rule before deriving req.ip, but that value is only authoritative
    // after infrastructure blocks direct access to the Railway origin.
    const ip = ipKeyGenerator(req.ip || req.socket?.remoteAddress || 'unknown');
    return req.user?.id ? `${ip}:${req.user.id}` : ip;
};

// ─── Global limiter (all endpoints) ───────────────────────────────
export const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 300, // 300 requests per 15 min per IP
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    handler: (req, res) => {
        logSecurityEvent(req, 'rate_limit_triggered', { limiter: 'global' });
        res.status(429).json({ error: 'Muitas requisições. Tente novamente em alguns minutos.' });
    },
});

// ─── Auth: login (brute force protection) ────────────────────────
export const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 5, // 5 attempts per 15 min
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    handler: (req, res) => {
        logSecurityEvent(req, 'rate_limit_triggered', { limiter: 'login', email: req.body?.email });
        res.status(429).json({ error: 'Muitas tentativas de login. Aguarde 15 minutos.' });
    },
});

// ─── Auth: register ──────────────────────────────────────────────
export const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 registrations per hour per IP
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    handler: (req, res) => {
        logSecurityEvent(req, 'rate_limit_triggered', { limiter: 'register' });
        res.status(429).json({ error: 'Muitas tentativas de cadastro. Aguarde uma hora.' });
    },
});

// ─── Auth: forgot password ───────────────────────────────────────
export const forgotPasswordLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 requests per hour per IP
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    handler: (req, res) => {
        logSecurityEvent(req, 'rate_limit_triggered', { limiter: 'forgot_password' });
        res.status(429).json({ error: 'Muitas solicitações de recuperação. Aguarde uma hora.' });
    },
});

// ─── Contact form ────────────────────────────────────────────────
export const contactLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 5, // 5 messages per 15 min per IP
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    handler: (req, res) => {
        logSecurityEvent(req, 'rate_limit_triggered', { limiter: 'contact' });
        res.status(429).json({ error: 'Muitas mensagens enviadas. Aguarde alguns minutos.' });
    },
});

// ─── Coupon validation (prevent enumeration) ─────────────────────
export const couponLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 20, // 20 attempts per 15 min per IP
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    handler: (req, res) => {
        logSecurityEvent(req, 'rate_limit_triggered', { limiter: 'coupon' });
        res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
    },
});

// ─── Order creation ──────────────────────────────────────────────
export const orderLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 min
    max: 10, // 10 orders per 10 min per IP+user
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    handler: (req, res) => {
        logSecurityEvent(req, 'rate_limit_triggered', { limiter: 'order' });
        res.status(429).json({ error: 'Muitos pedidos em sequência. Aguarde alguns minutos.' });
    },
});

// ─── Search ──────────────────────────────────────────────────────
export const searchLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 min
    max: 30, // 30 searches per minute
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    handler: (req, res) => {
        logSecurityEvent(req, 'rate_limit_triggered', { limiter: 'search' });
        res.status(429).json({ error: 'Busca rápida demais. Aguarde um momento.' });
    },
});

// ─── Upload ──────────────────────────────────────────────────────
export const uploadLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 min
    max: 20, // 20 uploads per 10 min
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    handler: (req, res) => {
        logSecurityEvent(req, 'rate_limit_triggered', { limiter: 'upload' });
        res.status(429).json({ error: 'Muitos uploads. Aguarde alguns minutos.' });
    },
});

// ─── Analytics events (insert) ──────────────────────────────────
export const analyticsLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 min
    max: 60, // 60 events per minute per IP (page views, clicks, etc.)
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    handler: (req, res) => {
        logSecurityEvent(req, 'rate_limit_triggered', { limiter: 'analytics' });
        res.status(429).json({ error: 'Muitos eventos. Aguarde um momento.' });
    },
});

// ─── Admin actions (stricter) ───────────────────────────────────
export const adminActionLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 min
    max: 100, // 100 admin actions per 5 min
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    handler: (req, res) => {
        logSecurityEvent(req, 'rate_limit_triggered', { limiter: 'admin_action' });
        res.status(429).json({ error: 'Muitas operações administrativas. Aguarde alguns minutos.' });
    },
});

// ─── Inline import to avoid circular dependency ─────────────────
import { logSecurityEvent } from './securityLog.js';
