import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseAuthFlow, authPath, authCallbackUrl, passwordMessage } from '../../src/lib/supabaseAuthFlow.js';
import { createSessionFence } from '../../src/lib/sessionFence.js';
import { createDialogRequests } from '../../src/lib/dialogRequest.js';
import { authCapabilities } from '../src/lib/authCapabilities.js';
const origin = 'https://dhelenas.com';
function fixture() {
    const calls = [], tokens = [], users = [];
    const state = { time: 1000000, codeRequired: false, codeVerified: false, mfaEnrolled: false, aal: 'aal1', session: { access_token: 'synthetic-token', expires_at: 5000, user: { id: 'account-a' } },
        user: { id: 'account-a', email: 'a@example.test', email_confirmed_at: 'confirmed', app_metadata: { providers: ['email'] } }, redirectType: 'login' };
    const reply = data => ({ data, error: null });
    const a = {
        mfa: {
            listFactors: async () => reply({ totp: state.mfaEnrolled ? [{ id: 'factor-a', status: 'verified' }] : [] }),
            getAuthenticatorAssuranceLevel: async () => reply({ currentLevel: state.aal, nextLevel: state.mfaEnrolled ? 'aal2' : 'aal1' }),
            enroll: async args => { calls.push(['mfa-enroll', args]); return reply({ id: 'factor-a', totp: { secret: 'fixture-secret' } }); },
            challengeAndVerify: async args => { calls.push(['mfa-verify', args]); state.mfaEnrolled = true; state.aal = 'aal2'; return reply({ access_token: 'verified-token' }); },
        },
        getSession: async () => reply({ session: state.session }), getUser: async () => reply({ user: state.user }),
        signInWithPassword: async args => { calls.push(['login', args]); return reply({ session: state.session }); },
        signInWithOtp: async args => { calls.push(['email-otp-request', args]); return reply({ user: null, session: null }); },
        signUp: async args => { calls.push(['signup', args]); return reply({ session: null }); },
        signInWithOAuth: async args => { calls.push(['google', args]); return reply({ url: 'https://fixture.supabase.co/auth/v1/authorize?provider=google' }); },
        exchangeCodeForSession: async code => { calls.push(['exchange', code]); return reply({ session: state.session, redirectType: state.redirectType }); },
        verifyOtp: async args => { calls.push(['otp', args]); return reply({ session: state.session }); },
        updateUser: async (...args) => { calls.push(['update', ...args]); return reply({ user: state.user }); },
        resetPasswordForEmail: async (...args) => { calls.push(['request', ...args]); return reply({}); },
        reauthenticate: async () => { calls.push(['reauthenticate']); return reply({}); },
        signOut: async args => { calls.push(['signOut', args]); return reply({}); },
        onAuthStateChange: handler => { state.listener = handler; return { data: { subscription: { unsubscribe() { calls.push(['unsubscribe']); } } } }; },
    };
    const location = { href: origin + '/auth/callback?code=synthetic-code&flow=login', assign(url) { calls.push(['navigate', url]); } };
    const history = { replaceState(_state, _unused, path) { calls.push(['clean', path]); location.href = origin + path; } };
    const api = async (path, options) => {
        calls.push(['api', path, options]);
        if (path === '/auth/code/start') return { required: state.codeRequired, resend_after: 60 };
        if (path === '/auth/code/verify') { state.codeVerified = true; return { verified: true }; }
        if (path === '/auth/me' && state.codeRequired && !state.codeVerified) throw Object.assign(new Error('Not authenticated'), { status: 401 });
        return { id: state.user.id, role: 'customer', email: state.user.email, email_change_supported: true };
    };
    const flow = createSupabaseAuthFlow({ supabase: { auth: a, supabaseUrl: 'https://fixture.supabase.co' }, api, origin, location, history,
        now: () => state.time, setToken: v => tokens.push(v), setUser: v => users.push(v) });
    return { flow, a, state, calls, location, tokens, users };
}
test('native admin TOTP enrollment and challenge upgrade assurance without sending the secret to Express', async () => {
    const f = fixture();
    assert.deepEqual(await f.flow.mfaStatus(), { enrolled: false, factorId: null, aal: 'aal1' });
    const enrollment = await f.flow.mfaEnroll();
    assert.deepEqual(enrollment, { factorId: 'factor-a', secret: 'fixture-secret' });
    await assert.rejects(f.flow.mfaVerify(enrollment.factorId, '12345'), /seis dígitos/);
    assert.deepEqual(await f.flow.mfaVerify(enrollment.factorId, '123456'),
        { enrolled: true, factorId: 'factor-a', aal: 'aal2' });
    assert.equal(f.calls.some(call => call[0] === 'api'), false);
    assert.equal(f.calls.some(call => JSON.stringify(call).includes('fixture-secret')), false);
});
test('administrator password login can reach the native TOTP page when the AAL2 gate blocks other APIs', async () => {
    const f = fixture();
    f.state.codeRequired = false;
    const flow = createSupabaseAuthFlow({ supabase: { auth: f.a, supabaseUrl: 'https://fixture.supabase.co' },
        api: async path => {
            if (path === '/auth/code/start') throw Object.assign(new Error('Step up'),
                { status: 403, response: { data: { code: 'admin_mfa_required' } } });
            return { id: f.state.user.id, role: 'admin', admin_mfa_required: true, auth_aal: 'aal1' };
        }, origin, location: f.location, history: { replaceState() {} }, setToken() {}, setUser() {} });
    const profile = await flow.loginViaEmailPassword('a@example.test', 'Customer123');
    assert.equal(profile.role, 'admin');
    assert.equal(profile.auth_aal, 'aal1');
});
test('return URLs reject external, protocol-relative, script, backslash and credential-bearing destinations', () => {
    for (const path of ['https://evil.test', '//evil.test', 'javascript:alert(1)', '/\\evil.test', '/\npath']) assert.equal(authPath(path, origin), '/minha-conta');
    assert.equal(authPath('/minha-conta?code=secret&access_token=x&ok=1#secret', origin), '/minha-conta?ok=1');
    assert.match(authCallbackUrl(origin, 'recovery', '/reset-password'), /\/auth\/callback\?flow=recovery/);
    assert.throws(() => authCallbackUrl('https://evil.test'));
});
test('password policy rejects incomplete, too short, unbounded and missing character classes', () => {
    for (const p of ['', 'short1', 'abcdefgh', '12345678', 'x'.repeat(129) + '1', null]) assert.ok(passwordMessage(p));
    assert.equal(passwordMessage('Customer123'), '');
});
test('login normalizes email, preserves server role and does not grant metadata admin', async () => {
    const f = fixture(); f.state.user.user_metadata = { role: 'admin' };
    const profile = await f.flow.loginViaEmailPassword(' A@Example.test ', 'Customer123');
    assert.equal(profile.role, 'customer'); assert.equal(f.calls[0][1].email, 'a@example.test'); assert.equal(f.users.at(-1), profile);
});
test('wrong credentials and unconfirmed login return the same generic message without profile calls', async () => {
    for (const reason of ['wrong-password', 'email-not-confirmed']) {
        const f = fixture(); f.a.signInWithPassword = async () => ({ error: { message: reason } });
        await assert.rejects(f.flow.loginViaEmailPassword('a@example.test', 'Customer123'), /Confira e-mail e senha e a confirmação/);
        assert.equal(f.calls.filter(c => c[0] === 'api').length, 0);
    }
});
test('concurrent login submits one provider request', async () => {
    const f = fixture(); await Promise.all([f.flow.loginViaEmailPassword('a@example.test', 'Customer123'), f.flow.loginViaEmailPassword('a@example.test', 'Customer123')]);
    assert.equal(f.calls.filter(c => c[0] === 'login').length, 1);
});
test('password login with code required never loads profile before verification', async () => {
    const f = fixture(); f.state.codeRequired = true;
    const result = await f.flow.loginViaEmailPassword('a@example.test', 'Customer123');
    assert.equal(result.pending_code, true);
    assert.equal(f.calls.some(call => call[1] === '/auth/me'), false);
    await assert.rejects(f.flow.me(), { status: 401 });
    assert.equal(f.calls.some(call => call[1] === '/auth/me'), true);
    const profile = await f.flow.verifyLoginCode('012345');
    assert.equal(profile.role, 'customer');
    assert.equal(f.calls.find(call => call[1] === '/auth/code/verify')[2].body, '{"code":"012345"}');
});
test('resend uses the authenticated session but never includes code in a URL', async () => {
    const f = fixture(); f.state.codeRequired = true;
    await f.flow.loginViaEmailPassword('a@example.test', 'Customer123');
    await f.flow.resendLoginCode();
    assert.equal(f.calls.filter(call => call[1] === '/auth/code/start').length, 2);
    assert.equal(f.calls.some(call => String(call[1]).includes('012345')), false);
});
test('passwordless request never creates a user, never loads a profile and does not need a password session', async () => {
    const f = fixture(); f.state.session = null;
    const result = await f.flow.requestEmailOtp(' Customer@Example.test ');
    assert.deepEqual(result, { pending_otp: true, resend_after: 60 });
    assert.deepEqual(f.calls.find(c => c[0] === 'email-otp-request')[1],
        { email: 'customer@example.test', options: { shouldCreateUser: false } });
    assert.equal(f.calls.some(c => c[1] === '/auth/me'), false);
    assert.equal(f.tokens.length, 0);
});
test('unknown address and provider failure have the same neutral request result in the UI', async () => {
    for (const response of [{ data: null, error: { code: 'otp_disabled' } }, Promise.reject(new Error('network'))]) {
        const f = fixture(); f.state.session = null;
        f.a.signInWithOtp = async args => { f.calls.push(['email-otp-request', args]); return await response; };
        assert.deepEqual(await f.flow.requestEmailOtp('missing@example.test'), { pending_otp: true, resend_after: 60 });
        assert.equal(f.calls.some(c => c[1] === '/auth/me'), false);
    }
});
test('an unexpected provider session before OTP verification is revoked', async () => {
    const f = fixture(); const validSession = f.state.session; f.state.session = null;
    f.a.signInWithOtp = async () => ({ data: { session: validSession }, error: null });
    await assert.rejects(f.flow.requestEmailOtp('a@example.test'), /Não foi possível iniciar/);
    assert.deepEqual(f.calls.find(c => c[0] === 'signOut')[1], { scope: 'local' });
    assert.equal(f.tokens.at(-1), null);
});
test('passwordless verification creates the first app session only after Supabase accepts the six digits', async () => {
    const f = fixture(); const validSession = f.state.session; f.state.session = null;
    f.a.verifyOtp = async args => { f.calls.push(['otp', args]); f.state.session = validSession; return { data: { session: validSession }, error: null }; };
    await f.flow.requestEmailOtp('A@Example.test');
    await assert.rejects(f.flow.verifyEmailOtp('A@Example.test', '123'), /seis dígitos/);
    assert.equal(f.calls.some(c => c[1] === '/auth/me'), false);
    const profile = await f.flow.verifyEmailOtp('A@Example.test', '012345');
    assert.equal(profile.role, 'customer');
    assert.deepEqual(f.calls.find(c => c[0] === 'otp')[1], { email: 'a@example.test', token: '012345', type: 'email' });
    assert.equal(f.calls.filter(c => c[1] === '/auth/me').length, 1);
    assert.equal(f.tokens.at(-1), validSession.access_token);
});
test('rejected OTP cannot load a profile and existing sessions cannot request another account login', async () => {
    const f = fixture();
    await assert.rejects(f.flow.requestEmailOtp('b@example.test'), /já está conectada/);
    assert.equal(f.calls.some(c => c[0] === 'email-otp-request'), false);
    f.state.session = null;
    f.a.verifyOtp = async args => { f.calls.push(['otp', args]); return { data: null, error: { code: 'otp_expired' } }; };
    await assert.rejects(f.flow.verifyEmailOtp('a@example.test', '123456'), /inválido ou expirado/);
    assert.equal(f.calls.some(c => c[1] === '/auth/me'), false);
});
test('a Supabase OTP session for another identity is cleared before app profile access', async () => {
    const f = fixture(); const validSession = f.state.session; f.state.session = null;
    f.a.verifyOtp = async () => ({ data: { session: { ...validSession, user: { id: 'different-account' } } }, error: null });
    await assert.rejects(f.flow.verifyEmailOtp('a@example.test', '123456'), /não corresponde/);
    assert.deepEqual(f.calls.find(c => c[0] === 'signOut')[1], { scope: 'local' });
    assert.equal(f.calls.some(c => c[1] === '/auth/me'), false);
    assert.equal(f.tokens.at(-1), null);
});
test('passwordless resend calls Supabase again without an app session or profile request', async () => {
    const f = fixture(); f.state.session = null;
    await f.flow.requestEmailOtp('a@example.test');
    await f.flow.requestEmailOtp('a@example.test');
    assert.equal(f.calls.filter(c => c[0] === 'email-otp-request').length, 2);
    assert.equal(f.calls.some(c => c[1] === '/auth/me'), false);
    assert.equal(f.tokens.length, 0);
});
test('registration uses PKCE callback and records successful pending signup without repeating it for provisioning', async () => {
    const f = fixture(); const result = await f.flow.register({ email: 'a@example.test', password: 'Customer123', full_name: ' Customer ' });
    assert.equal(result.pending_verification, true); assert.equal(result.registered, true);
    assert.equal(f.calls[0][1].options.data.full_name, 'Customer'); assert.match(f.calls[0][1].options.emailRedirectTo, /auth\/callback/);
    assert.equal(f.calls.some(c => c[0] === 'api'), false);
});
test('Google OAuth requests same-origin PKCE callback and validates provider destination', async () => {
    const f = fixture(); await f.flow.loginWithProvider('google', 'https://evil.test');
    const options = f.calls.find(c => c[0] === 'google')[1].options;
    assert.equal(options.skipBrowserRedirect, true); assert.equal(new URL(options.redirectTo).searchParams.get('returnTo'), '/minha-conta');
    assert.match(f.calls.at(-1)[1], /fixture.supabase.co\/auth\/v1\/authorize/);
});
test('OAuth rejects hostile redirect and unexpected provider before navigation', async () => {
    const f = fixture(); f.a.signInWithOAuth = async () => ({ data: { url: 'https://evil.test/auth/v1/authorize?provider=google' } });
    await assert.rejects(f.flow.loginWithProvider('google', '/minha-conta'), /inválido/);
    await assert.rejects(f.flow.loginWithProvider('github', '/minha-conta'), /não autorizado/);
    assert.equal(f.calls.some(c => c[0] === 'navigate'), false);
});
test('callback cleans sensitive URL before exchange, handles duplicates once and returns a safe destination', async () => {
    const f = fixture(); f.location.href += '&returnTo=https://evil.test';
    const results = await Promise.all([f.flow.finishCallback(), f.flow.finishCallback()]);
    assert.equal(f.calls[0][0], 'clean'); assert.equal(f.calls.filter(c => c[0] === 'exchange').length, 1);
    assert.equal(results[0].path, '/minha-conta'); assert.deepEqual(results[0], results[1]);
});
test('a later callback in the same SPA is exchanged independently', async () => {
    const f = fixture(); await f.flow.finishCallback(); f.location.href = origin + '/auth/callback?code=next-code';
    await f.flow.finishCallback(); assert.equal(f.calls.filter(c => c[0] === 'exchange').length, 2);
});
test('confirmed signup with a mismatched PKCE verifier directs the customer to password login', async () => {
    const f = fixture();
    f.location.href = origin + '/auth/callback?code=confirmed-code&flow=signup';
    f.a.exchangeCodeForSession = async () => ({ error: { code: 'bad_code_verifier', message: 'code challenge does not match previously saved code verifier' } });
    await assert.rejects(f.flow.finishCallback(), error => error.reason === 'session_not_opened' && /Entre com sua senha/.test(error.message));
    assert.equal(f.calls[0][0], 'clean');
});
test('signup token hash verifies directly without a PKCE code verifier', async () => {
    const f = fixture();
    f.location.href = origin + '/auth/callback?flow=signup&returnTo=%2Fminha-conta%2Fdados#token_hash=synthetic-hash&type=email';
    assert.deepEqual(await f.flow.finishCallback(), { path: '/minha-conta/dados' });
    assert.deepEqual(f.calls.find(c => c[0] === 'otp')[1], { token_hash: 'synthetic-hash', type: 'email' });
    assert.equal(f.calls.some(c => c[0] === 'exchange'), false);
    assert.equal(f.calls[0][0], 'clean');
});
test('a later token hash callback in the same SPA is verified independently', async () => {
    const f = fixture();
    await f.flow.finishCallback();
    f.location.href = origin + '/auth/callback?flow=signup#token_hash=second-hash&type=email';
    await f.flow.finishCallback();
    assert.equal(f.calls.filter(c => c[0] === 'otp').length, 1);
});
test('a valid Auth session is not mistaken for an expired link when profile API is unavailable', async () => {
    const f = fixture();
    assert.deepEqual(await f.flow.finishCallback(), { path: '/minha-conta' });
    assert.equal(f.calls.some(c => c[0] === 'api'), false);
});
test('invalid, expired, ambiguous, cancelled and implicit-token callbacks fail without password capability', async () => {
    for (const query of ['', '?error=denied', '?access_token=synthetic#refresh_token=synthetic', '?code=a&token_hash=b&type=recovery', '?token_hash=b&type=sms']) {
        const f = fixture(); f.location.href = origin + '/auth/callback' + query;
        await assert.rejects(f.flow.finishCallback()); assert.equal(f.flow.recoveryReady(), false);
        assert.equal(f.calls.some(c => ['exchange', 'update', 'otp'].includes(c[0])), false);
    }
    const f = fixture(); f.a.exchangeCodeForSession = async () => ({ error: { message: 'expired' } });
    await assert.rejects(f.flow.finishCallback(), /expirado ou já utilizado/); assert.equal(f.flow.recoveryReady(), false);
});
test('forged recovery query cannot turn a login code into password recovery', async () => {
    const f = fixture(); f.location.href = origin + '/auth/callback?code=login-code&flow=recovery';
    await assert.rejects(f.flow.finishCallback(), /não autoriza/); assert.equal(f.flow.recoveryReady(), false);
    await assert.rejects(f.flow.resetPassword({ newPassword: 'Customer123' }));
    assert.equal(f.calls.some(c => c[0] === 'update'), false);
});
async function authorizeRecovery(f, hash = false) {
    f.state.redirectType = 'recovery';
    f.location.href = origin + '/auth/callback?flow=recovery&' + (hash ? 'token_hash=synthetic-hash&type=recovery' : 'code=recovery-code');
    assert.deepEqual(await f.flow.finishCallback(), { path: '/reset-password', recovery: true });
}
test('verified PKCE recovery updates password once, consumes capability and signs out globally', async () => {
    const f = fixture(); await authorizeRecovery(f);
    await Promise.all([f.flow.resetPassword({ newPassword: 'Customer123' }), f.flow.resetPassword({ newPassword: 'Customer123' })]);
    assert.equal(f.calls.filter(c => c[0] === 'update').length, 1); assert.deepEqual(f.calls.at(-1), ['signOut', { scope: 'global' }]);
    assert.equal(f.flow.recoveryReady(), false); await assert.rejects(f.flow.resetPassword({ newPassword: 'Customer123' }));
});
test('a valid recovery token hash requires official verifyOtp and the recovery purpose', async () => {
    const f = fixture(); await authorizeRecovery(f, true);
    assert.deepEqual(f.calls.find(c => c[0] === 'otp')[1], { token_hash: 'synthetic-hash', type: 'recovery' });
    assert.equal(f.flow.recoveryReady(), true);
});
test('recovery cannot cross accounts, changed sessions or expired capability', async () => {
    for (const change of [f => { f.state.session.user.id = 'account-b'; }, f => { f.state.session.access_token = 'other-token'; }, f => { f.state.time += 16 * 60 * 1000; }]) {
        const f = fixture(); await authorizeRecovery(f); change(f);
        await assert.rejects(f.flow.resetPassword({ newPassword: 'Customer123' })); assert.equal(f.calls.some(c => c[0] === 'update'), false);
    }
});
test('weak recovery password and provider failure preserve retry without falsely reporting success', async () => {
    const f = fixture(); await authorizeRecovery(f);
    await assert.rejects(f.flow.resetPassword({ newPassword: 'weak' }));
    f.a.updateUser = async () => ({ error: { code: 'provider-unavailable' } });
    await assert.rejects(f.flow.resetPassword({ newPassword: 'Customer123' })); assert.equal(f.flow.recoveryReady(), true);
});
test('recovery request uses approved callback without enumerating accounts', async () => {
    const f = fixture(); assert.deepEqual(await f.flow.resetPasswordRequest(' A@Example.test '), {});
    assert.equal(f.calls[0][1], 'a@example.test'); assert.match(f.calls[0][2].redirectTo, /flow=recovery/);
    await assert.rejects(f.flow.resetPasswordRequest('invalid'));
});
test('email change checks backend identity before Auth and does not overwrite the unconfirmed profile', async () => {
    const f = fixture(); f.state.user.new_email = 'new@example.test';
    const result = await f.flow.changeEmail(' NEW@Example.test ');
    assert.equal(f.calls[0][1], '/auth/email-change/preview'); assert.equal(result.pending, true); assert.equal(result.email, 'a@example.test');
    assert.equal(f.calls.some(c => c[0] === 'api' && c[2]?.method === 'PATCH'), false);
});
test('password change handles required reauthentication, nonce and Google identity without deleting its provider', async () => {
    const f = fixture(); f.a.updateUser = async () => ({ error: { code: 'reauthentication_needed' } });
    assert.deepEqual(await f.flow.changePassword({ newPassword: 'Customer123' }), { reauthentication_required: true });
    await f.flow.requestReauthentication(); assert.equal(f.calls.at(-1)[0], 'reauthenticate');
    const g = fixture(); g.state.user.app_metadata.providers = ['google']; await g.flow.changePassword({ newPassword: 'Customer123', nonce: 'synthetic-nonce' });
    assert.deepEqual(g.calls.find(c => c[0] === 'update')[1], { password: 'Customer123', nonce: 'synthetic-nonce' });
    assert.deepEqual(g.state.user.app_metadata.providers, ['google']);
});
test('logout failure still erases local account and recovery state', async () => {
    const f = fixture(); await authorizeRecovery(f); f.a.signOut = async () => ({ error: { message: 'unavailable' } });
    await assert.rejects(f.flow.logout()); assert.equal(f.tokens.at(-1), null); assert.equal(f.users.at(-1), null); assert.equal(f.flow.recoveryReady(), false);
});
test('signed-out session immediately erases caches and asynchronous listener is unsubscribed', async () => {
    const f = fixture(); const events = []; const unsubscribe = f.flow.onSessionChange(event => events.push(event));
    f.state.listener('SIGNED_OUT', null); assert.equal(f.tokens.at(-1), null); assert.equal(f.users.at(-1), null);
    await new Promise(resolve => setTimeout(resolve, 5)); assert.deepEqual(events, ['SIGNED_OUT']); unsubscribe(); assert.equal(f.calls.at(-1)[0], 'unsubscribe');
});
test('session fence blocks requests crossing accounts or logout but accepts same-account token refresh', () => {
    const f = createSessionFence(); f.initialize('a'); const request = f.capture(); f.observe('a'); f.assert(request);
    f.observe('b'); assert.throws(() => f.assert(request), { status: 401 }); const next = f.capture(); f.observe(null); assert.throws(() => f.assert(next));
});
test('custom dialogs cancel, trim prompts and settle a confirmation once despite repeated clicks', async () => {
    const states = [], dialogs = createDialogRequests(value => states.push(value));
    const first = dialogs.request({ mode: 'confirm' }); assert.equal(await dialogs.request({ mode: 'confirm' }), false);
    dialogs.settle(true); dialogs.settle(false); assert.equal(await first, true);
    const prompt = dialogs.request({ mode: 'prompt' }); dialogs.settle(true, '  Único  '); assert.equal(await prompt, 'Único');
    const cancelled = dialogs.request({ mode: 'prompt' }); dialogs.cancel(); assert.equal(await cancelled, null); assert.equal(states.at(-1), null);
});
test('provider capability query fails closed and exposes only enabled status, never keys or settings', async () => {
    const env = { SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-secret' };
    const result = await authCapabilities({ env, request: async (_url, options) => {
        assert.equal(options.headers.apikey, 'synthetic-secret'); return { ok: true, json: async () => ({ external: { google: true }, private: 'not-returned' }) };
    } });
    assert.deepEqual(result, { available: true, google: true });
    assert.deepEqual(await authCapabilities({ env, request: async () => { throw Error('unavailable'); } }), { available: false, google: false });
    assert.deepEqual(await authCapabilities({ env: {} }), { available: false, google: false });
});
