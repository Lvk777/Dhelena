import { pool, withTransaction } from '../config/db.js';
import { cancelOrderInTransaction } from '../orderService.js';
import { canExpireReservation, reservationExpiryAt } from '../lib/orderReservationExpiry.js';
import { logSafeError } from '../lib/safeErrorLog.js';

const INTERVAL_MS = 5 * 60_000;
const ISO_UTC_PATTERN = '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$';

export function createOrderReservationExpiryWorker({ db = pool, transaction = withTransaction,
    cancel = cancelOrderInTransaction, env = process.env, now = Date.now } = {}) {
    let timer = null;
    let running = null;

    async function expireOne(orderId) {
        return transaction(async client => {
            const { rows } = await client.query(
                'SELECT *, now() AS database_now FROM orders WHERE id = $1 FOR UPDATE SKIP LOCKED', [orderId]);
            const databaseNow = rows.length ? new Date(rows[0].database_now).getTime() : NaN;
            if (!rows.length || !Number.isFinite(databaseNow)
                || !canExpireReservation(rows[0], Math.min(now(), databaseNow))) return false;
            const order = rows[0];
            const { rows: priorActivity } = await client.query(
                `SELECT 1 FROM order_events WHERE order_id = $1
                   AND event LIKE 'payment_%' AND event <> 'payment_method_changed' LIMIT 1`, [orderId]);
            if (priorActivity.length) return false;
            for (const table of ['order_refunds', 'order_returns', 'stock_restorations']) {
                const { rows: related } = await client.query(`SELECT 1 FROM ${table} WHERE order_id = $1 LIMIT 1`, [orderId]);
                if (related.length) return false;
            }
            await cancel(client, order);
            await client.query(
                `INSERT INTO order_events (order_id, event, description)
                 VALUES ($1, 'order_reservation_expired', 'Reserva sem tentativa de pagamento expirada')`, [orderId]);
            return true;
        });
    }

    async function runOnce() {
        if (env.ORDER_RESERVATION_EXPIRY_ENABLED !== 'true') return { expired: 0, disabled: true };
        reservationExpiryAt(env, now); // Invalid operator configuration must fail closed.
        if (running) return running;
        running = (async () => {
            const { rows } = await db.query(
                `SELECT id FROM orders WHERE status = 'recebido' AND payment_status = 'pending'
                   AND CASE WHEN snapshot->>'reservation_expires_at' ~ $1
                     THEN (snapshot->>'reservation_expires_at')::timestamptz <= now()
                     ELSE false END
                 ORDER BY created_at LIMIT 50`, [ISO_UTC_PATTERN]);
            let expired = 0;
            for (const row of rows) {
                try { if (await expireOne(row.id)) expired++; }
                catch (error) { logSafeError('order_reservation_expiry_failed', error); }
            }
            return { expired, disabled: false };
        })().finally(() => { running = null; });
        return running;
    }

    return {
        runOnce,
        start() {
            if (timer || env.ORDER_RESERVATION_EXPIRY_ENABLED !== 'true') return;
            timer = setInterval(() => { void runOnce().catch(error => logSafeError('order_reservation_expiry_scan_failed', error)); }, INTERVAL_MS);
            timer.unref?.();
            void runOnce().catch(error => logSafeError('order_reservation_expiry_scan_failed', error));
        },
        async stop() { if (timer) clearInterval(timer); timer = null; if (running) await running; },
    };
}
