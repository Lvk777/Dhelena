export function authPath(raw, origin, fallback = '/minha-conta') {
    try {
        if (typeof raw !== 'string' || /[\\\u0000-\u0020]/.test(raw)) return fallback;
        const url = new URL(raw, origin);
        if (url.origin !== origin || !url.pathname.startsWith('/') || url.pathname.startsWith('//')) return fallback;
        for (const key of ['access_token', 'refresh_token', 'code', 'token', 'token_hash', 'clear_access_token', 'app_id', 'app_base_url', 'functions_version', 'from_url']) url.searchParams.delete(key);
        return url.pathname + url.search;
    } catch { return fallback; }
}
export function authCallbackUrl(origin, flow = 'login', returnTo = '/minha-conta') {
    const url = new URL(origin);
    if (!((url.protocol === 'https:' && ['dhelenas.com', 'www.dhelenas.com'].includes(url.hostname))
        || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Origem de autenticação não autorizada.');
    const callback = new URL('/auth/callback', origin);
    callback.searchParams.set('flow', flow);
    callback.searchParams.set('returnTo', authPath(returnTo, origin));
    return callback.href;
}
export function passwordMessage(value) {
    return typeof value === 'string' && value.length >= 8 && value.length <= 128 && /[A-Za-z]/.test(value) && /\d/.test(value)
        ? '' : 'Use de 8 a 128 caracteres, com letras e números.';
}
export const authEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const fail = message => Object.assign(new Error(message), { status: 400 });

/** @param {any} options */
export function createSupabaseAuthFlow({ supabase, api, origin, location, history, setToken, setUser, now = Date.now }) {
    const a = supabase.auth;
    const flights = new Map();
    let recovery = null;
    let callbackFlight;
    let callbackUrl;
    function once(name, action) {
        if (flights.has(name)) return flights.get(name);
        const task = Promise.resolve().then(action).finally(() => flights.delete(name));
        flights.set(name, task); return task;
    }
    const check = result => { if (result.error) throw fail('Não foi possível concluir. Confira os dados ou solicite um novo link.'); return result.data; };
    async function verifiedUser() {
        const data = check(await a.getUser());
        if (!data?.user || !data.user.email_confirmed_at) throw fail('Confirme seu e-mail para continuar.');
        return data.user;
    }
    const callback = (flow, path) => authCallbackUrl(origin, flow, path);
    async function session() {
        const data = check(await a.getSession());
        if (!data?.session?.access_token) { setToken(null); setUser(null); throw Object.assign(fail('Entre na sua conta para continuar.'), { status: 401 }); }
        setToken(data.session.access_token); return data.session;
    }
    return {
        async me() { await session(); const profile = await api('/auth/me'); setUser(profile); return profile; },
        loginViaEmailPassword(email, password) { return once('login', async () => {
            if (!authEmail(email) || !password) throw fail('Informe e-mail e senha.');
            try { check(await a.signInWithPassword({ email: email.trim().toLowerCase(), password })); }
            catch { throw fail('Não foi possível entrar. Confira e-mail e senha e a confirmação do cadastro.'); }
            await session(); const profile = await api('/auth/me'); setUser(profile); return profile;
        }); },
        register({ email, password, full_name }) { return once('register', async () => {
            if (!authEmail(email) || !full_name?.trim() || passwordMessage(password)) throw fail('Confira nome, e-mail e senha.');
            const data = check(await a.signUp({ email: email.trim().toLowerCase(), password,
                options: { data: { full_name: full_name.trim() }, emailRedirectTo: callback('signup', '/minha-conta/dados') } }));
            if (data?.session) setToken(data.session.access_token);
            // Successful Auth registration remains successful even if profile provisioning needs retry.
            return { pending_verification: !data?.session, registered: true };
        }); },
        async loginWithProvider(provider, returnTo) { return once('oauth', async () => {
            if (provider !== 'google') throw fail('Provedor não autorizado.');
            const data = check(await a.signInWithOAuth({ provider: 'google', options: { redirectTo: callback('login', returnTo), skipBrowserRedirect: true } }));
            const url = new URL(data?.url);
            if (url.origin !== new URL(supabase.supabaseUrl).origin || url.pathname !== '/auth/v1/authorize'
                || url.searchParams.get('provider') !== 'google') throw fail('Redirecionamento de autenticação inválido.');
            location.assign(url.href);
        }); },
        finishCallback() {
            // StrictMode, duplicate mounts and concurrent callers exchange a single-use code only once.
            if (callbackFlight && (location.href === callbackUrl || !new URL(location.href).searchParams.has('code') && !new URL(location.href).searchParams.has('token_hash'))) return callbackFlight;
            callbackUrl = location.href;
            callbackFlight = once('callback', async () => {
                const url = new URL(location.href);
                const code = url.searchParams.get('code');
                const tokenHash = url.searchParams.get('token_hash');
                const otpType = url.searchParams.get('type');
                const flow = url.searchParams.get('flow');
                const next = authPath(url.searchParams.get('returnTo'), origin);
                // Remove credentials before requests, error rendering or analytics.
                history.replaceState(null, '', '/auth/callback');
                if (url.searchParams.has('error') || (code && tokenHash) || (!code && !tokenHash)
                    || (code && code.length > 2048) || (tokenHash && (tokenHash.length > 2048 || !['recovery', 'signup', 'email_change'].includes(otpType)))) throw fail('Link inválido, expirado ou autenticação cancelada. Solicite um novo link ou tente entrar novamente.');
                const data = check(code ? await a.exchangeCodeForSession(code) : await a.verifyOtp({ token_hash: tokenHash, type: otpType }));
                await verifiedUser(); await session();
                if (flow === 'recovery') {
                    if (code ? data?.redirectType !== 'recovery' : otpType !== 'recovery') throw fail('Este link não autoriza redefinir a senha.');
                    const current = await session(); recovery = { userId: current.user.id, token: current.access_token, expiresAt: Math.min(now() + 15 * 60 * 1000, current.expires_at * 1000) };
                    return { path: '/reset-password', recovery: true };
                }
                await api('/auth/me');
                return { path: ['/auth/callback', '/reset-password', '/login', '/cadastro'].includes(next.split('?')[0]) ? '/minha-conta' : next };
            });
            return callbackFlight;
        },
        resetPasswordRequest(email) { return once('recovery-request', async () => {
            if (!authEmail(email)) throw fail('Informe um e-mail válido.');
            // Supabase enforces server rate limits; UI adds a cooldown without claiming delivery.
            check(await a.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: callback('recovery', '/reset-password') })); return {};
        }); },
        recoveryReady() { return !!recovery && recovery.expiresAt > now(); },
        resetPassword({ newPassword }) { return once('password', async () => {
            const s = await session();
            if (!recovery || recovery.expiresAt <= now() || recovery.userId !== s.user.id || recovery.token !== s.access_token) throw fail('Link inválido ou expirado. Solicite outro link.');
            if (passwordMessage(newPassword)) throw fail(passwordMessage(newPassword));
            check(await a.updateUser({ password: newPassword })); recovery = null;
            check(await a.signOut({ scope: 'global' })); setToken(null); setUser(null); return { success: true };
        }); },
        async securityInfo() {
            const u = await verifiedUser();
            const profile = await api('/auth/me');
            return { email: u.email, pending_email: u.new_email || null, password_provider: (u.app_metadata?.providers || []).includes('email'), email_change_supported: profile.email_change_supported === true };
        },
        changeEmail(email) { return once('email-change', async () => {
            if (!authEmail(email)) throw fail('Informe um e-mail válido.');
            await api('/auth/email-change/preview', { method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase() }) });
            check(await a.updateUser({ email: email.trim().toLowerCase() }, { emailRedirectTo: callback('email-change', '/minha-conta/dados') }));
            const info = await this.securityInfo();
            return { ...info, pending: !!info.pending_email };
        }); },
        changePassword({ newPassword, nonce }) { return once('password', async () => {
            if (passwordMessage(newPassword)) throw fail(passwordMessage(newPassword));
            await verifiedUser();
            const result = await a.updateUser({ password: newPassword, ...(nonce ? { nonce } : {}) });
            if (['reauthentication_needed', 'reauthentication_not_valid'].includes(result.error?.code)) return { reauthentication_required: true };
            check(result); return { success: true };
        }); },
        requestReauthentication() { return once('reauthenticate', async () => { check(await a.reauthenticate()); return {}; }); },
        logout() { return once('logout', async () => {
            // Always erase local state, including when the provider is temporarily unavailable.
            try { check(await a.signOut({ scope: 'global' })); }
            finally { recovery = null; setToken(null); setUser(null); }
        }); },
        onSessionChange(callback) {
            const { data } = a.onAuthStateChange((event, s) => {
                if (event === 'SIGNED_OUT') { recovery = null; setToken(null); setUser(null); }
                else if (s?.access_token) setToken(s.access_token);
                // Do not await Supabase methods from its own callback lock.
                setTimeout(() => callback(event), 0);
            });
            return () => data.subscription.unsubscribe();
        },
    };
}
