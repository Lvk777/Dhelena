import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Resend } from 'resend';

const invalid = (status = 403) => Object.assign(new Error('Verificação administrativa indisponível ou inválida.'), { status });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const minute = 60_000;
const safePassphrase = value => typeof value === 'string' && value.length >= 16 && Buffer.byteLength(value, 'utf8') <= 72;

export const adminEmailGateEnabled = (env = process.env) => env.ADMIN_EMAIL_STEP_UP_REQUIRED === 'true';

export function adminCodeMac(code, sessionId, userId, env = process.env) {
    if (typeof env.ADMIN_EMAIL_CODE_HMAC_SECRET !== 'string' || env.ADMIN_EMAIL_CODE_HMAC_SECRET.length < 32) throw invalid(503);
    return createHmac('sha256', env.ADMIN_EMAIL_CODE_HMAC_SECRET).update(`${userId}:${sessionId}:${code}`).digest();
}

export function adminCodeEmail(code) {
    return {
        subject: 'Confirme o acesso administrativo — D’Helenas Boutique',
        text: `Seu código para acessar a administração da D’Helenas é ${code}. Ele expira em 5 minutos. Se você não iniciou esta verificação, ignore a mensagem.`,
        html: `<div style="font-family:Georgia,serif;color:#292526;background:#faf7f2;padding:32px"><h1>D’Helenas Boutique</h1><p>Use este código para confirmar seu acesso administrativo:</p><p style="font-size:32px;letter-spacing:.2em">${code}</p><p>O código expira em 5 minutos. Se você não iniciou esta verificação, ignore a mensagem.</p></div>`,
    };
}

