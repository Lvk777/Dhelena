/**
 * API client — dual-mode (Supabase Auth + Storage in production, Express JWT + local in dev).
 * Maintains the same interface the frontend expects (entities, auth, functions, integrations, app).
 */

import { supabase } from './supabaseClient.js';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const TOKEN_KEY = 'dhelena_access_token';
const USER_KEY = 'dhelena_auth_user';

// ─── Token & user storage ──────────────────────────────────────────
function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(token) { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); }
function getStoredUser() { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } }
function setStoredUser(user) { user ? localStorage.setItem(USER_KEY, JSON.stringify(user)) : localStorage.removeItem(USER_KEY); }

// ─── Sync Supabase session → localStorage token ────────────────────
// Only sync when supabase has a session; don't clear JWT token on sign-out events
if (supabase) {
    supabase.auth.onAuthStateChange((event, session) => {
        if (session?.access_token) {
            setToken(session.access_token);
        }
        // Don't clear JWT token on SIGNED_OUT — the JWT auth path is independent
    });
}

// ─── Core fetch wrapper ────────────────────────────────────────────
async function apiFetch(path, options = {}) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

    if (res.status === 401) {
        setToken(null);
        setStoredUser(null);
        const err = new Error('Não autenticado');
        err.status = 401;
        throw err;
    }

    if (!res.ok) {
        const error = await res.json().catch(() => ({ error: res.statusText }));
        const err = new Error(error.error || error.message || 'Request failed');
        err.status = res.status;
        err.response = { data: error };
        throw err;
    }

    return res.json();
}

// ─── Entity → endpoint mapping ─────────────────────────────────────
const ENTITY_MAP = {
    Product: 'products',
    Category: 'categories',
    Collection: 'collections',
    Banner: 'banners',
    Setting: 'settings',
    Order: 'orders',
    Coupon: 'coupons',
    Address: 'addresses',
    Favorite: 'favorites',
    StockMovement: 'stock-movements',
    AuditLog: 'audit-logs',
    User: 'users',
    NotificationLog: 'notifications',
};

