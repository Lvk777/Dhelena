import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fiveMinutes = 5 * 60 * 1000;
const hour = 60 * 60 * 1000;

// GoTrue still accepts the password-only token for account-management endpoints.
// Keep this prototype local-only until a provider-enforced second factor replaces it.
export const loginCodeEnabled = (env = process.env) => env.NODE_ENV !== 'production' && env.LOGIN_EMAIL_CODE_ENABLED === 'true';

// Claims are inspected only after Supabase Auth has verified this exact bearer token.
export function trustedSession(token, verifiedUser) {
    const claims = jwt.decode(token);
    if (!claims || typeof claims !== 'object' || claims.sub !== verifiedUser?.id
        || !uuid.test(claims.session_id || '') || claims.role !== 'authenticated'
        || !Array.isArray(claims.amr)) return null;
    const methods = claims.amr.map(item => item?.method);
    return { userId: verifiedUser.id, sessionId: claims.session_id,
        aal: claims.aal === 'aal2' ? 'aal2' : 'aal1',
        method: methods.includes('password') ? 'password' : methods.includes('oauth') ? 'oauth' : 'other' };
}

export async function sessionAllowed(db, session) {
    if (!session) return false;
    if (session.method === 'oauth') return true;
    if (session.method !== 'password') return false;
    const result = await db.query(`SELECT 1 FROM login_code_verified_sessions
        WHERE session_id = $1 AND user_id = $2`, [session.sessionId, session.userId]);
    return result.rowCount === 1;
}

function secret(env) {
    if (typeof env.LOGIN_EMAIL_CODE_HMAC_SECRET !== 'string' || env.LOGIN_EMAIL_CODE_HMAC_SECRET.length < 32) {
        throw new Error('Login code secret unavailable');
    }
    return env.LOGIN_EMAIL_CODE_HMAC_SECRET;
}

export function codeMac(code, sessionId, env = process.env) {
    return createHmac('sha256', secret(env)).update(`${sessionId}:${code}`).digest();
}

export function loginCodeEmail(code) {
    const subject = 'Seu código de acesso — D’Helenas Boutique';
    const text = `Olá!\n\nRecebemos uma solicitação de acesso à sua conta D’Helenas Boutique.\n\nSeu código de verificação é:\n\n${code}\n\nDigite esse código na tela de login para concluir seu acesso.\n\nO código expira em 5 minutos.\n\nSe você não tentou entrar na sua conta, ignore esta mensagem.\n\nD’Helenas Boutique\nModa que conecta histórias.`;
    const html = `<div style="background:#faf7f2;padding:32px 12px;font-family:Georgia,serif;color:#292526"><div style="max-width:520px;margin:auto;background:white;border:1px solid #e7d5d0;padding:36px 28px"><h1 style="color:#7d6a42;font-size:26px;margin:0 0 26px">D’Helenas Boutique</h1><p>Olá!</p><p>Recebemos uma solicitação de acesso à sua conta D’Helenas Boutique.</p><p>Seu código de verificação é:</p><p style="text-align:center;letter-spacing:.2em;font:700 36px Georgia,serif;color:#1f1f1f;background:#f5efe7;padding:22px 8px" aria-label="Código de acesso">${code}</p><p>Digite esse código na tela de login para concluir seu acesso.</p><p>O código expira em 5 minutos.</p><p>Se você não tentou entrar na sua conta, ignore esta mensagem.</p><p style="border-top:1px solid #e7d5d0;padding-top:22px;color:#6b6260">D’Helenas Boutique<br>Moda que conecta histórias.</p></div></div>`;
    return { subject, text, html };
}

