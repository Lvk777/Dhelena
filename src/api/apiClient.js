/**
 * Standalone API client — replaces the Base44 SDK.
 *
 * All entity methods store data in localStorage so the app runs fully
 * offline / standalone (no Base44 account required).
 * Replace these implementations with real fetch() calls to your backend.
 */

import initialData from '@/data/initialData.json';

// ─── Tiny localStorage store with initial seed ────────────────────────────────

function storeKey(entity) {
    return `dhelena_entity_${entity}`;
}

function readAll(entity) {
    try {
        const item = localStorage.getItem(storeKey(entity));
        if (!item || item === '[]') {
            const seed = initialData[entity];
            if (seed && seed.length > 0) {
                localStorage.setItem(storeKey(entity), JSON.stringify(seed));
                return JSON.parse(JSON.stringify(seed));
            }
        }
        let data = item ? JSON.parse(item) : (initialData[entity] || []);
        if (entity === 'Banner' && Array.isArray(data)) {
            let changed = false;
            data = data.map(b => {
                if (b.secondary_cta_link === '/loja') {
                    changed = true;
                    return { ...b, secondary_cta_link: '/colecoes' };
                }
                return b;
            });
            if (changed) writeAll(entity, data);
        }
        return data;
    } catch {
        return initialData[entity] || [];
    }
}

function writeAll(entity, records) {
    localStorage.setItem(storeKey(entity), JSON.stringify(records));
}

function newId() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function nowIso() {
    return new Date().toISOString();
}

// ─── Entity CRUD factory ──────────────────────────────────────────────────────

