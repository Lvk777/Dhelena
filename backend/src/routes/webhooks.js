/**
 * Webhook routes — Mercado Pago & Melhor Envio
 * These routes do NOT require auth (login).
 * Security comes from signature/secret validation.
 */
import { Router } from 'express';
import crypto from 'crypto';
import { pool, withTransaction } from '../config/db.js';
import { authenticateOrderDelivery, acknowledgeOrderDelivery } from '../services/mercadoPagoWebhookQueue.js';
import { validateWebhook as validateMEWebhook, getTracking } from '../services/melhorEnvio.js';
import { isVerifiedPaymentForOrder } from '../lib/paymentVerification.js';



import { logSafeError } from '../lib/safeErrorLog.js';

const router = Router();

export { isVerifiedPaymentForOrder };

export function createWebhookEventId(req, preferNotificationId = false) {
    if (preferNotificationId && req.body?.id) return String(req.body.id);
    return crypto.createHash('sha256').update(req.rawBody || JSON.stringify(req.body)).digest('hex');
}

async function markWebhookProcessed(provider, eventId) {
    await pool.query(
        'UPDATE webhook_events SET processed = true WHERE provider = $1 AND event_id = $2',
        [provider, eventId]
    );
}

async function releaseWebhookForRetry(provider, eventId) {
    // The event is inserted before calling a provider API. If processing then
    // fails, remove this unprocessed reservation so the provider retry can run.
    await pool.query(
        'DELETE FROM webhook_events WHERE provider = $1 AND event_id = $2 AND processed = false',
        [provider, eventId]
    ).catch(() => {});
}

// Mercado Pago: acknowledge durable receipt, never financial completion.
router.post('/webhooks/mercado-pago', async (req, res) => {
    try {
        const delivery = authenticateOrderDelivery(req);
        const status = await acknowledgeOrderDelivery(delivery);
        return res.status(200).json({ status });
    } catch (error) {
        if (error.status === 200) return res.status(200).json({ status: 'unsupported_event' });
        if (error.status === 401) return res.status(401).json({ error: 'Assinatura ou ambiente inválido' });
        if (error.status === 400) return res.status(400).json({ error: 'Evento Order inconsistente' });
        logSafeError('mp_webhook_reservation_failed', error);
        return res.status(503).json({ error: 'Serviço temporariamente indisponível' });
    }
});
// ─── Melhor Envio Webhook ─────────────────────────────────────
// POST /api/webhooks/melhor-envio
router.post('/webhooks/melhor-envio', async (req, res) => {
    // Validate webhook
    if (!validateMEWebhook(req)) {
        console.warn('[Webhook ME] Invalid signature — rejected');
        return res.status(401).json({ error: 'Assinatura inválida' });
    }

    const event = req.body?.event || req.body?.type;
    const shipmentId = req.body?.shipment_id || req.body?.data?.shipment_id || req.body?.data?.id;
    const trackingCode = req.body?.tracking_code || req.body?.data?.tracking_code || req.body?.data?.tracking;
    const status = req.body?.status || req.body?.data?.status;

    // Melhor Envio does not send a separate delivery ID. The authenticated raw
    // payload remains identical on retries and changes for later statuses.
    const eventId = createWebhookEventId(req);
    try {
        const inserted = await pool.query(
            `INSERT INTO webhook_events (provider, event_id, event_type, payload, processed)
              VALUES ('melhor_envio', $1, $2, $3, false)
              ON CONFLICT (provider, event_id) DO NOTHING
              RETURNING id`,
            [eventId, event || 'unknown', JSON.stringify(req.body)]
        );
        if (inserted.rowCount === 0) return res.status(200).json({ status: 'already_processed' });
    } catch (err) {
        logSafeError('me_webhook_reservation_failed', err);
        return res.status(503).json({ error: 'Serviço temporariamente indisponível' });
    }

    try {
        // Find order by shipment ID or tracking code
        let orderRef = null;
        if (shipmentId) {
            const { rows } = await pool.query('SELECT * FROM orders WHERE melhor_envio_shipment_id = $1', [String(shipmentId)]);
            if (rows.length > 0) orderRef = rows[0];
        }
        if (!orderRef && trackingCode) {
            const { rows } = await pool.query('SELECT * FROM orders WHERE tracking_code = $1', [trackingCode]);
            if (rows.length > 0) orderRef = rows[0];
        }

        if (!orderRef) {
            console.warn(JSON.stringify({ event: 'me_webhook_order_not_found', shipment_id_present: !!shipmentId }));
            await markWebhookProcessed('melhor_envio', eventId);
            return res.status(200).json({ status: 'order_not_found' });
        }

        // Get latest tracking info from Melhor Envio
        let trackingInfo = null;
        if (shipmentId) {
            try {
                trackingInfo = await getTracking(shipmentId);
            } catch (e) {
                logSafeError('me_tracking_fetch_failed', e, 'warn');
            }
        }

        const updates = {};
        if (status) updates.shipping_status = status;
        if (trackingInfo?.tracking_code) updates.tracking_code = trackingInfo.tracking_code;
        if (trackingInfo?.posted_at) updates.posted_at = trackingInfo.posted_at;
        if (trackingInfo?.delivered_at) updates.delivered_at = trackingInfo.delivered_at;

        // Map ME status to internal order status
        if (status === 'posted' || status === 'enviado') {
            updates.status = 'enviado';
        } else if (status === 'in_transit' || status === 'em_transito') {
            updates.status = 'em_transporte';
        } else if (status === 'out_for_delivery' || status === 'saiu_entrega') {
            updates.status = 'saiu_entrega';
        } else if (status === 'delivered' || status === 'entregue') {
            updates.status = 'entregue';
            updates.delivered_at = new Date();
        }

        await withTransaction(async (client) => {
            if (Object.keys(updates).length > 0) {
            const setParts = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`);
            const values = Object.values(updates);
            values.push(orderRef.id);
            await client.query(
                `UPDATE orders SET ${setParts.join(', ')}, updated_at = now() WHERE id = $${values.length}`,
                values
            );

            // Record timeline event
            await client.query(
                `INSERT INTO order_events (order_id, event, description, metadata)
                 VALUES ($1, $2, $3, $4)`,
                [orderRef.id, `shipping_${status || 'update'}`, `Status de envio: ${status || 'atualizado'}`, JSON.stringify({ shipment_id: shipmentId, tracking_code: trackingCode })]
            );
            }
            await client.query(
                'UPDATE webhook_events SET processed = true WHERE provider = $1 AND event_id = $2',
                ['melhor_envio', eventId]
            );
        });

        console.log(JSON.stringify({ event: 'me_webhook_processed',
            order_number: /^DH-\d{4}-\d{6}$/.test(orderRef.order_number) ? orderRef.order_number : null,
            shipping_status: ['posted', 'enviado', 'in_transit', 'em_transito', 'out_for_delivery',
                'saiu_entrega', 'delivered', 'entregue'].includes(status) ? status : 'unknown' }));
        res.status(200).json({ status: 'ok', shipping_status: status });

    } catch (err) {
        logSafeError('me_webhook_processing_failed', err);
        await releaseWebhookForRetry('melhor_envio', eventId);
        res.status(503).json({ error: 'Serviço temporariamente indisponível' });
    }
});

export default router;
