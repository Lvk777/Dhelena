import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseAuthFlow, authPath, authCallbackUrl, passwordMessage } from '../../src/lib/supabaseAuthFlow.js';
import { createSessionFence } from '../../src/lib/sessionFence.js';
import { createDialogRequests } from '../../src/lib/dialogRequest.js';
import { authCapabilities } from '../src/lib/authCapabilities.js';
const origin = 'https://dhelenas.com';
function fixture() {
    const calls = [], tokens = [], users = [];
    const state = { time: 1000000, session: { access_token: 'synthetic-token', expires_at: 5000, user: { id: 'account-a' } },
        user: { id: 'account-a', email: 'a@example.test', email_confirmed_at: 'confirmed', app_metadata: { providers: ['email'] } }, redirectType: 'login' };
    const reply = data => ({ data, error: null });
    const a = {
        getSession: async () => reply({ session: state.session }), getUser: async () => reply({ user: state.user }),
        signInWithPassword: async args => { calls.push(['login', args]); return reply({ session: state.session }); },
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
    const api = async (path, options) => { calls.push(['api', path, options]); return { id: state.user.id, role: 'customer', email: state.user.email, email_change_supported: true }; };
    const flow = createSupabaseAuthFlow({ supabase: { auth: a, supabaseUrl: 'https://fixture.supabase.co' }, api, origin, location, history,
        now: () => state.time, setToken: v => tokens.push(v), setUser: v => users.push(v) });
    return { flow, a, state, calls, location, tokens, users };
}
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
test('invalid, expired, ambiguous, cancelled and implicit-token callbacks fail without password capability', async () => {
    for (const query of ['', '?error=denied', '?access_token=synthetic#refresh_token=synthetic', '?code=a&token_hash=b&type=recovery', '?token_hash=b&type=invite']) {
        const f = fixture(); f.location.href = origin + '/auth/callback' + query;
        await assert.rejects(f.flow.finishCallback()); assert.equal(f.flow.recoveryReady(), false);
        assert.equal(f.calls.some(c => ['exchange', 'update', 'otp'].includes(c[0])), false);
    }
    const f = fixture(); f.a.exchangeCodeForSession = async () => ({ error: { message: 'expired' } });
    await assert.rejects(f.flow.finishCallback()); assert.equal(f.flow.recoveryReady(), false);
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
