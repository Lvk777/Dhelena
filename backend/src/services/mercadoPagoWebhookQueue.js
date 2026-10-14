import crypto from 'crypto';
import { pool, withTransaction } from '../config/db.js';
import { paymentContexts } from '../lib/mercadoPagoContext.js';
import { safeApplicationId } from '../lib/mercadoPagoWebhookLog.js';
import * as mp from './mercadoPago.js';
import { getVerifiedPaymentForOrder } from '../lib/paymentVerification.js';
import { applyVerifiedOrderInTransaction, recordVerifiedNonApprovedOrderInTransaction } from '../lib/paymentReconciliation.js';
import { reconcileRefundFromWebhook } from '../afterSalesService.js';
import { logSafeError } from '../lib/safeErrorLog.js';

const resourceIdPattern = /^ORD[A-Za-z0-9]{10,60}$/;
const seal = (core, context) => crypto.createHmac('sha256', context.secret).update(JSON.stringify(core)).digest('hex');
const fail = code => Object.assign(new Error(code), { code });

export function authenticateOrderDelivery(req, contexts = paymentContexts()) {
    const matched = contexts.filter(context => mp.inspectWebhookSignature(req, context.secret).valid);
    if (!matched.length) throw Object.assign(fail('invalid_signature_context'), { status: 401 });
    const resourceId = req.query?.['data.id'];
    if (req.body?.type !== 'order' || (req.query?.type !== undefined && req.query.type !== 'order')
        || typeof resourceId !== 'string' || !resourceIdPattern.test(resourceId)) {
        throw Object.assign(fail('unsupported_event'), { status: 200 });
    }
    const applicationId = safeApplicationId(req.body?.application_id);
    if (matched.length > 1) {
        // A shared HMAC authenticates receipt, not a realm. Defer credential
        // selection to the immutable local attempt plus the official resource.
        const core = { version: 2, candidate_credential_ids: [...new Set(matched.map(c => c.credentialId))].sort(),
            resource_id: resourceId, application_id: applicationId,
            live_mode: typeof req.body?.live_mode === 'boolean' ? req.body.live_mode : null,
            body_resource_matches: req.body?.data?.id === resourceId };
        // Distinguish contradictory hints so a captured valid signature with
        // an altered body cannot reserve/block the legitimate delivery's key.
        const eventId = 'shared:' + crypto.createHash('sha256').update(JSON.stringify([
            core, req.headers['x-signature'], req.headers['x-request-id'] || '',
        ])).digest('hex');
        return { eventId, payload: { mp_webhook: core, seal: seal(core, matched[0]), queue: { attempts: 0, next_at: 0 } } };
    }
    const context = matched[0];
    if (!applicationId || (context.applicationId && applicationId !== context.applicationId)
        || typeof req.body.live_mode !== 'boolean' || req.body.live_mode !== (context.mode === 'production')
        || req.body.data?.id !== resourceId) throw Object.assign(fail('delivery_context_mismatch'), { status: 400 });
    // Only signed fields identify a delivery. Unsigned body.id cannot poison another reservation.
    const eventId = `${context.mode}:` + crypto.createHash('sha256').update(JSON.stringify([
        context.credentialId, resourceId, req.headers['x-signature'], req.headers['x-request-id'] || '',
    ])).digest('hex');
    const core = { version: 1, mode: context.mode, credential_id: context.credentialId,
        resource_id: resourceId, application_id: applicationId, live_mode: req.body.live_mode };
    return { eventId, payload: { mp_webhook: core, seal: seal(core, context), queue: { attempts: 0, next_at: 0 } } };
}

export async function persistOrderDelivery(delivery, transaction = withTransaction) {
    return transaction(async client => {
        // The response path performs no provider request and has a bounded database wait.
        await client.query("SET LOCAL lock_timeout = '1000ms'");
        await client.query("SET LOCAL statement_timeout = '5000ms'");
        const inserted = await client.query(`INSERT INTO webhook_events (provider,event_id,event_type,payload,processed)
            VALUES ('mercado_pago',$1,'order',$2,false) ON CONFLICT (provider,event_id) DO NOTHING RETURNING processed`,
        [delivery.eventId, JSON.stringify(delivery.payload)]);
        if (inserted.rows.length) return 'queued';
        const { rows } = await client.query("SELECT processed FROM webhook_events WHERE provider = 'mercado_pago' AND event_id = $1", [delivery.eventId]);
        if (!rows.length) throw fail('reservation_missing');
        return rows[0].processed === true ? 'already_processed' : 'pending';
    });
}

