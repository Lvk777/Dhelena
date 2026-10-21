/**
 * API client — dual-mode (Supabase Auth + Storage in production, Express JWT + local in dev).
 * Maintains the same interface the frontend expects (entities, auth, functions, integrations, app).
 */

import { supabase } from './supabaseClient.js';
import { createSupabaseAuthFlow } from '../lib/supabaseAuthFlow.js';
import { createSessionFence } from '../lib/sessionFence.js';
import { buildPlaceOrderRequest } from './orderRequest.js';
import { resolveApiBase, apiUrl } from './apiBase.js';

const API_BASE = resolveApiBase(import.meta.env.VITE_API_URL, import.meta.env.PROD);
const TOKEN_KEY = 'dhelena_access_token';
const USER_KEY = 'dhelena_auth_user';
const sessionFence = createSessionFence();
if (supabase) supabase.auth.onAuthStateChange((event, session) => event === 'INITIAL_SESSION'
    ? sessionFence.initialize(session?.user?.id || null) : sessionFence.observe(session?.user?.id || null));

// ─── Token & user storage ──────────────────────────────────────────
function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(token) { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); }
function getStoredUser() { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } }
function setStoredUser(user) { user ? localStorage.setItem(USER_KEY, JSON.stringify(user)) : localStorage.removeItem(USER_KEY); }

/** @param {string} message @param {number} status @param {unknown} [data] */
function createApiError(message, status, data) {
    return Object.assign(new Error(message), { status, response: data === undefined ? undefined : { data } });
}