function makeEntity(name) {
    return {
        async list(sortField, limit) {
            let records = readAll(name);
            if (sortField) {
                const desc = sortField.startsWith('-');
                const field = desc ? sortField.slice(1) : sortField;
                records = records.sort((a, b) => {
                    const av = a[field], bv = b[field];
                    if (av === bv) return 0;
                    const cmp = av < bv ? -1 : 1;
                    return desc ? -cmp : cmp;
                });
            }
            if (limit) records = records.slice(0, limit);
            return records;
        },
        async filter(predicate, sortField, limit) {
            let records = readAll(name).filter(record => {
                if (typeof predicate !== 'object') return true;
                return Object.entries(predicate).every(([k, v]) => {
                    if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(record[k]);
                    return record[k] === v;
                });
            });
            if (sortField) {
                const desc = sortField.startsWith('-');
                const field = desc ? sortField.slice(1) : sortField;
                records = records.sort((a, b) => {
                    const av = a[field], bv = b[field];
                    if (av === bv) return 0;
                    const cmp = av < bv ? -1 : 1;
                    return desc ? -cmp : cmp;
                });
            }
            if (limit) records = records.slice(0, limit);
            return records;
        },
        async get(id) {
            const rec = readAll(name).find(r => r.id === id);
            if (!rec) throw Object.assign(new Error('Not found'), { status: 404 });
            return rec;
        },
        async create(data) {
            const records = readAll(name);
            const rec = { id: newId(), created_date: nowIso(), ...data };
            records.push(rec);
            writeAll(name, records);
            return rec;
        },
        async bulkCreate(items) {
            return Promise.all(items.map(item => this.create(item)));
        },
        async update(id, data) {
            const records = readAll(name);
            const idx = records.findIndex(r => r.id === id);
            if (idx === -1) throw Object.assign(new Error('Not found'), { status: 404 });
            records[idx] = { ...records[idx], ...data };
            writeAll(name, records);
            return records[idx];
        },
        async delete(id) {
            const records = readAll(name).filter(r => r.id !== id);
            writeAll(name, records);
            return { id };
        },
    };
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

const AUTH_KEY = 'dhelena_auth_user';
const TOKEN_KEY = 'dhelena_access_token';

const auth = {
    me() {
        const raw = localStorage.getItem(AUTH_KEY);
        if (!raw) return Promise.reject(Object.assign(new Error('Not authenticated'), { status: 401 }));
        return Promise.resolve(JSON.parse(raw));
    },
    isAuthenticated() {
        return !!localStorage.getItem(TOKEN_KEY);
    },
    getToken() {
        return localStorage.getItem(TOKEN_KEY);
    },
    setToken(token) {
        localStorage.setItem(TOKEN_KEY, token);
    },
    async loginViaEmailPassword(email, password, returnTo = '') {
        // Automatically grant admin role if email has 'admin', or if accessing /admin
        const isAdmin = email.toLowerCase().includes('admin') || 
                        returnTo.includes('admin') || 
                        (typeof window !== 'undefined' && window.location.href.includes('admin'));
        const role = isAdmin ? 'admin' : 'user';
        const user = { id: newId(), email, full_name: email.split('@')[0], role };
        localStorage.setItem(AUTH_KEY, JSON.stringify(user));
        localStorage.setItem(TOKEN_KEY, 'stub-token-' + newId());
        return user;
    },
    async loginAsAdmin() {
        const user = { id: 'admin-1', email: 'admin@dhelena.com', full_name: 'Administrador D\'Helenas', role: 'admin' };
        localStorage.setItem(AUTH_KEY, JSON.stringify(user));
        localStorage.setItem(TOKEN_KEY, 'stub-token-admin');
        return user;
    },
    async register({ email, password, full_name }) {
        // Stub: immediately create user (skip OTP flow)
        const user = { id: newId(), email, full_name, role: 'user' };
        localStorage.setItem(AUTH_KEY, JSON.stringify(user));
        localStorage.setItem(TOKEN_KEY, 'stub-token-' + newId());
        return user;
    },
    async verifyOtp({ email, otpCode }) {
        return { access_token: 'stub-token-' + newId() };
    },
    async resendOtp(email) { return {}; },
    async updateMe(data) {
        const raw = localStorage.getItem(AUTH_KEY);
        const user = raw ? { ...JSON.parse(raw), ...data } : data;
        localStorage.setItem(AUTH_KEY, JSON.stringify(user));
        return user;
    },
    async resetPasswordRequest(email) { return {}; },
    async resetPassword({ resetToken, newPassword }) { return {}; },
    logout(redirectUrl) {
        localStorage.removeItem(AUTH_KEY);
        localStorage.removeItem(TOKEN_KEY);
        if (redirectUrl) window.location.href = redirectUrl;
    },
    redirectToLogin(returnTo) {
        window.location.href = '/login' + (returnTo ? '?returnTo=' + encodeURIComponent(returnTo) : '');
    },
    loginWithProvider(provider, returnTo) {
        // Stub: redirect to login page (no OAuth flow)
        window.location.href = '/login' + (returnTo ? '?returnTo=' + encodeURIComponent(returnTo) : '');
    },
};

// ─── Functions (backend function stubs) ──────────────────────────────────────

const functions = {
    async invoke(name, args) {
        console.warn(`[apiClient] Function "${name}" called with`, args, '— stub response returned.');
        // Specific stubs for known functions
        if (name === 'validateCoupon') return { valid: false, error: 'Cupons não configurados' };
        if (name === 'placeOrder') {
            const orderNum = 'DH' + Date.now();
            return { data: { order_number: orderNum } };
        }
        if (name === 'logAdminAction') return {};
        if (name === 'updateOrderStatus') return {};
        if (name === 'cancelOrder') return {};
        if (name === 'adjustStock') return {};
        return {};
    },
};

// ─── Integrations (file upload stub) ─────────────────────────────────────────

const integrations = {
    Core: {
        async UploadFile({ file }) {
            // Convert file to a local object URL as a stub
            const url = URL.createObjectURL(file);
            return { file_url: url };
        },
    },
};

// ─── App (public settings stub) ──────────────────────────────────────────────

const app = {
    async getPublicSettings() {
        return {
            id: 'local',
            public_settings: { store_name: "D'Helenas" },
        };
    },
};

// ─── Entity registry ─────────────────────────────────────────────────────────

const entities = new Proxy({}, {
    get(_, name) {
        return makeEntity(name);
    },
});

// ─── Public client ────────────────────────────────────────────────────────────

export const createClient = () => ({ auth, entities, functions, integrations, app });

export const client = createClient();