export async function acknowledgeOrderDelivery(delivery, persist = persistOrderDelivery, timeoutMs = 10000) {
    let timer;
    try {
        // A stalled pool/network cannot delay the HTTP response past the provider's 22s window.
        // Late persistence may still commit; a 503 retry then sees the same durable reservation.
        return await Promise.race([persist(delivery), new Promise((_, reject) => {
            timer = setTimeout(() => reject(fail('receipt_timeout')), timeoutMs);
        })]);
    } finally { clearTimeout(timer); }
}

export function verifyResourceContext(core, context, identity, order, resource) {
    const bound = order.snapshot?.payment_context;
    if (!bound || bound.version !== 1 || bound.mode !== context.mode || bound.credential_id !== context.credentialId) throw fail('legacy_or_unbound_attempt');
    if (core.version === 2 && (core.live_mode !== (context.mode === 'production') || core.body_resource_matches !== true)) throw fail('delivery_context_mismatch');
    if (identity.mode !== context.mode || resource.user_id !== identity.userId) throw fail('official_environment_mismatch');
    if (resource.resource_type !== 'online' || resource.mp_order_id !== core.resource_id) throw fail('official_resource_mismatch');
    if (resource.application_id !== core.application_id || !bound.application_id
        || resource.application_id !== bound.application_id
        || (context.applicationId && resource.application_id !== context.applicationId)) throw fail('official_application_mismatch');
    if (bound.provider_order_id !== core.resource_id || order.mercado_pago_order_id !== core.resource_id) throw fail('attempt_resource_mismatch');
    if (typeof resource.live_mode === 'boolean' && resource.live_mode !== (context.mode === 'production')) throw fail('official_environment_mismatch');
}

function hasDurableProof(payload, context) {
    return context && typeof payload.seal === 'string' && /^[a-f0-9]{64}$/.test(payload.seal)
        && crypto.timingSafeEqual(Buffer.from(seal(payload.mp_webhook, context)), Buffer.from(payload.seal));
}

function resolveAttemptContext(core, configured, order) {
    const bound = order.snapshot?.payment_context;
    if (!bound || bound.version !== 1 || !bound.application_id) throw fail('legacy_or_unbound_attempt');
    const matched = configured.filter(c => core.candidate_credential_ids.includes(c.credentialId)
        && c.credentialId === bound.credential_id && c.mode === bound.mode);
    if (!matched.length) throw fail('credential_context_unavailable');
    if (matched.length !== 1) throw fail('ambiguous_attempt_context');
    return matched[0];
}

