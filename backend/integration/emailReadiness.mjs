// Disposable localhost PostgreSQL only. No provider credentials or outbound email.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';

const url = new URL(process.env.TEST_DATABASE_URL || '');
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
assert.match(url.pathname, /^\/dhelenas_email_[a-z0-9_]+$/);
for (const key of Object.keys(process.env)) {
    if (/^(SUPABASE|MERCADO_PAGO|MELHOR_ENVIO|RESEND|WHATSAPP|TRANSACTIONAL_EMAIL)/.test(key)) delete process.env[key];
}
process.env.DATABASE_URL = url.href;
process.env.NODE_ENV = 'test';
const db = new pg.Pool({ connectionString: url.href, max: 8 });
const { createNotificationWorker, queueOrderEmails } = await import('../src/services/notificationOutbox.js');
const { pool } = await import('../src/config/db.js');
const readMigration = name => fs.readFile(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8');
let checks = 0;
const pass = name => { checks++; console.log(`PASS ${name}`); };

try {
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0, 'Refuse nonempty DB');
    for (const name of ['001_init', '002_profiles_rename', '008_payments_shipping']) await db.query(await readMigration(name));
    const customer = (await db.query("INSERT INTO profiles(email,full_name,password_hash) VALUES('customer@example.test','Synthetic customer','invalid-fixture') RETURNING id")).rows[0].id;
    const order = (await db.query(`INSERT INTO orders(order_number,user_id,subtotal,total,status,payment_status,snapshot)
        VALUES($1,$2,100,100,'recebido','pending','{}') RETURNING id`, [`EMAIL-${crypto.randomUUID()}`, customer])).rows[0].id;
    await db.query("INSERT INTO notification_logs(order_id,event,channel,recipient,status) VALUES($1,'legacy','email','old@example.test','failed')", [order]);
    const before = (await db.query('SELECT id,status,attempts,error FROM notification_logs')).rows;
    const migration = await readMigration('015_notification_outbox');
    await db.query('BEGIN');
    try { await db.query(migration); } finally { await db.query('ROLLBACK'); }
    assert.equal((await db.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='notification_logs' AND column_name='delivery_payload'")).rows[0].n, 0);
    await db.query(migration);
    assert.deepEqual((await db.query('SELECT id,status,attempts,error FROM notification_logs')).rows, before);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM notification_logs WHERE source_event_id IS NOT NULL')).rows[0].n, 0);
    pass('migration 015 rolls back and preserves legacy notifications');

    const env = { TRANSACTIONAL_EMAIL_ENABLED: 'true', TRANSACTIONAL_EMAIL_ENVIRONMENT: 'production', RESEND_API_KEY: 'synthetic',
        EMAIL_FROM: 'Boutique <sender@example.test>', EMAIL_REPLY_TO: 'support@example.test' };
    await db.query("INSERT INTO settings(key,value) VALUES('emails',$1),('general','{}'),('notifications',$2)", [
        JSON.stringify({ customer_enabled: true }), JSON.stringify({ recipients: [{ active: true, email: 'admin@example.test' }] })]);
    const event = (await db.query(`INSERT INTO order_events(order_id,event,metadata) VALUES($1,'order_created',$2) RETURNING id`,
        [order, JSON.stringify({ transactional_email_version: 1, payment_environment: 'production' })])).rows[0].id;
    await Promise.all([queueOrderEmails(null, null, { db, env }), queueOrderEmails(null, null, { db, env })]);
    const jobs = (await db.query('SELECT * FROM notification_logs WHERE source_event_id=$1 ORDER BY recipient', [event])).rows;
    assert.equal(jobs.length, 2);
    assert.deepEqual(jobs.map(job => job.recipient), ['admin@example.test', 'customer@example.test']);
    pass('concurrent queueing creates one immutable job per recipient');

    let sends = 0;
    const sent = new Map();
    const send = async (payload, key) => {
        if (!sent.has(key)) { sent.set(key, JSON.stringify(payload)); sends++; }
        else assert.equal(JSON.stringify(payload), sent.get(key));
        return { data: { id: key } };
    };
    const workers = [createNotificationWorker({ db, env, send }), createNotificationWorker({ db, env, send })];
    await Promise.all(workers.map(worker => worker.processOne()));
    assert.equal(sends, 2);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM notification_logs WHERE source_event_id=$1 AND status='sent'", [event])).rows[0].n, 2);
    assert.equal((await db.query('SELECT delivery_payload FROM notification_logs WHERE source_event_id=$1', [event])).rows.every(row => row.delivery_payload === null), true);
    pass('parallel workers send once and clear delivered payloads');

    const failedOrder = (await db.query(`INSERT INTO orders(order_number,user_id,subtotal,total,status,payment_status,snapshot)
        VALUES($1,$2,100,100,'recebido','pending','{}') RETURNING id`, [`EMAIL-${crypto.randomUUID()}`, customer])).rows[0].id;
    await db.query(`INSERT INTO order_events(order_id,event,metadata) VALUES($1,'order_created',$2)`,
        [failedOrder, JSON.stringify({ transactional_email_version: 1, payment_environment: 'production' })]);
    await queueOrderEmails(failedOrder, null, { db, env });
    let loseReceipt = true;
    const flakyDb = { query: db.query.bind(db), connect: async () => {
        const client = await db.connect();
        return { release: () => client.release(), query: (sql, args) => {
            if (loseReceipt && sql.includes("status='sent'")) { loseReceipt = false; throw new Error('synthetic DB failure after send'); }
            return client.query(sql, args);
        } };
    } };
    await createNotificationWorker({ db: flakyDb, env, send }).processOne();
    const failed = (await db.query("SELECT * FROM notification_logs WHERE order_id=$1 AND status='failed' LIMIT 1", [failedOrder])).rows[0];
    assert.ok(failed);
    await db.query('UPDATE orders SET total=99 WHERE id=$1', [failedOrder]);
    await db.query("UPDATE notification_logs SET next_attempt_at=now()+interval '1 hour' WHERE order_id=$1 AND id<>$2", [failedOrder, failed.id]);
    await db.query("UPDATE notification_logs SET next_attempt_at=now()-interval '2 seconds' WHERE id=$1", [failed.id]);
    const beforeRetry = sends;
    await createNotificationWorker({ db, env, send }).processOne();
    assert.equal(sends, beforeRetry);
    assert.equal((await db.query('SELECT status FROM notification_logs WHERE id=$1', [failed.id])).rows[0].status, 'sent');
    pass('uncertain receipt retries the frozen payload with the same provider key');

    const pending = (await db.query("SELECT id FROM notification_logs WHERE order_id=$1 AND status='pending'", [failedOrder])).rows[0];
    assert.ok(pending);
    await db.query("UPDATE notification_logs SET first_attempt_at=now()-interval '25 hours',next_attempt_at=now() WHERE id=$1", [pending.id]);
    await createNotificationWorker({ db, env, send }).processOne();
    assert.equal((await db.query('SELECT error FROM notification_logs WHERE id=$1', [pending.id])).rows[0].error, 'EMAIL_IDEMPOTENCY_EXPIRED');
    pass('expired provider idempotency window requires manual review');

    let touched = false;
    const disabled = createNotificationWorker({ db: { query() { touched = true; throw Error(); } }, env: {} });
    assert.equal(await disabled.processOne(), false);
    assert.equal(touched, false);
    pass('disabled delivery performs no database or provider call');
    console.log(`Email PostgreSQL rehearsal: ${checks} checks passed; synthetic data only`);
} finally {
    await db.end();
    await pool.end();
}
