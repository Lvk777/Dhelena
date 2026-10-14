import { pool } from '../config/db.js';
import { Resend } from 'resend';
import { buildOrderEmail, orderEmailConfig, EMAIL_EVENTS } from './orderEmail.js';
import { validEmail } from '../lib/navigation.js';
import { logSafeError } from '../lib/safeErrorLog.js';

const permanent = new Set(['EMAIL_IDEMPOTENCY_EXPIRED', 'EMAIL_PAYLOAD_CONFLICT']);
export function notificationMetadata(metadata = {}, env = process.env) {
    return { ...metadata, transactional_email_version: 1, payment_environment: env.MERCADO_PAGO_MODE || 'unverified' };
}

export async function notificationSchemaReady(db = pool) {
    const { rows } = await db.query(`SELECT COUNT(*)::int AS count FROM information_schema.columns
        WHERE table_schema='public' AND table_name='notification_logs'
        AND column_name IN ('delivery_payload','source_event_id','next_attempt_at','first_attempt_at')`);
    return rows[0]?.count === 4;
}

// Only explicitly marked future events are discovered; no historical financial reconciliation.
export async function queueOrderEmails(orderId = null, event = null, { db = pool, env = process.env } = {}) {
    if (env.TRANSACTIONAL_EMAIL_ENABLED !== 'true' || !await notificationSchemaReady(db)) return 0;
    const { rows: settingsRows } = await db.query("SELECT key,value FROM settings WHERE key IN ('general','emails','notifications')");
    const settings = Object.fromEntries(settingsRows.map(row => [row.key, row.value]));
    const config = orderEmailConfig(settings, env);
    const { rows } = await db.query(`SELECT e.id AS source_event_id,e.event AS notification_event,o.*,p.email AS user_email,p.full_name AS user_name
        FROM order_events e JOIN orders o ON o.id=e.order_id JOIN profiles p ON p.id=o.user_id
        WHERE e.metadata->>'transactional_email_version'='1'
        AND e.event=ANY($4::text[]) AND ($1::uuid IS NULL OR o.id=$1) AND ($2::text IS NULL OR e.event=$2)
        AND e.metadata->>'payment_environment'=$3
        AND COALESCE(e.metadata->>'email_outbox_queued','false')<>'true'
        ORDER BY e.created_at LIMIT 20`, [orderId, event, env.TRANSACTIONAL_EMAIL_ENVIRONMENT || 'production',Object.keys(EMAIL_EVENTS)]);
    let queued = 0;
    for (const order of rows) {
        const name = order.notification_event;
        if (settings.emails?.[EMAIL_EVENTS[name][0]] === false) { await db.query("UPDATE order_events SET metadata=jsonb_set(metadata,'{email_outbox_queued}','true') WHERE id=$1",[order.source_event_id]);continue; }
        const recipients = new Set();
        if (settings.emails?.customer_enabled !== false && validEmail(order.user_email)) recipients.add(order.user_email.toLowerCase());
        for (const r of settings.notifications?.recipients || []) {
            if (r.active && validEmail(r.email) && (r.events || ['order_created','payment_approved']).includes(name)
                && settings.notifications?.email_enabled !== false) recipients.add(r.email.toLowerCase());
        }
        const client=await db.connect();
        try {
        await client.query('BEGIN');
        await client.query('SELECT id FROM order_events WHERE id=$1 FOR UPDATE',[order.source_event_id]);
        for (const recipient of recipients) {
            const payload = buildOrderEmail(order, recipient, name, config);
            const result = await client.query(`INSERT INTO notification_logs(order_id,event,channel,recipient,status,source_event_id,delivery_payload,next_attempt_at)
                VALUES($1,$2,'email',$3,'pending',$4,$5,now()) ON CONFLICT(order_id,event,channel,recipient) DO NOTHING`,
            [order.id, `${name}:${order.source_event_id}`, recipient, order.source_event_id, JSON.stringify(payload)]);
            queued += result.rowCount || 0;
        }
        await client.query(`UPDATE order_events SET metadata=jsonb_set(metadata,'{email_outbox_queued}','true') WHERE id=$1`,[order.source_event_id]);
        await client.query('COMMIT');
        }catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}
    }
    return queued;
}

