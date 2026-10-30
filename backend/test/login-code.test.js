import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { codeMac, createLoginCodeCleanupWorker, loginCodeEmail, loginCodeEnabled, sessionAllowed, trustedSession } from '../src/services/loginCode.js';

const user = { id: 'a546381d-a6a1-4f7c-a0ac-95dbb2f97ff2' };
const sessionId = '37c39827-a18c-4dd7-9309-85cb06cb59a8';
const token = method => jwt.sign({ sub: user.id, session_id: sessionId, role: 'authenticated', amr: [{ method }] }, 'fixture-only');

test('feature is off unless explicitly enabled', () => {
    assert.equal(loginCodeEnabled({}), false);
    assert.equal(loginCodeEnabled({ LOGIN_EMAIL_CODE_ENABLED: 'TRUE' }), false);
    assert.equal(loginCodeEnabled({ LOGIN_EMAIL_CODE_ENABLED: 'true' }), true);
    assert.equal(loginCodeEnabled({ NODE_ENV: 'production', LOGIN_EMAIL_CODE_ENABLED: 'true' }), false);
});

test('trusted claims are bound to the Auth-verified user and a valid session', () => {
    assert.equal(trustedSession(token('password'), user)?.method, 'password');
    assert.equal(trustedSession(token('oauth'), user)?.method, 'oauth');
    assert.equal(trustedSession(token('recovery'), user)?.method, 'other');
    assert.equal(trustedSession(token('password'), { id: randomUUID() }), null);
    assert.equal(trustedSession('garbage', user), null);
});

test('password sessions require exact server verification; refresh remains bound to session ID', async () => {
    const password = trustedSession(token('password'), user);
    const google = trustedSession(token('oauth'), user);
    const recovery = trustedSession(token('recovery'), user);
    const db = { query: async (_sql, params) => ({ rowCount: params?.[0] === sessionId && params?.[1] === user.id ? 1 : 0 }) };
    assert.equal(await sessionAllowed(db, password), true);
    assert.equal(await sessionAllowed(db, { ...password, sessionId: randomUUID() }), false);
    assert.equal(await sessionAllowed(db, google), true);
    assert.equal(await sessionAllowed(db, recovery), false);
    assert.equal(await sessionAllowed(db, null), false);
});

test('codes are bound to session with a secret and never included in the database value', () => {
    const env = { LOGIN_EMAIL_CODE_HMAC_SECRET: 'a'.repeat(64) };
    const first = codeMac('000123', sessionId, env);
    assert.equal(first.length, 32);
    assert.equal(first.toString('hex').includes('000123'), false);
    assert.notDeepEqual(first, codeMac('000124', sessionId, env));
    assert.notDeepEqual(first, codeMac('000123', randomUUID(), env));
    assert.throws(() => codeMac('000123', sessionId, {}));
});

test('login email uses the requested subject and expiry without order settings', () => {
    const email = loginCodeEmail('000123');
    assert.match(email.subject, /Seu código de acesso/);
    assert.match(email.text, /000123/);
    assert.match(email.html, /000123/);
    assert.match(email.text, /5 minutos/);
});

test('cleanup worker remains inert while email-code activation is off', async () => {
    let queries = 0;
    const worker = createLoginCodeCleanupWorker({ db: { query: () => { queries++; } }, env: {}, intervalMs: 5 });
    worker.start();
    await new Promise(resolve => setTimeout(resolve, 25));
    worker.stop();
    assert.equal(queries, 0);
});