export function createOrderWebhookWorker({ db = pool, provider = mp, contexts = paymentContexts,
    refund = reconcileRefundFromWebhook, now = Date.now, random = Math.random,
    intervalMs = 15000, logger = record => console.info(JSON.stringify(record)) } = {}) {
    let timer = null, running = null, stopped = false;
    async function processOne() {
        const configured = contexts();
        if (!configured.length) return false;
        const client = await db.connect();
        let event, payload, originalPayload, releaseError, context;
        try {
            await client.query('BEGIN');
            await client.query("SET LOCAL lock_timeout = '1000ms'");
            await client.query("SET LOCAL statement_timeout = '5000ms'");
            await client.query("SET LOCAL idle_in_transaction_session_timeout = '60000ms'");
            const result = await client.query(`SELECT * FROM webhook_events WHERE provider = 'mercado_pago' AND processed = false
                AND ((payload->'mp_webhook'->>'version' = '1'
                    AND payload->'mp_webhook'->>'credential_id' = ANY($1::text[]))
                    OR (payload->'mp_webhook'->>'version' = '2'
                    AND payload->'mp_webhook'->'candidate_credential_ids' ?| $1::text[]))
                AND COALESCE(payload->'queue'->>'state','pending') <> 'blocked'
                AND CASE WHEN payload->'queue'->>'next_at' ~ '^[0-9]{1,16}$'
                    THEN (payload->'queue'->>'next_at')::bigint ELSE 0 END <= $2
                ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`, [configured.map(c => c.credentialId), now()]);
            event = result.rows[0];
            if (!event) { await client.query('COMMIT'); return false; }
            payload = event.payload;
            originalPayload = JSON.stringify(payload);
            const core = payload.mp_webhook;
            let order;
            if (core.version === 2) {
                if (!Array.isArray(core.candidate_credential_ids)
                    || !configured.some(c => core.candidate_credential_ids.includes(c.credentialId) && hasDurableProof(payload, c))) throw fail('invalid_durable_proof');
                const { rows } = await client.query('SELECT * FROM orders WHERE mercado_pago_order_id = $1 FOR UPDATE', [core.resource_id]);
                if (!rows.length) throw fail('order_not_yet_bound');
                if (rows.length !== 1) throw fail('ambiguous_attempt_context');
                order = rows[0];
                context = resolveAttemptContext(core, configured, order);
            } else {
                context = configured.find(c => c.credentialId === core.credential_id && c.mode === core.mode);
            }
            if (!hasDurableProof(payload, context)) throw fail('invalid_durable_proof');
            const identity = await provider.getWebhookCredentialIdentity(context);
            const resource = await provider.getOrderStatus(core.resource_id, context);
            // Exact attached resource only. Arrival before creation commit retries; external_reference alone is insufficient.
            if (!order) {
                const { rows } = await client.query('SELECT * FROM orders WHERE mercado_pago_order_id = $1 FOR UPDATE', [core.resource_id]);
                if (!rows.length) throw fail('order_not_yet_bound');
                if (rows.length !== 1) throw fail('ambiguous_attempt_context');
                order = rows[0];
            }
            verifyResourceContext(core, context, identity, order, resource);
            const scopedProvider = { getOrderStatus: id => provider.getOrderStatus(id, context),
                getRefundableOrder: async id => {
                    const official = await provider.getRefundableOrder(id, context);
                    verifyResourceContext(core, context, identity, order, official.provider_resource);
                    return official;
                } };
            const verified = await getVerifiedPaymentForOrder(order, scopedProvider, resource, core.resource_id);
            await refund(order.id, core.resource_id, scopedProvider, client, callback => callback(client));
            const outcome = mp.mapPaymentStatus(verified.mp_status, verified.mp_status_detail) === 'approved'
                ? await applyVerifiedOrderInTransaction(client, order.id, verified, 'webhook')
                : await recordVerifiedNonApprovedOrderInTransaction(client, order.id, verified, 'webhook');
            if (outcome.outcome === 'manual_reconciliation_required') throw fail('manual_reconciliation_required');
            payload.queue = { ...payload.queue, state: 'processed', outcome: outcome.outcome };
            await client.query('UPDATE webhook_events SET processed = true, payload = $2 WHERE id = $1', [event.id, JSON.stringify(payload)]);
            await client.query('COMMIT');
            logger({ event: 'mp_webhook_queue', result: outcome.outcome, mode: context.mode });
            return true;
        } catch (error) {
            try { await client.query('ROLLBACK'); } catch (rollbackError) { releaseError = rollbackError; }
            if (!event || releaseError) throw error;
            const blocked = ['invalid_durable_proof', 'official_environment_mismatch', 'official_application_mismatch',
                'official_resource_mismatch', 'attempt_resource_mismatch', 'legacy_or_unbound_attempt',
                'ambiguous_attempt_context', 'delivery_context_mismatch',
                'manual_reconciliation_required', 'PAYMENT_MISMATCH'].includes(error.code);
            const attempts = Math.min(1000000, (Number(payload?.queue?.attempts) || 0) + 1);
            const delay = Math.min(300000, 15000 * 2 ** Math.min(attempts - 1, 5)) + Math.floor(random() * 3000);
            // After rollback acquire the row again: never overwrite another replica's completed/retried work.
            await client.query(`UPDATE webhook_events SET payload = jsonb_set(payload,'{queue}',$2::jsonb)
                WHERE id = $1 AND processed = false AND payload = $3::jsonb`, [event.id, JSON.stringify({
                state: blocked ? 'blocked' : 'pending', attempts, next_at: now() + delay,
                reason: blocked ? error.code : 'processing_retry',
            }), originalPayload]);
            logger({ event: 'mp_webhook_queue', result: blocked ? 'blocked' : 'retry_scheduled',
                reason: blocked ? error.code : 'processing_retry', mode: context?.mode || payload?.mp_webhook?.mode || 'unresolved' });
            return true;
        } finally { client.release(releaseError); }
    }
    async function tick() {
        if (stopped || running) return running;
        running = (async () => {
            for (let count = 0; count < 10 && !stopped; count++) if (!await processOne()) break;
        })().catch(error => logSafeError('mp_webhook_worker_failed', error)).finally(() => { running = null; });
        return running;
    }
    return { processOne, tick,
        start() { if (timer) return; stopped = false; void tick(); timer = setInterval(() => { void tick(); }, intervalMs); timer.unref?.(); },
        async stop() { stopped = true; clearInterval(timer); timer = null; await running; },
    };
}
