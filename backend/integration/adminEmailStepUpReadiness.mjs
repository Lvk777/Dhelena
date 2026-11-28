import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { createAdminEmailStepUp } from '../src/services/adminEmailStepUp.js';

const url = new URL(process.env.TEST_DATABASE_URL || '');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/dhelenas_admin_stepup_test') {
    throw new Error('Use somente o banco local descartável dhelenas_admin_stepup_test.');
}
const db = new pg.Pool({ connectionString: url.href });
const env = { ADMIN_EMAIL_CODE_HMAC_SECRET: 'synthetic-admin-code-hmac-secret-for-isolated-tests', RESEND_API_KEY: 'synthetic' };
let clock = new Date('2026-10-30T18:00:00Z');
let delivered = [];
let deliveryFails = false;
const send = async payload => {
    if (deliveryFails) throw new Error('synthetic delivery failed');
    assert.equal(payload.from, 'D’Helenas Boutique <contato@dhelenas.com>');
    assert.equal(payload.to, 'admin@example.test');
    const code = payload.text.match(/\b\d{6}\b/)?.[0];
    assert.match(code, /^\d{6}$/);
    delivered.push(code);
    return { data: { id: 'synthetic-id' } };
};
const service = createAdminEmailStepUp({ db, env, send, now: () => clock });
const advance = ms => { clock = new Date(clock.getTime() + ms); };
const reject = (action, status) => assert.rejects(action, error => error.status === status);
const authId = randomUUID();
const profileId = randomUUID();
const profile = { id: profileId, role: 'admin' };
const session = { userId: authId, sessionId: randomUUID(), aal: 'aal1' };
const anotherSession = { ...session, sessionId: randomUUID() };
const bootstrap = 'synthetic-out-of-band-bootstrap-secret-64-character-value';
const passphrase = 'synthetic-independent-administrative-passphrase';