export function createAdminEmailStepUp({ db, env = process.env,
    send = async payload => new Resend(env.RESEND_API_KEY).emails.send(payload, { signal: AbortSignal.timeout(15_000) }),
    now = () => new Date() } = {}) {
    const validSession = (session, profile) => session && uuid.test(session.userId || '')
        && uuid.test(session.sessionId || '') && profile?.role === 'admin' && uuid.test(profile.id || '');
    const audit = (client, session, event) => client.query(`INSERT INTO admin_step_up_events
        (auth_user_id,session_id,event_type) VALUES ($1,$2,$3)`, [session.userId, session.sessionId, event]);
    async function credential(client, session, profile, lock = false) {
        const result = await client.query(`SELECT auth_user_id, profile_id, destination_email, passphrase_hash,
            bootstrap_hash, credential_version, failed_attempts, locked_until
            FROM admin_email_credentials WHERE auth_user_id = $1 AND profile_id = $2 ${lock ? 'FOR UPDATE' : ''}`,
        [session.userId, profile.id]);
        return result.rows[0];
    }
    async function enrolled(session, profile) {
        if (!validSession(session, profile)) return false;
        const row = await credential(db, session, profile);
        return !!row?.passphrase_hash;
    }
    async function granted(session, profile) {
        if (!validSession(session, profile)) return false;
        const result = await db.query(`SELECT 1 FROM admin_session_grants g
            JOIN admin_email_credentials c ON c.auth_user_id = g.auth_user_id
            WHERE g.auth_user_id = $1 AND c.profile_id = $2 AND g.session_id = $3
              AND g.credential_version = c.credential_version AND c.passphrase_hash IS NOT NULL
              AND g.expires_at > $4`, [session.userId, profile.id, session.sessionId, now()]);
        return result.rowCount === 1;
    }
    async function setup(session, profile, bootstrap, passphrase) {
        if (!validSession(session, profile) || !safePassphrase(passphrase)
            || typeof bootstrap !== 'string' || bootstrap.length < 32 || Buffer.byteLength(bootstrap, 'utf8') > 72) throw invalid(400);
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const row = await credential(client, session, profile, true);
            const current = now();
            if (!row || row.passphrase_hash || !row.bootstrap_hash || row.locked_until && new Date(row.locked_until) > current) throw invalid();
            if (!await bcrypt.compare(bootstrap, row.bootstrap_hash)) {
                const failures = row.failed_attempts + 1;
                await client.query(`UPDATE admin_email_credentials SET failed_attempts=$2, locked_until=$3,
                    updated_at=$4 WHERE auth_user_id=$1`, [session.userId, failures,
                    failures >= 5 ? new Date(current.getTime() + 15 * minute) : null, current]);
                await audit(client, session, 'bootstrap_failed');
                await client.query('COMMIT');
                throw Object.assign(invalid(), { committed: true });
            }
            const hash = await bcrypt.hash(passphrase, 12);
            await client.query(`UPDATE admin_email_credentials SET passphrase_hash=$3, bootstrap_hash=NULL,
                credential_version=credential_version+1, failed_attempts=0, locked_until=NULL, updated_at=$4
                WHERE auth_user_id=$1 AND profile_id=$2`, [session.userId, profile.id, hash, current]);
            await client.query('DELETE FROM admin_session_grants WHERE auth_user_id=$1', [session.userId]);
            await audit(client, session, 'enrolled');
            await client.query('COMMIT');
            return { enrolled: true };
        } catch (error) { if (!error.committed) await client.query('ROLLBACK'); throw error.status ? error : invalid(503); }
        finally { client.release(); }
    }
    async function start(session, profile, passphrase) {
        if (!validSession(session, profile) || !safePassphrase(passphrase) || !env.RESEND_API_KEY) throw invalid(503);
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`admin-code:${session.userId}`]);
            const row = await credential(client, session, profile, true);
            const current = now();
            if (!row?.passphrase_hash || row.locked_until && new Date(row.locked_until) > current) throw invalid(429);
            await client.query('DELETE FROM admin_email_challenges WHERE auth_user_id=$1 AND sent_at<$2',
                [session.userId, new Date(current.getTime() - 24 * 60 * minute)]);
            await client.query('DELETE FROM admin_session_grants WHERE auth_user_id=$1 AND expires_at<$2',
                [session.userId, current]);
            if (!await bcrypt.compare(passphrase, row.passphrase_hash)) {
                const failures = row.failed_attempts + 1;
                await client.query(`UPDATE admin_email_credentials SET failed_attempts=$2,
                    locked_until=$3, updated_at=$4 WHERE auth_user_id=$1`,
                [session.userId, failures, failures >= 5 ? new Date(current.getTime() + 15 * minute) : null, current]);
                await audit(client, session, 'passphrase_failed');
                await client.query('COMMIT');
                throw Object.assign(invalid(), { committed: true });
            }
            const last = await client.query(`SELECT sent_at FROM admin_email_challenges
                WHERE auth_user_id=$1 ORDER BY sent_at DESC LIMIT 1`, [session.userId]);
            if (last.rows[0] && current - new Date(last.rows[0].sent_at) < minute) throw invalid(429);
            const count = await client.query(`SELECT count(*)::int AS total FROM admin_email_challenges
                WHERE auth_user_id=$1 AND sent_at>$2`, [session.userId, new Date(current.getTime() - 60 * minute)]);
            if (count.rows[0].total >= 5) throw invalid(429);
            const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
            const mac = adminCodeMac(code, session.sessionId, session.userId, env);
            const delivery = await send({ from: 'D’Helenas Boutique <contato@dhelenas.com>',
                to: row.destination_email, replyTo: 'contato@dhelenas.com', ...adminCodeEmail(code) });
            if (delivery?.error || !delivery?.data?.id) throw invalid(503);
            await client.query(`UPDATE admin_email_challenges SET consumed_at=$3
                WHERE auth_user_id=$1 AND session_id=$2 AND consumed_at IS NULL`, [session.userId, session.sessionId, current]);
            await client.query(`INSERT INTO admin_email_challenges
                (auth_user_id,session_id,credential_version,code_mac,sent_at,expires_at)
                VALUES ($1,$2,$3,$4,$5,$6)`, [session.userId, session.sessionId, row.credential_version,
                mac, current, new Date(current.getTime() + 5 * minute)]);
            await client.query(`UPDATE admin_email_credentials SET failed_attempts=0, locked_until=NULL,
                updated_at=$2 WHERE auth_user_id=$1`, [session.userId, current]);
            await audit(client, session, 'code_sent');
            await client.query('COMMIT');
            return { sent: true, expires_in: 300, resend_after: 60 };
        } catch (error) {
            if (!error.committed) await client.query('ROLLBACK');
            throw error.status ? error : invalid(503);
        } finally { client.release(); }
    }
    async function verify(session, profile, code) {
        if (!validSession(session, profile) || !/^\d{6}$/.test(code || '')) throw invalid(400);
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const row = await credential(client, session, profile, true);
            if (!row?.passphrase_hash) throw invalid();
            const result = await client.query(`SELECT id, code_mac, credential_version, expires_at, attempts, consumed_at
                FROM admin_email_challenges WHERE auth_user_id=$1 AND session_id=$2
                ORDER BY sent_at DESC LIMIT 1 FOR UPDATE`, [session.userId, session.sessionId]);
            const challenge = result.rows[0];
            const current = now();
            if (!challenge || challenge.consumed_at || challenge.attempts >= 5
                || new Date(challenge.expires_at) <= current || challenge.credential_version !== row.credential_version) throw invalid();
            const actual = Buffer.from(challenge.code_mac);
            const expected = adminCodeMac(code, session.sessionId, session.userId, env);
            if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
                await client.query('UPDATE admin_email_challenges SET attempts=attempts+1 WHERE id=$1', [challenge.id]);
                await audit(client, session, 'code_failed');
                await client.query('COMMIT');
                throw Object.assign(invalid(), { committed: true });
            }
            await client.query('UPDATE admin_email_challenges SET consumed_at=$2 WHERE id=$1', [challenge.id, current]);
            await client.query(`INSERT INTO admin_session_grants
                (session_id,auth_user_id,credential_version,verified_at,expires_at)
                VALUES ($1,$2,$3,$4,$5)
                ON CONFLICT (session_id) DO UPDATE SET credential_version=EXCLUDED.credential_version,
                    verified_at=EXCLUDED.verified_at, expires_at=EXCLUDED.expires_at`,
            [session.sessionId, session.userId, row.credential_version, current, new Date(current.getTime() + 30 * minute)]);
            await audit(client, session, 'verified');
            await client.query('COMMIT');
            return { verified: true, expires_in: 1800 };
        } catch (error) {
            if (!error.committed) await client.query('ROLLBACK');
            throw error.status ? error : invalid(503);
        } finally { client.release(); }
    }
    async function revoke(session) {
        if (session?.sessionId && session?.userId) {
            const client = await db.connect();
            try {
                await client.query('BEGIN');
                const removed = await client.query('DELETE FROM admin_session_grants WHERE session_id=$1 AND auth_user_id=$2', [session.sessionId, session.userId]);
                if (removed.rowCount) await audit(client, session, 'revoked');
                await client.query('COMMIT');
            } catch { await client.query('ROLLBACK'); throw invalid(503); }
            finally { client.release(); }
        }
    }
    return { enrolled, granted, setup, start, verify, revoke };
}