// ─── Entity CRUD factory ───────────────────────────────────────────
function makeEntity(name) {
    const endpoint = ENTITY_MAP[name] || name.toLowerCase();
    return {
        async list(sortField, limit) {
            const params = new URLSearchParams();
            if (sortField) params.set('sort', sortField);
            if (limit) params.set('limit', limit);
            return apiFetch(`/${endpoint}?${params}`);
        },
        async filter(predicate, sortField, limit) {
            const params = new URLSearchParams();
            if (predicate && typeof predicate === 'object') {
                for (const [k, v] of Object.entries(predicate)) {
                    if (v !== null && typeof v === 'object') params.set(k, JSON.stringify(v));
                    else params.set(k, v);
                }
            }
            if (sortField) params.set('sort', sortField);
            if (limit) params.set('limit', limit);
            return apiFetch(`/${endpoint}?${params}`);
        },
        async get(id) {
            return apiFetch(`/${endpoint}/${id}`);
        },
        async create(data) {
            return apiFetch(`/${endpoint}`, { method: 'POST', body: JSON.stringify(data) });
        },
        async bulkCreate(items) {
            return apiFetch(`/${endpoint}/bulk`, { method: 'POST', body: JSON.stringify({ items }) });
        },
        async update(id, data) {
            return apiFetch(`/${endpoint}/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
        },
        async delete(id) {
            return apiFetch(`/${endpoint}/${id}`, { method: 'DELETE' });
        },
    };
}

// ─── Auth (Supabase when configured, Express JWT fallback) ──────────
const auth = {
    async me() {
        // When supabase is configured, try its session first;
        // fall back to JWT token from localStorage if no supabase session
        if (supabase) {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.access_token) {
                setToken(session.access_token);
            }
        }
        // If no supabase session (or supabase not configured), check JWT token
        const token = getToken();
        if (!token) {
            const err = new Error('Not authenticated');
            err.status = 401;
            throw err;
        }
        try {
            const user = await apiFetch('/auth/me');
            setStoredUser(user);
            return user;
        } catch (err) {
            if (err.status === 401) {
                setToken(null);
                setStoredUser(null);
            }
            throw err;
        }
    },
    isAuthenticated() { return !!getToken(); },
    getToken() { return getToken(); },
    setToken(token) { setToken(token); },
    async loginViaEmailPassword(email, password, returnTo = '') {
        if (supabase) {
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;
            setToken(data.session.access_token);
            const user = await apiFetch('/auth/me');
            setStoredUser(user);
            return user;
        }
        const data = await apiFetch('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
        });
        setToken(data.token);
        setStoredUser(data.user);
        return data.user;
    },
    async loginAsAdmin() {
        window.location.href = '/login?returnTo=/admin';
    },
    async register({ email, password, full_name }) {
        if (supabase) {
            const { data, error } = await supabase.auth.signUp({
                email, password,
                options: { data: { full_name } },
            });
            if (error) throw error;
            if (data.session) {
                setToken(data.session.access_token);
                const user = await apiFetch('/auth/me');
                setStoredUser(user);
                return user;
            }
            return { email, pending_verification: true };
        }
        const data = await apiFetch('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ email, password, full_name }),
        });
        setToken(data.token);
        setStoredUser(data.user);
        return data.user;
    },
    async verifyOtp() { throw new Error('OTP não implementado'); },
    async resendOtp() { return {}; },
    async updateMe(data) {
        const user = await apiFetch('/auth/me', { method: 'PATCH', body: JSON.stringify(data) });
        setStoredUser(user);
        return user;
    },
    async resetPasswordRequest(email) {
        if (supabase) {
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/reset-password`,
            });
            if (error) throw error;
            return {};
        }
        return apiFetch('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
    },
    async resetPassword({ resetToken, newPassword }) {
        if (supabase) {
            const { error } = await supabase.auth.updateUser({ password: newPassword });
            if (error) throw error;
            return { success: true };
        }
        return apiFetch('/auth/reset-password', { method: 'POST', body: JSON.stringify({ resetToken, newPassword }) });
    },
    logout(redirectUrl) {
        if (supabase) supabase.auth.signOut();
        setToken(null);
        setStoredUser(null);
        if (redirectUrl) window.location.href = redirectUrl;
    },
    redirectToLogin(returnTo) {
        window.location.href = '/login' + (returnTo ? '?returnTo=' + encodeURIComponent(returnTo) : '');
    },
    loginWithProvider(provider, returnTo) {
        if (supabase) {
            supabase.auth.signInWithOAuth({
                provider,
                options: { redirectTo: returnTo || window.location.href },
            });
        } else {
            window.location.href = '/login' + (returnTo ? '?returnTo=' + encodeURIComponent(returnTo) : '');
        }
    },
};

// ─── Backend functions ─────────────────────────────────────────────
const functions = {
    async invoke(name, args) {
        switch (name) {
            case 'placeOrder':
                return apiFetch('/orders', { method: 'POST', body: JSON.stringify(args) });
            case 'cancelOrder':
                return apiFetch(`/orders/${args.orderId || args.id}`, { method: 'DELETE' });
            case 'validateCoupon':
                return apiFetch('/coupons/validate', { method: 'POST', body: JSON.stringify(args) });
            case 'adjustStock':
                return apiFetch('/stock/adjust', { method: 'POST', body: JSON.stringify(args) });
            case 'updateOrderStatus':
                return apiFetch(`/orders/${args.orderId || args.id}/status`, {
                    method: 'PATCH',
                    body: JSON.stringify({ status: args.status, ...args }),
                });
            case 'logAdminAction':
                return {};
            default:
                throw new Error(`Unknown function: ${name}`);
        }
    },
};

// ─── File upload (via backend → Supabase Storage with service role key) ─
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 10 * 1024 * 1024;