try {
    await db.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END $$`);
    await db.query('CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text NOT NULL)');
    await db.query('INSERT INTO public.profiles(id,role) VALUES ($1,$2)', [profileId, 'admin']);
    await db.query(await readFile(new URL('../migrations/021_admin_email_step_up.sql', import.meta.url), 'utf8'));
    const grants = await db.query(`SELECT has_table_privilege('authenticated','public.admin_email_credentials','SELECT') AS credentials,
        has_table_privilege('authenticated','public.admin_email_challenges','SELECT') AS challenges,
        has_table_privilege('authenticated','public.admin_session_grants','SELECT') AS sessions`);
    assert.deepEqual(Object.values(grants.rows[0]), [false, false, false]);
    await db.query(`INSERT INTO admin_email_credentials(auth_user_id,profile_id,destination_email,bootstrap_hash)
        VALUES($1,$2,$3,$4)`, [authId, profileId, 'admin@example.test', await bcrypt.hash(bootstrap, 12)]);
    assert.equal(await service.enrolled(session, profile), false);
    await reject(() => service.setup(session, profile, 'incorrect-bootstrap-secret-with-enough-length', passphrase), 403);
    await reject(() => service.setup({ ...session, userId: randomUUID() }, profile, bootstrap, passphrase), 403);
    assert.deepEqual(await service.setup(session, profile, bootstrap, passphrase), { enrolled: true });
    assert.equal(await service.enrolled(session, profile), true);
    const storedPassphrase = (await db.query('SELECT passphrase_hash,bootstrap_hash FROM admin_email_credentials WHERE auth_user_id=$1', [authId])).rows[0];
    assert.equal(storedPassphrase.passphrase_hash.includes(passphrase), false);
    assert.equal(storedPassphrase.bootstrap_hash, null);
    await reject(() => service.setup(session, profile, bootstrap, passphrase), 403);
    assert.equal(await service.granted(session, profile), false);
    assert.equal(await service.granted({ ...session, userId: randomUUID() }, profile), false);

    await reject(() => service.start(session, profile, 'incorrect-independent-passphrase'), 403);
    assert.equal((await db.query('SELECT failed_attempts FROM admin_email_credentials')).rows[0].failed_attempts, 1);
    await service.start(session, profile, passphrase);
    const firstCode = delivered.at(-1);
    const stored = await db.query('SELECT code_mac FROM admin_email_challenges WHERE session_id=$1', [session.sessionId]);
    assert.equal(stored.rows[0].code_mac.length, 32);
    assert.equal(stored.rows[0].code_mac.includes(Buffer.from(firstCode)), false);
    await reject(() => service.verify(anotherSession, profile, firstCode), 403);
    await reject(() => service.verify(session, profile, firstCode === '000000' ? '000001' : '000000'), 403);
    assert.equal((await db.query('SELECT attempts FROM admin_email_challenges')).rows[0].attempts, 1);
    assert.equal((await service.verify(session, profile, firstCode)).verified, true);
    assert.equal(await service.granted(session, profile), true);
    assert.equal(await service.granted(anotherSession, profile), false);
    assert.equal(await service.granted(session, { id: randomUUID(), role: 'admin' }), false);
    await reject(() => service.verify(session, profile, firstCode), 403);
    advance(30 * 60_000 + 1);
    assert.equal(await service.granted(session, profile), false);

    await service.start(session, profile, passphrase);
    const expired = delivered.at(-1);
    advance(5 * 60_000 + 1);
    await reject(() => service.verify(session, profile, expired), 403);
    await service.start(session, profile, passphrase);
    const second = delivered.at(-1);
    await reject(() => service.verify(session, profile, expired), 403);
    assert.equal((await service.verify(session, profile, second)).verified, true);
    await service.revoke(session);
    assert.equal(await service.granted(session, profile), false);

    advance(60_000);
    deliveryFails = true;
    await reject(() => service.start(session, profile, passphrase), 503);
    deliveryFails = false;
    const before = delivered.length;
    const concurrent = await Promise.allSettled([service.start(session, profile, passphrase), service.start(session, profile, passphrase)]);
    assert.deepEqual(concurrent.map(item => item.status).sort(), ['fulfilled', 'rejected']);
    assert.equal(delivered.length, before + 1);
    const lastCode = delivered.at(-1);
    const wrong = lastCode === '111111' ? '222222' : '111111';
    for (let index = 0; index < 5; index++) await reject(() => service.verify(session, profile, wrong), 403);
    await reject(() => service.verify(session, profile, lastCode), 403);
    assert.equal(await service.granted(session, profile), false);
    for (let index = 0; index < 5; index++) await reject(() => service.start(session, profile, 'incorrect-independent-passphrase'), 403);
    await reject(() => service.start(session, profile, passphrase), 429);
    const version = (await db.query('SELECT credential_version FROM admin_email_credentials WHERE auth_user_id=$1', [authId])).rows[0].credential_version;
    await db.query(`INSERT INTO admin_session_grants(session_id,auth_user_id,credential_version,verified_at,expires_at)
        VALUES($1,$2,$3,$4,$5)`, [anotherSession.sessionId, authId, version, clock, new Date(clock.getTime() + 30 * 60_000)]);
    assert.equal(await service.granted(anotherSession, profile), true);
    await db.query('UPDATE admin_email_credentials SET credential_version=credential_version+1 WHERE auth_user_id=$1', [authId]);
    assert.equal(await service.granted(anotherSession, profile), false);
    const events = await db.query('SELECT event_type FROM admin_step_up_events ORDER BY id');
    assert.ok(events.rows.some(row => row.event_type === 'enrolled'));
    assert.ok(events.rows.some(row => row.event_type === 'verified'));
    assert.ok(events.rows.some(row => row.event_type === 'code_failed'));
    assert.ok(events.rows.some(row => row.event_type === 'passphrase_failed'));
    assert.ok(events.rows.every(row => !Object.values(row).includes(lastCode)));
    const otherAuth = randomUUID();
    const otherProfile = { id: randomUUID(), role: 'admin' };
    const otherSession = { userId: otherAuth, sessionId: randomUUID() };
    await db.query('INSERT INTO profiles(id,role) VALUES($1,$2)', [otherProfile.id, 'admin']);
    await db.query(`INSERT INTO admin_email_credentials(auth_user_id,profile_id,destination_email,bootstrap_hash)
        VALUES($1,$2,$3,$4)`, [otherAuth, otherProfile.id, 'admin@example.test', await bcrypt.hash(bootstrap, 12)]);
    for (let index = 0; index < 5; index++) await reject(() => service.setup(otherSession, otherProfile,
        'incorrect-bootstrap-secret-with-enough-length', passphrase), 403);
    assert.ok(new Date((await db.query('SELECT locked_until FROM admin_email_credentials WHERE auth_user_id=$1', [otherAuth])).rows[0].locked_until) > clock);
    await reject(() => service.setup(otherSession, otherProfile, bootstrap, passphrase), 403);
    console.log('PostgreSQL isolated admin step-up: private grants, immutable IDs, independent bootstrap, passphrase, code, replay, expiry, session binding, delivery failure and concurrency passed.');
} finally { await db.end(); }
