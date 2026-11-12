import { withTransaction } from '../config/db.js';
import { orderAttemptLockSql } from './orderAttemptLock.js';

const fail = (message, status = 409) => Object.assign(new Error(message), { status });

export async function withdrawalRequestForOrder(db, orderId) {
    const { rows } = await db.query(`SELECT id, created_at FROM order_events
        WHERE order_id = $1 AND event = 'consumer_withdrawal_requested'
        ORDER BY created_at ASC LIMIT 1`, [orderId]);
    return rows[0] || null;
}

export async function assertNoWithdrawalRequest(db, orderId, env = process.env) {
    if (env.WITHDRAWAL_REQUESTS_ENABLED !== 'true') return;
    if (await withdrawalRequestForOrder(db, orderId)) {
        throw fail('Há uma solicitação de arrependimento registrada. Novos pagamentos e envios estão suspensos para análise.');
    }
}

// A request records the customer's notice. It never cancels, refunds, changes
// inventory, or calls a payment/shipping provider. Staff must review deadlines
// and reconcile any provider attempt already in progress.
export async function requestWithdrawal(orderId, user, transaction = withTransaction) {
    return transaction(async client => {
        // Serialize with Pix/card creation and payment-method changes before the
        // order row lock. This also makes duplicate submissions deterministic.
        await client.query(`SELECT pg_advisory_xact_lock(${orderAttemptLockSql})`, [orderId]);
        const { rows } = await client.query('SELECT id, user_id FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
        if (!rows[0] || rows[0].user_id !== user.id) {
            throw fail('Pedido não encontrado', 404);
        }
        const previous = await withdrawalRequestForOrder(client, orderId);
        if (previous) return { request_id: previous.id, received_at: previous.created_at, already_received: true };
        const { rows: created } = await client.query(`INSERT INTO order_events
            (order_id, event, description, metadata)
            VALUES ($1, 'consumer_withdrawal_requested', 'Solicitação de arrependimento recebida', $2)
            RETURNING id, created_at`, [orderId, JSON.stringify({ actor_id: user.id })]);
        return { request_id: created[0].id, received_at: created[0].created_at, already_received: false };
    });
}
