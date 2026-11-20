import test from 'node:test';
import assert from 'node:assert/strict';
import { canExpireReservation, reservationExpiryAt } from '../src/lib/orderReservationExpiry.js';
import { createOrderReservationExpiryWorker } from '../src/services/orderReservationExpiry.js';

const now = Date.parse('2026-10-26T12:00:00.000Z');
const pending = () => ({ id: 'synthetic-order', status: 'recebido', payment_status: 'pending',
    snapshot: { stock_model: 'deferred_sale_v1', reservation_expires_at: '2026-10-26T11:00:00.000Z' } });

test('expiry is opt-in, bounded and stamps only new orders', () => {
    assert.equal(reservationExpiryAt({}, () => now), null);
    assert.equal(reservationExpiryAt({ ORDER_RESERVATION_EXPIRY_ENABLED: 'true' }, () => now), '2026-10-26T13:00:00.000Z');
    for (const minutes of ['0', '29', '1441', 'abc', '1.5']) {
        assert.throws(() => reservationExpiryAt({ ORDER_RESERVATION_EXPIRY_ENABLED: 'true',
            ORDER_RESERVATION_TTL_MINUTES: minutes }, () => now), /Prazo de reserva inválido/);
    }
    assert.equal(reservationExpiryAt({ ORDER_RESERVATION_EXPIRY_ENABLED: 'true',
        ORDER_RESERVATION_TTL_MINUTES: '30' }, () => now), '2026-10-26T12:30:00.000Z');
});

test('legacy orders, future deadlines and every financial uncertainty fail closed', () => {
    assert.equal(canExpireReservation({ ...pending(), snapshot: {} }, now), false);
    assert.equal(canExpireReservation({ ...pending(), snapshot: { reservation_expires_at: pending().snapshot.reservation_expires_at } }, now), false);
    assert.equal(canExpireReservation({ ...pending(), snapshot: { reservation_expires_at: '2026-10-26T13:00:00.000Z' } }, now), false);
    assert.equal(canExpireReservation({ ...pending(), status: 'cancelado' }, now), false);
    assert.equal(canExpireReservation({ ...pending(), payment_status: 'approved' }, now), false);
    assert.equal(canExpireReservation(pending(), NaN), false);
    for (const field of ['paid_at', 'payment_provider', 'payment_attempt_started_at', 'payment_attempt_method',
        'mercado_pago_order_id', 'mercado_pago_payment_id', 'mercado_pago_status',
        'mercado_pago_external_reference', 'mercado_pago_status_detail', 'payment_updated_at',
        'pix_qr_code', 'pix_qr_code_base64', 'melhor_envio_shipment_id', 'tracking_code']) {
        assert.equal(canExpireReservation({ ...pending(), [field]: 'present' }, now), false, field);
    }
    assert.equal(canExpireReservation({ ...pending(), snapshot: { ...pending().snapshot, payment_context: { mode: 'production' } } }, now), false);
    assert.equal(canExpireReservation({ ...pending(), snapshot: { ...pending().snapshot, card_installment_offer: {} } }, now), false);
});

test('worker locks and cancels only an untouched expired order once', async () => {
    const order = pending(); let cancellations = 0; let expiryEvents = 0; let financialWrites = 0;
    const client = { query: async (sql) => {
        if (sql.includes('FROM orders WHERE id =')) return { rows: [{ ...order, database_now: new Date(now) }] };
        if (sql.includes('FROM order_events') || sql.includes('FROM order_refunds')
            || sql.includes('FROM order_returns') || sql.includes('FROM stock_restorations')) return { rows: [] };
        if (sql.includes('INSERT INTO order_events')) { expiryEvents++; return { rows: [] }; }
        financialWrites++; throw new Error('unexpected SQL');
    } };
    const worker = createOrderReservationExpiryWorker({ env: { ORDER_RESERVATION_EXPIRY_ENABLED: 'true' },
        now: () => now, db: { query: async () => ({ rows: [{ id: order.id }] }) },
        transaction: callback => callback(client), cancel: async (_client, current) => {
            assert.equal(current.id, order.id); cancellations++; order.status = 'cancelado';
        } });
    const results = await Promise.all([worker.runOnce(), worker.runOnce()]);
    assert.deepEqual(results, [{ expired: 1, disabled: false }, { expired: 1, disabled: false }]);
    assert.deepEqual(await worker.runOnce(), { expired: 0, disabled: false });
    assert.equal(cancellations, 1); assert.equal(expiryEvents, 1); assert.equal(financialWrites, 0);
});

test('worker does not cancel after an attempt starts or when history suggests payment activity', async () => {
    for (const blocked of ['attempt', 'event', 'restoration']) {
        const order = pending(); let cancelled = 0;
        const worker = createOrderReservationExpiryWorker({ env: { ORDER_RESERVATION_EXPIRY_ENABLED: 'true' }, now: () => now,
            db: { query: async () => ({ rows: [{ id: order.id }] }) }, transaction: callback => callback({ query: async sql => {
                if (sql.includes('FROM orders WHERE id =')) return { rows: [{ ...order,
                    ...(blocked === 'attempt' ? { payment_attempt_started_at: new Date(now) } : {}), database_now: new Date(now) }] };
                if (blocked === 'event' && sql.includes('FROM order_events')) return { rows: [{ exists: true }] };
                if (blocked === 'restoration' && sql.includes('FROM stock_restorations')) return { rows: [{ exists: true }] };
                return { rows: [] };
            } }), cancel: async () => { cancelled++; } });
        assert.deepEqual(await worker.runOnce(), { expired: 0, disabled: false });
        assert.equal(cancelled, 0, blocked);
    }
});
