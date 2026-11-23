import { pool } from '../config/db.js';
import { logSafeError } from '../lib/safeErrorLog.js';
import { operateShipping } from './shippingOperations.js';

const REQUEST_EVENT = 'shipping_auto_prepare_requested';
const READY_STATES = new Set(['', 'draft', 'pending']);
const FULFILLMENT_STATES = new Set(['recebido', 'pagamento_aprovado', 'em_separacao']);

// Never backfill a historical order or retry an ambiguous provider request.
// This event is only inserted in the transaction that officially verifies its NF-e.
export function automaticShippingPreparationEligible(order, env = process.env) {
    return env.AUTO_SHIPPING_PREPARE_ENABLED === 'true'
        && env.FISCAL_XML_IMPORT_ENABLED === 'true'
        && order?.payment_status === 'approved'
        && FULFILLMENT_STATES.has(order?.status)
        && order?.shipping_method === 'melhor_envio'
        && order?.snapshot?.shipping_environment === 'production'
        && !order?.melhor_envio_shipment_id
        && READY_STATES.has(order?.shipping_status || '');
}

export async function enqueueAutomaticShippingPreparation(client, order, actorId, env = process.env) {
    if (!automaticShippingPreparationEligible(order, env)) return false;
    await client.query(`INSERT INTO order_events(order_id,event,description,metadata)
        VALUES($1,$2,$3,$4::jsonb)`, [order.id, REQUEST_EVENT,
        'Preparação automática solicitada após conferência fiscal oficial',
        JSON.stringify({ auto_shipping_prepare_version: 1, auto_shipping_prepare_state: 'pending',
            requested_by: actorId, shipping_environment: 'production' })]);
    return true;
}

export function createAutoShippingPreparationWorker({ db = pool, operate = operateShipping,
    env = process.env, intervalMs = 10000 } = {}) {
    let timer, running, stopped = false;

    async function processOne() {
        if (env.AUTO_SHIPPING_PREPARE_ENABLED !== 'true' || env.FISCAL_XML_IMPORT_ENABLED !== 'true') return false;
        const client = await db.connect();
        let locked = false, eventId;
        const finish = async (state, reason = null) => {
            await client.query(`UPDATE order_events SET metadata=COALESCE(metadata,'{}'::jsonb) || $2::jsonb
                WHERE id=$1 AND event=$3`, [eventId, JSON.stringify({ auto_shipping_prepare_state: state,
                    auto_shipping_prepare_finished_at: new Date().toISOString(),
                    ...(reason ? { auto_shipping_prepare_reason: reason } : {}) }), REQUEST_EVENT]);
        };
        try {
            const candidates = await client.query(`SELECT id FROM order_events
                WHERE event=$1 AND metadata->>'auto_shipping_prepare_version'='1'
                AND metadata->>'auto_shipping_prepare_state'='pending'
                ORDER BY created_at,id LIMIT 20`, [REQUEST_EVENT]);
            for (const candidate of candidates.rows) {
                const lock = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
                    [`auto-shipping:${candidate.id}`]);
                if (lock.rows[0]?.locked === true) { eventId = candidate.id; locked = true; break; }
            }
            if (!locked) return false;
            // Read again after obtaining the session lock: another replica may have completed it.
            const rows = await client.query(`SELECT e.order_id,e.metadata,o.* FROM order_events e
                JOIN orders o ON o.id=e.order_id WHERE e.id=$1 AND e.event=$2`, [eventId, REQUEST_EVENT]);
            const order = rows.rows[0];
            if (!order || order.metadata?.auto_shipping_prepare_state !== 'pending') return true;
            if (order.melhor_envio_shipment_id && order.shipping_status === 'cart_created') {
                await finish('prepared'); return true;
            }
            if (!automaticShippingPreparationEligible(order, env)) {
                await finish('blocked', ['cart_inflight', 'cart_uncertain'].includes(order.shipping_status)
                    ? 'needs_reconciliation' : 'no_longer_eligible');
                return true;
            }
            const fiscal = await client.query(`SELECT 1 FROM fiscal_documents WHERE order_id=$1
                AND unlinked_at IS NULL AND status='verified' AND differences='[]'::jsonb
                AND official_checked_at IS NOT NULL AND verified_by IS NOT NULL LIMIT 1`, [order.id]);
            if (!fiscal.rows.length) { await finish('blocked', 'fiscal_verification_missing'); return true; }
            try {
                // Prepare is the only allowed operation. It never checks out, purchases,
                // generates, prints or changes product quantities/stock.
                const result = await operate(order.id, 'prepare', {}, order.metadata.requested_by);
                if (result.status !== 'cart_created' || !result.shipment_id) {
                    await finish('blocked', 'provider_result_unconfirmed');
                } else await finish('prepared');
            } catch (cause) {
                // A timeout may have created a cart remotely. Existing shipping operations
                // preserve cart_inflight/cart_uncertain; never automatically retry the POST.
                const current = await client.query('SELECT shipping_status FROM orders WHERE id=$1', [order.id]);
                await finish('blocked', ['cart_inflight', 'cart_uncertain'].includes(current.rows[0]?.shipping_status)
                    ? 'needs_reconciliation' : 'manual_review_required');
                logSafeError('automatic_shipping_preparation_blocked', cause, 'warn');
            }
            return true;
        } finally {
            if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))',
                [`auto-shipping:${eventId}`]).catch(() => {});
            client.release();
        }
    }

    async function tick() {
        if (stopped || running || env.AUTO_SHIPPING_PREPARE_ENABLED !== 'true') return running;
        running = (async () => {
            for (let i = 0; i < 10 && !stopped; i++) if (!await processOne()) break;
        })().catch(cause => logSafeError('automatic_shipping_preparation_worker_failed', cause))
            .finally(() => { running = null; });
        return running;
    }
    return {
        processOne, tick,
        start() { if (timer || env.AUTO_SHIPPING_PREPARE_ENABLED !== 'true') return;
            stopped = false; void tick(); timer = setInterval(() => void tick(), intervalMs); timer.unref?.(); },
        async stop() { stopped = true; clearInterval(timer); await running; },
    };
}
