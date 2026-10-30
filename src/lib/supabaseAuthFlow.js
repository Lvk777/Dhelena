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
            await session();
            let challenge;
            try { challenge = await api('/auth/code/start', { method: 'POST', body: '{}' }); }
            catch (error) {
                // An AAL1 administrator is redirected to native TOTP enrollment
                // or challenge by /auth/me; the inactive email-code prototype
                // must not turn a valid password sign-in into a failed login.
                if (error.status !== 403 || error.response?.data?.code !== 'admin_mfa_required') throw error;
                challenge = { required: false };
            }
            if (challenge.required) { setUser(null); return { pending_code: true, resend_after: challenge.resend_after }; }
            const profile = await api('/auth/me'); setUser(profile); return profile;
        }); },
        verifyLoginCode(code) { return once('verify-code', async () => {
            if (!/^\d{6}$/.test(code || '')) throw fail('Informe os seis dígitos do código.');
            await session();
            await api('/auth/code/verify', { method: 'POST', body: JSON.stringify({ code }) });
            const profile = await api('/auth/me'); setUser(profile); return profile;
        }); },
        resendLoginCode() { return once('resend-code', async () => {
            await session(); return api('/auth/code/start', { method: 'POST', body: '{}' });
        }); },
        requestEmailOtp(email) { return once('email-otp-request', async () => {
            if (!authEmail(email)) throw fail('Informe um e-mail válido.');
            const normalized = email.trim().toLowerCase();
            const current = check(await a.getSession());
            if (current?.session?.access_token) throw fail('Você já está conectada. Saia da conta antes de entrar em outra.');
            // GoTrue does not create a user when shouldCreateUser is false. Its raw
            // response can enumerate accounts, so the UI always gives a neutral result.
            let response;
            try { response = await a.signInWithOtp({ email: normalized, options: { shouldCreateUser: false } }); }
            catch { /* Do not expose provider errors or account existence. */ }
            if (response?.data?.session) {
                await a.signOut({ scope: 'local' }).catch(() => {});
                setToken(null); setUser(null);
                throw fail('Não foi possível iniciar a entrada por código. Tente novamente.');
            }
            setUser(null);
            return { pending_otp: true, resend_after: 60 };
        }); },
        verifyEmailOtp(email, code) { return once('email-otp-verify', async () => {
            if (!authEmail(email) || !/^\d{6}$/.test(code || '')) throw fail('Informe o e-mail e os seis dígitos do código.');
            const normalized = email.trim().toLowerCase();
            const result = await a.verifyOtp({ email: normalized, token: code, type: 'email' });
            if (result.error || !result.data?.session?.access_token) throw fail('Código inválido ou expirado. Solicite um novo código.');
            try {
                const identity = await verifiedUser();
                if (identity.email?.toLowerCase() !== normalized || result.data.session.user?.id !== identity.id) {
                    throw fail('A conta confirmada não corresponde ao e-mail informado.');
                }
            } catch (error) {
                await a.signOut({ scope: 'local' }).catch(() => {});
                setToken(null); setUser(null);
                throw error;
            }
            await session();
            const profile = await api('/auth/me');
            setUser(profile);
            return profile;
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
            const pending = new URL(location.href);
            const pendingHash = new URLSearchParams(pending.hash.slice(1));
            if (callbackFlight && (location.href === callbackUrl || !pending.searchParams.has('code')
                && !pending.searchParams.has('token_hash') && !pendingHash.has('token_hash'))) return callbackFlight;
            callbackUrl = location.href;
            callbackFlight = once('callback', async () => {
                const url = new URL(location.href);
                const hash = new URLSearchParams(url.hash.slice(1));
                const code = url.searchParams.get('code');
                const tokenHash = url.searchParams.get('token_hash') || hash.get('token_hash');
                const otpType = url.searchParams.get('type') || hash.get('type');
                const flow = url.searchParams.get('flow');
                const next = authPath(url.searchParams.get('returnTo'), origin);
                // Remove credentials before requests, error rendering or analytics.
                history.replaceState(null, '', '/auth/callback');
                if (url.searchParams.has('error') || hash.has('error') || hash.has('access_token') || hash.has('refresh_token') || (code && tokenHash)
                    || (url.searchParams.has('token_hash') && hash.has('token_hash')) || (!code && !tokenHash)
                    || (code && code.length > 2048) || (tokenHash && (tokenHash.length > 2048 || !['email', 'signup', 'recovery', 'email_change', 'invite', 'magiclink'].includes(otpType)))) throw fail('Link inválido, expirado ou autenticação cancelada. Solicite um novo link ou tente entrar novamente.');
                const result = code ? await a.exchangeCodeForSession(code) : await a.verifyOtp({ token_hash: tokenHash, type: otpType });
                if (result.error && code && (result.error.code === 'bad_code_verifier' || /code challenge does not match/i.test(result.error.message || ''))) {
                    throw Object.assign(fail('O e-mail foi confirmado, mas a sessão não pôde ser aberta. Entre com sua senha.'), { reason: 'session_not_opened' });
                }
                if (result.error) {
                    if (result.error.status >= 500 || result.error.name === 'AuthRetryableFetchError') {
                        throw fail('A confirmação está temporariamente indisponível. Tente novamente em instantes.');
                    }
                    throw fail('Link inválido, expirado ou já utilizado. Solicite um novo link.');
                }
                const data = result.data;
                await verifiedUser(); await session();
                if (flow === 'recovery') {
                    if (code ? data?.redirectType !== 'recovery' : otpType !== 'recovery') throw fail('Este link não autoriza redefinir a senha.');
                    const current = await session(); recovery = { userId: current.user.id, token: current.access_token, expiresAt: Math.min(now() + 15 * 60 * 1000, current.expires_at * 1000) };
                    return { path: '/reset-password', recovery: true };
                }
                // The Auth session is established. Profile loading belongs to the destination page;
                // a backend outage must not mislabel a valid confirmation as an expired link.
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
        async mfaStatus() {
            await verifiedUser();
            const [factors, assurance] = await Promise.all([
                a.mfa.listFactors(), a.mfa.getAuthenticatorAssuranceLevel(),
            ]);
            if (factors.error || assurance.error) throw fail('Não foi possível verificar o autenticador.');
            const verified = (factors.data?.totp || []).filter(factor => factor.status === 'verified');
            return { enrolled: verified.length > 0, factorId: verified[0]?.id || null,
                aal: assurance.data?.currentLevel === 'aal2' ? 'aal2' : 'aal1' };
        },
        mfaEnroll() { return once('mfa-enroll', async () => {
            await verifiedUser();
            const result = await a.mfa.enroll({ factorType: 'totp', friendlyName: 'D’Helenas Boutique' });
            if (result.error || !result.data?.id || !result.data?.totp?.secret) {
                throw fail('Não foi possível iniciar a inscrição do autenticador.');
            }
            // The secret is shown only in this page state. Never send it to Express,
            // analytics, logs or persistent browser storage.
            return { factorId: result.data.id, secret: result.data.totp.secret };
        }); },
        mfaVerify(factorId, code) { return once('mfa-verify', async () => {
            if (!factorId || !/^\d{6}$/.test(code || '')) throw fail('Informe o código de seis dígitos do aplicativo.');
            const result = await a.mfa.challengeAndVerify({ factorId, code });
            if (result.error) throw fail('Código inválido ou expirado. Tente novamente.');
            await session();
            const status = await this.mfaStatus();
            if (status.aal !== 'aal2') throw fail('A sessão ainda não confirmou o segundo fator.');
            return status;
        }); },
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
            try { await api('/auth/code/logout', { method: 'POST', body: '{}' }).catch(() => {}); check(await a.signOut({ scope: 'global' })); }
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