const integrations = {
    Core: {
        async UploadFile({ file, folder = 'misc' }) {
            // Validate file type
            if (!ALLOWED_TYPES.includes(file.type)) {
                throw new Error('Formato não permitido. Use JPEG, PNG ou WEBP.');
            }
            if (file.size > MAX_SIZE) {
                throw new Error('Arquivo muito grande. Máximo 10MB.');
            }

            // Always upload via backend (uses Supabase service role key securely)
            const token = getToken();
            const formData = new FormData();
            formData.append('file', file);
            formData.append('folder', folder);

            const res = await fetch(`${API_BASE}/upload`, {
                method: 'POST',
                headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                body: formData,
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Não foi possível enviar a imagem.');
            }

            return res.json();
        },
    },
};

// ─── App settings ──────────────────────────────────────────────────
const app = {
    async getPublicSettings() {
        try {
            const settings = await apiFetch('/settings?is_public=true');
            const general = settings.find(s => s.key === 'general');
            return {
                id: 'api',
                public_settings: { store_name: general?.value?.store_name || "D'Helenas" },
            };
        } catch {
            return { id: 'local', public_settings: { store_name: "D'Helenas" } };
        }
    },
};

// ─── Entity registry ───────────────────────────────────────────────
const entities = new Proxy({}, {
    get(_, name) {
        return makeEntity(name);
    },
});

// ─── Custom analytics endpoints ───────────────────────────────────
const custom = {
    analyticsOverview: ({ period, start, end }) => apiFetch(`/analytics/overview?period=${period || '7d'}${start ? `&start=${start}` : ''}${end ? `&end=${end}` : ''}`),
    analyticsSources: ({ period }) => apiFetch(`/analytics/sources?period=${period || '7d'}`),
    analyticsDevices: ({ period }) => apiFetch(`/analytics/devices?period=${period || '7d'}`),
    analyticsPages: ({ period }) => apiFetch(`/analytics/pages?period=${period || '7d'}`),
    analyticsFunnel: ({ period }) => apiFetch(`/analytics/funnel?period=${period || '7d'}`),
    analyticsProducts: ({ period }) => apiFetch(`/analytics/products?period=${period || '7d'}`),
    analyticsCampaigns: ({ period }) => apiFetch(`/analytics/campaigns?period=${period || '7d'}`),
    analyticsCustomers: ({ period }) => apiFetch(`/analytics/customers?period=${period || '7d'}`),
    analyticsGeo: ({ period }) => apiFetch(`/analytics/geo?period=${period || '7d'}`),
    // Security endpoints
    securityStatus: () => apiFetch('/security/status'),
    setup2FA: () => apiFetch('/security/setup-2fa', { method: 'POST' }),
    verify2FA: ({ code }) => apiFetch('/security/verify-2fa', { method: 'POST', body: JSON.stringify({ code }) }),
    disable2FA: () => apiFetch('/security/disable-2fa', { method: 'POST' }),
    updateSecuritySetting: (data) => apiFetch('/security/settings', { method: 'PATCH', body: JSON.stringify(data) }),
    // Login history
    loginHistory: (queryString) => apiFetch(`/login-history?${queryString || ''}`),
    archiveLoginHistory: (id) => apiFetch(`/login-history/${id}/archive`, { method: 'POST' }),
    markLoginSuspicious: (id) => apiFetch(`/login-history/${id}/suspicious`, { method: 'POST' }),
    // Sessions
    activeSessions: () => apiFetch('/sessions/active'),
    revokeSession: (id) => apiFetch(`/sessions/${id}/revoke`, { method: 'POST' }),
    revokeUserSessions: (userId) => apiFetch(`/sessions/user/${userId}/revoke`, { method: 'POST' }),
};

// ─── Public client ────────────────────────────────────────────────
export const createClient = () => ({ auth, entities, functions, integrations, app, custom });
export const client = createClient();
