import { pool } from '../config/db.js';
import { readPaymentStatus } from './paymentStatus.js';
import { logSafeError } from '../lib/safeErrorLog.js';

const INTERVAL_MS = 5 * 60_000;
const BATCH_SIZE = 25;

/**
 * Unattended customers must not strand paid/expired reservations forever.
 * Never infer failure from age: release happens only through readPaymentStatus,
 * which validates an official Mercado Pago Orders API read before reconciling.
 * This worker is opt-in until its production checkout rehearsal is approved.
 */
export function createPendingPaymentReconciliationWorker({
    db = pool, readStatus = readPaymentStatus, env = process.env,
} = {}) {
    let timer = null;
    let running = null;
    let cursor = null;

    async function runOnce() {
        if (env.PAYMENT_PENDING_RECONCILIATION_ENABLED !== 'true') {
            return { checked: 0, disabled: true };
        }
        if (running) return running;
        running = (async () => {
            // Page through the outstanding set instead of polling only the
            // oldest pending order. No customer details or payment payloads
            // are written to diagnostic logs.
            const { rows } = await db.query(
                `SELECT * FROM orders
                 WHERE status = 'recebido' AND payment_status = 'pending'
                   AND paid_at IS NULL AND mercado_pago_order_id IS NOT NULL
                   AND snapshot->>'stock_model' = 'deferred_sale_v1'
                   AND snapshot ? 'payment_context'
                   AND created_at <= now() - interval '5 minutes'
                   AND ($1::timestamptz IS NULL
                        OR (created_at, id) < ($1::timestamptz, $2::uuid))
                 ORDER BY created_at DESC, id DESC LIMIT $3`,
                [cursor?.created_at || null, cursor?.id || null, BATCH_SIZE]);
            if (rows.length === 0) { cursor = null; return { checked: 0, disabled: false }; }
            const last = rows[rows.length - 1];
            cursor = { created_at: last.created_at, id: last.id };
            let checked = 0;
            for (const order of rows) {
                try {
                    await readStatus(order);
                    checked++;
                } catch (error) {
                    // No provider failure/timeout/unknown order is evidence to
                    // return inventory to the shelf.
                    logSafeError('pending_payment_reconciliation_failed', error);
                }
            }
            return { checked, disabled: false };
        })().finally(() => { running = null; });
        return running;
    }

    return {
        runOnce,
        start() {
            if (timer || env.PAYMENT_PENDING_RECONCILIATION_ENABLED !== 'true') return;
            timer = setInterval(() => {
                void runOnce().catch(error => logSafeError('pending_payment_reconciliation_scan_failed', error));
            }, INTERVAL_MS);
            timer.unref?.();
            void runOnce().catch(error => logSafeError('pending_payment_reconciliation_scan_failed', error));
        },
        async stop() { if (timer) clearInterval(timer); timer = null; if (running) await running; },
    };
}