export function createLoginCodeService({ db, env = process.env,
    send = async payload => new Resend(env.RESEND_API_KEY).emails.send(payload, { signal: AbortSignal.timeout(15_000) }),
    now = () => new Date() }) {
    async function start(session, email) {
        if (!session || session.method !== 'password' || !email || !env.RESEND_API_KEY) {
            throw Object.assign(new Error('Verificação indisponível.'), { status: 503 });
        }
        try { secret(env); } catch { throw Object.assign(new Error('Verificação indisponível.'), { status: 503 }); }
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`login-code:${session.userId}`]);
            const current = now();
            await client.query(`DELETE FROM login_code_challenges WHERE created_at < $1`, [new Date(current.getTime() - 24 * hour)]);
            const latest = await client.query(`SELECT sent_at FROM login_code_challenges WHERE user_id = $1
                ORDER BY sent_at DESC LIMIT 1`, [session.userId]);
            if (latest.rows[0] && current - new Date(latest.rows[0].sent_at) < 60_000) {
                throw Object.assign(new Error('Aguarde antes de reenviar.'), { status: 429 });
            }
            const count = await client.query(`SELECT count(*)::int AS count FROM login_code_challenges
                WHERE user_id = $1 AND sent_at > $2`, [session.userId, new Date(current.getTime() - hour)]);
            if (count.rows[0].count >= 8) throw Object.assign(new Error('Limite de códigos atingido.'), { status: 429 });
            const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
            const payload = { from: 'D’Helenas Boutique <contato@dhelenas.com>', to: email,
                replyTo: 'contato@dhelenas.com', ...loginCodeEmail(code) };
            const result = await send(payload);
            if (result?.error || !result?.data?.id) throw new Error('Email delivery failed');
            await client.query(`UPDATE login_code_challenges SET consumed_at = $1
                WHERE session_id = $2 AND consumed_at IS NULL`, [current, session.sessionId]);
            await client.query(`INSERT INTO login_code_challenges (user_id, session_id, code_mac, expires_at, sent_at)
                VALUES ($1, $2, $3, $4, $5)`, [session.userId, session.sessionId, codeMac(code, session.sessionId, env), new Date(current.getTime() + fiveMinutes), current]);
            await client.query('COMMIT');
            return { required: true, expires_in: 300, resend_after: 60 };
        } catch (error) {
            await client.query('ROLLBACK');
            if (error.status === 429) throw error;
            throw Object.assign(new Error('Não foi possível enviar o código. Tente novamente.'), { status: 503 });
        } finally { client.release(); }
    }

    async function verify(session, code) {
        if (!session || session.method !== 'password' || !/^\d{6}$/.test(code || '')) {
            throw Object.assign(new Error('Código inválido.'), { status: 400 });
        }
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query(`SELECT id, code_mac, expires_at, attempts, consumed_at
                FROM login_code_challenges WHERE session_id = $1 AND user_id = $2
                ORDER BY sent_at DESC LIMIT 1 FOR UPDATE`, [session.sessionId, session.userId]);
            const row = result.rows[0];
            if (!row || row.consumed_at || row.attempts >= 5 || new Date(row.expires_at) <= now()) {
                throw Object.assign(new Error('Código expirado ou indisponível.'), { status: 400 });
            }
            const candidate = codeMac(code, session.sessionId, env);
            const stored = Buffer.from(row.code_mac);
            if (stored.length !== candidate.length || !timingSafeEqual(stored, candidate)) {
                await client.query('UPDATE login_code_challenges SET attempts = attempts + 1 WHERE id = $1', [row.id]);
                await client.query('COMMIT');
                throw Object.assign(new Error('Código incorreto.'), { status: 400, committed: true });
            }
            await client.query('UPDATE login_code_challenges SET consumed_at = $2 WHERE id = $1', [row.id, now()]);
            await client.query(`INSERT INTO login_code_verified_sessions (session_id, user_id, verified_at)
                VALUES ($1, $2, $3) ON CONFLICT (session_id) DO NOTHING`, [session.sessionId, session.userId, now()]);
            await client.query('COMMIT');
            return { verified: true };
        } catch (error) {
            if (!error.committed) await client.query('ROLLBACK');
            if (error.status) throw error;
            throw Object.assign(new Error('Verificação indisponível.'), { status: 503 });
        } finally { client.release(); }
    }

    async function revoke(session) {
        if (session?.method === 'password') await db.query('DELETE FROM login_code_verified_sessions WHERE session_id = $1 AND user_id = $2', [session.sessionId, session.userId]);
    }
    return { start, verify, revoke };
}

export function createLoginCodeCleanupWorker({ db, env = process.env, intervalMs = hour } = {}) {
    let timer;
    let active = false;
    async function sweep() {
        if (!loginCodeEnabled(env) || active) return;
        active = true;
        try { await db.query(`DELETE FROM login_code_challenges WHERE created_at < now() - interval '24 hours'`); }
        catch { console.warn('[Auth] Login code cleanup unavailable'); }
        finally { active = false; }
    }
    return {
        start() { if (timer) return; timer = setInterval(sweep, intervalMs); timer.unref?.(); },
        stop() { if (timer) clearInterval(timer); timer = undefined; },
    };
}