// ─── Core fetch wrapper ────────────────────────────────────────────
async function apiFetch(path, options = {}) {
    const startedBy = sessionFence.capture();
    let token = getToken();
    let identity = null;
    if (supabase) {
        const { data, error } = await supabase.auth.getSession();
        sessionFence.assert(startedBy);
        token = error ? null : data?.session?.access_token || null;
        identity = data?.session?.user?.id || null;
        setToken(token);
    }
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(apiUrl(API_BASE, path), { ...options, headers });
    sessionFence.assert(startedBy);
    if (supabase && identity) {
        const { data } = await supabase.auth.getSession();
        if (data?.session?.user?.id !== identity) throw createApiError('Sua sessão mudou. Recarregue a página.', 401);
    }

    if (res.status === 401) {
        setToken(null);
        setStoredUser(null);
        throw createApiError('Não autenticado', 401);
    }

    if (!res.ok) {
        const error = await res.json().catch(() => ({ error: res.statusText }));
        throw createApiError(error.error || error.message || 'Request failed', res.status, error);
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
    SizeGuide: 'size-guides',
    LookPromotion: 'look-promotions',
};

// ─── Entity CRUD factory ───────────────────────────────────────────
function makeEntity(name) {
    const endpoint = ENTITY_MAP[name] || name.toLowerCase();
    return {
        async list(sortField, limit, page) {
            const params = new URLSearchParams();
            if (sortField) params.set('sort', sortField);
            if (limit) params.set('limit', limit);
            if (page) params.set('page', page);
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
    providerStatus: () => apiFetch('/auth/capabilities'),
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
            throw createApiError('Not authenticated', 401);
        }
        try {
            const user = await apiFetch('/auth/me');
            setStoredUser(user);
            return user;
        } catch (err) {
            /** @type {{ status?: number }} */
            const apiError = /** @type {any} */ (err);
            if (apiError.status === 401) {
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
            if (!data.session) throw createApiError('Sessão indisponível.', 401);
            setToken(data.session.access_token);
            const user = await apiFetch('/auth/me');
            setStoredUser(user);
            return user;
        }
        // Express JWT fallback (uses bcrypt hash in profiles table)
        const data = await apiFetch('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
        }).catch(error => { if (error.status === 401) throw createApiError('E-mail ou senha inválidos.', 401); throw error; });
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
    async verifyOtp({ email, otpCode }) {
        if (!supabase) throw new Error('Verificação por código exige Supabase Auth.');
        const { data, error } = await supabase.auth.verifyOtp({
            email,
            token: otpCode,
            type: 'signup',
        });
        if (error || !data.session) throw error || new Error('Código inválido ou expirado.');
        setToken(data.session.access_token);
        return data.session;
    },
    async resendOtp(email) {
        if (!supabase) throw new Error('Reenvio de código exige Supabase Auth.');
        const { error } = await supabase.auth.resend({ type: 'signup', email });
        if (error) throw error;
        return {};
    },
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
    async securityInfo() { const user = await auth.me(); return { email: user.email, pending_email: null, password_provider: true, local_mode: true, email_change_supported: false }; },
    changePassword(data) { return apiFetch('/auth/change-password', { method: 'POST', body: JSON.stringify(data) }); },
    recoveryReady() { return !supabase && !!new URLSearchParams(window.location.search).get('token'); },
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
if (supabase) Object.assign(auth, createSupabaseAuthFlow({ supabase, api: apiFetch,
    origin: window.location.origin, storage: sessionStorage, location: window.location, history: window.history,
    setToken, setUser: setStoredUser }));
const functions = {
    async invoke(name, args) {
        switch (name) {
            case 'previewCheckout':
                return apiFetch('/checkout/preview', { method: 'POST', body: JSON.stringify(args) });
            case 'placeOrder':
                return apiFetch('/orders', buildPlaceOrderRequest(args));
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
            // ─── Payment functions ───
            case 'testPaymentConnection':
                return apiFetch('/payments/test');
            case 'testShippingConnection':
                return apiFetch('/shipping/test');
            case 'createPixPayment':
                return apiFetch(`/orders/${args.orderId}/payment/pix`, { method: 'POST', body: JSON.stringify(args) });
            case 'createCardPayment':
                return apiFetch(`/orders/${args.orderId}/payment/card`, { method: 'POST', body: JSON.stringify(args) });
            case 'previewPaymentMethodChange':
                return apiFetch(`/orders/${args.orderId}/payment/method/preview`, { method: 'POST', body: JSON.stringify({ payment_method: args.payment_method }) });
            case 'changePaymentMethod':
                return apiFetch(`/orders/${args.orderId}/payment/method`, { method: 'POST', headers: { 'X-Idempotency-Key': args.idempotencyKey },
                    body: JSON.stringify({ payment_method: args.payment_method, expected_pricing: args.expected_pricing }) });
            case 'getPaymentStatus':
                return apiFetch(`/orders/${args.orderId}/payment/status`);
            case 'getPaymentReconciliationPreview': {
                const params = new URLSearchParams();
                if (args.mpOrderId) params.set('mp_order_id', args.mpOrderId);
                return apiFetch(`/admin/orders/${encodeURIComponent(args.orderId)}/payment-reconciliation-preview?${params}`);
            }
            case 'getPaymentMethods':
                return apiFetch('/payments/methods');
            case 'getInstallmentSettings':
                return apiFetch('/admin/payments/installments');
            case 'saveInstallmentSettings':
                return apiFetch('/admin/payments/installments', { method: 'PATCH', body: JSON.stringify(args) });
            case 'simulateInstallments':
                return apiFetch('/admin/payments/installments/simulate', { method: 'POST', body: JSON.stringify(args) });
            case 'approveInstallments':
                return apiFetch('/admin/payments/installments/approve', { method: 'POST', body: JSON.stringify(args) });
            case 'getInstallmentOffers':
                return apiFetch(`/orders/${args.orderId}/payment/installments`, { method: 'POST', body: JSON.stringify({ bin: args.bin }) });
            case 'getPublicInstallmentPolicy':
                return apiFetch('/payments/installment-policy');
            case 'getOrderEvents':
                return apiFetch(`/orders/${args.orderId}/events`);
            case 'getAfterSales':
                return apiFetch(`/orders/${args.orderId}/after-sales`);
            case 'createReturn':
                return apiFetch(`/orders/${args.orderId}/returns`, { method: 'POST', body: JSON.stringify(args) });
            case 'advanceReturn':
                return apiFetch(`/orders/${args.orderId}/returns/${args.returnId}`, {
                    method: 'PATCH', body: JSON.stringify({ status: args.status, restockable: args.restockable,
                        conditionNotes: args.conditionNotes, postingInstructions: args.postingInstructions,
                        reverseTrackingCode: args.reverseTrackingCode, reversePostingCode: args.reversePostingCode }),
                });
            case 'requestRefund':
                return apiFetch(`/orders/${args.orderId}/refunds`, {
                    method: 'POST', headers: { 'X-Idempotency-Key': args.idempotencyKey },
                    body: JSON.stringify({ kind: args.kind, reason: args.reason }),
                });
            case 'previewRefund':
                return apiFetch(`/orders/${args.orderId}/refunds/preview`);
            case 'reconcileRefund':
                return apiFetch(`/orders/${args.orderId}/refunds/${args.refundId}/reconcile`, { method: 'POST' });
            case 'cancelAfterRefund':
                return apiFetch(`/orders/${args.orderId}/cancel-after-refund`, { method: 'POST' });
            case 'cancelPendingPayment':
                return apiFetch(`/orders/${args.orderId}/cancel-pending-payment`, { method: 'POST' });
            case 'operationalRefundPreview':
                return apiFetch(`/orders/${args.orderId}/refunds/operational/preview`, { method:'POST',body:JSON.stringify(args.request) });
            case 'operationalRefundReconcile':
                return apiFetch(`/orders/${args.orderId}/refunds/operational/${args.refundId}/reconcile`,{method:'POST'});
            case 'operationalRefund':
                return apiFetch(`/orders/${args.orderId}/refunds/operational`, { method:'POST',headers:{'X-Idempotency-Key':args.idempotencyKey},body:JSON.stringify(args.request) });
            case 'notificationReadiness':
                return apiFetch('/notifications/readiness');
            case 'generateShippingLabel':
                return apiFetch(`/orders/${args.orderId}/shipping/label`, { method: 'POST', body: JSON.stringify(args) });
            case 'shippingReadiness':
                return apiFetch(`/orders/${args.orderId}/shipping/readiness`);
            case 'getTrackingInfo':
                return apiFetch(`/orders/${args.orderId}/tracking`);
            // ─── Shipping quote ───
            case 'calculateShipping':
                return apiFetch('/shipping/quote', { method: 'POST', body: JSON.stringify(args) });
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

            const res = await fetch(apiUrl(API_BASE, '/upload'), {
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
const entities = /** @type {Record<string, ReturnType<typeof makeEntity>>} */ (new Proxy({}, {
    get(_, name) {
        return makeEntity(name);
    },
}));

// ─── Custom analytics endpoints ───────────────────────────────────
const custom = {
    launchSummary: () => apiFetch('/admin/launch-summary'),
    readAdminAccess: () => apiFetch('/admin/access'),
    changeAdminAccess: (id, grant) => apiFetch(`/admin/access/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ grant }) }),
    submitContact: data => apiFetch('/contact', { method: 'POST', body: JSON.stringify(data) }),
    activePromotions: () => apiFetch('/look-promotions'),
    adminPromotions: () => apiFetch('/look-promotions/admin'),
    integrationConfigs: () => apiFetch('/integrations/config'),
    integrationStatus: () => apiFetch('/integrations/status'),
    authorizeMelhorEnvio: mode => {
        if (!['sandbox', 'production'].includes(mode)) throw new Error('Ambiente inválido.');
        return apiFetch(`/integrations/melhor-envio/oauth${mode === 'production' ? '/production' : ''}/authorize`);
    },
    updateIntegrationConfig: (serviceKey, data) => apiFetch(`/integrations/config/${serviceKey}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    testIntegration: (serviceKey, configData) => apiFetch(`/integrations/test/${serviceKey}`, {
        method: 'POST',
        body: JSON.stringify({ config_data: configData }),
    }),
    toggleIntegration: (serviceKey) => apiFetch(`/integrations/config/${serviceKey}/toggle`, { method: 'PATCH' }),
    analyticsOverview: ({ period, start = '', end = '' }) => apiFetch(`/analytics/overview?period=${period || '7d'}${start ? `&start=${start}` : ''}${end ? `&end=${end}` : ''}`),
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
