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
if (supabase) {
    supabase.auth.onAuthStateChange((event, session) => {
        if (session?.access_token) {
            setToken(session.access_token);
        } else {
            setToken(null);
            setStoredUser(null);
        }
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
        if (supabase) {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                const err = new Error('Not authenticated');
                err.status = 401;
                throw err;
            }
            setToken(session.access_token);
        } else {
            const token = getToken();
            if (!token) {
                const err = new Error('Not authenticated');
                err.status = 401;
                throw err;
            }
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

// ─── File upload (Supabase Storage when configured, backend fallback) ─
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 10 * 1024 * 1024;

const integrations = {
    Core: {
        async UploadFile({ file, bucket = 'product-images' }) {
            // Validate file type
            if (!ALLOWED_TYPES.includes(file.type)) {
                throw new Error('Formato não permitido. Use JPEG, PNG ou WEBP.');
            }
            if (file.size > MAX_SIZE) {
                throw new Error('Arquivo muito grande. Máximo 10MB.');
            }

            if (supabase) {
                // Upload to Supabase Storage
                const ext = file.name.split('.').pop().toLowerCase();
                const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
                const { error } = await supabase.storage
                    .from(bucket)
                    .upload(fileName, file, { contentType: file.type });
                if (error) throw error;

                const { data: { publicUrl } } = supabase.storage
                    .from(bucket)
                    .getPublicUrl(fileName);
                return { file_url: publicUrl };
            }

            // Dev mode: upload to backend
            const token = getToken();
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch(`${API_BASE}/upload`, {
                method: 'POST',
                headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                body: formData,
            });
            if (!res.ok) throw new Error('Upload failed');
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
};

// ─── Public client ────────────────────────────────────────────────
export const createClient = () => ({ auth, entities, functions, integrations, app, custom });
export const client = createClient();