export function createNotificationWorker({ db = pool, env = process.env, now = Date.now,
    send = async (payload, key) => new Resend(env.RESEND_API_KEY).emails.send(payload, { idempotencyKey: key, signal: AbortSignal.timeout(15000) }), intervalMs = 30000 } = {}) {
    let timer, running, stopped = false;
    async function processOne() {
        if (env.TRANSACTIONAL_EMAIL_ENABLED !== 'true' || !env.RESEND_API_KEY || !await notificationSchemaReady(db)) return false;
        const client = await db.connect(); let job, lockId, locked = false;
        try {
            const rows = await client.query(`SELECT * FROM notification_logs WHERE channel='email' AND source_event_id IS NOT NULL
                AND delivery_payload IS NOT NULL AND status IN ('pending','retrying','failed')
                AND COALESCE(error,'') NOT IN ('EMAIL_IDEMPOTENCY_EXPIRED','EMAIL_PAYLOAD_CONFLICT')
                AND COALESCE(next_attempt_at,created_at)<=now() ORDER BY created_at LIMIT 10`);
            for (const candidate of rows.rows) {
                const lock = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [`notification:${candidate.id}`]);
                if (lock.rows[0]?.locked) { job = candidate;lockId=candidate.id; locked = true; break; }
            }
            if (!job) return false;
            // Read after acquiring the session lock: another replica may have completed it.
            job = (await client.query('SELECT * FROM notification_logs WHERE id=$1', [job.id])).rows[0];
            if (!job || job.status === 'sent' || permanent.has(job.error) || new Date(job.next_attempt_at || job.created_at).getTime() > now()) return false;
            if (job.first_attempt_at && now() - new Date(job.first_attempt_at).getTime() >= 23 * 3600000) {
                await client.query("UPDATE notification_logs SET status='failed',error='EMAIL_IDEMPOTENCY_EXPIRED' WHERE id=$1", [job.id]); return true;
            }
            // A committed checkpoint survives restarts. Retries reuse the exact same frozen payload/key.
            await client.query(`UPDATE notification_logs SET status='retrying',attempts=attempts+1,
                first_attempt_at=COALESCE(first_attempt_at,now()) WHERE id=$1`, [job.id]);
            let timeout;
            const result = await Promise.race([send(job.delivery_payload, `order-email-${job.id}`),
                new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('EMAIL_TIMEOUT')), 15000); timeout.unref?.(); })]).finally(()=>clearTimeout(timeout));
            if (result?.error || !result?.data?.id) {
                throw Object.assign(new Error('EMAIL_DELIVERY_FAILED'), { permanent: result?.error?.name === 'invalid_idempotent_request' });
            }
            await client.query(`UPDATE notification_logs SET status='sent',provider_message_id=$2,sent_at=now(),error=NULL,
                next_attempt_at=NULL,delivery_payload=NULL WHERE id=$1`, [job.id, result.data.id]);
            return true;
        } catch (err) {
            if (job && locked) await client.query(`UPDATE notification_logs SET status='failed',error=$2,
                next_attempt_at=now()+($3::int * interval '1 second') WHERE id=$1 AND status<>'sent'`,
            [job.id, err.permanent ? 'EMAIL_PAYLOAD_CONFLICT' : 'EMAIL_DELIVERY_FAILED', Math.min(1800, 30 * 2 ** Math.min(Number(job.attempts) || 0, 6))]).catch(() => {});
            logSafeError('email_outbox_delivery_failed', err); return !!job;
        } finally {
            if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`notification:${lockId}`]).catch(() => {});
            client.release();
        }
    }
    async function tick() {
        if (stopped || running || env.TRANSACTIONAL_EMAIL_ENABLED !== 'true') return running;
        running = (async () => { await queueOrderEmails(null, null, { db, env }).catch(e=>logSafeError('email_queue_failed',e)); for (let i=0;i<10&&!stopped;i++) if (!await processOne()) break; })()
            .catch(err => logSafeError('email_outbox_failed', err)).finally(() => { running = null; });
        return running;
    }
    return { tick, processOne, start() { if (timer || env.TRANSACTIONAL_EMAIL_ENABLED !== 'true') return; stopped=false; void tick(); timer=setInterval(()=>void tick(),intervalMs); timer.unref?.(); },
        async stop() { stopped=true; clearInterval(timer); await running; } };
}
