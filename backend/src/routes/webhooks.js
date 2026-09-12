/**
 * Webhook routes — Mercado Pago & Melhor Envio
 * These routes do NOT require auth (login).
 * Security comes from signature/secret validation.
 */
import { Router } from 'express';
import crypto from 'crypto';
import { pool, withTransaction } from '../config/db.js';
import { validateWebhookSignature, getOrderStatus, getPaymentStatus, mapPaymentStatus } from '../services/mercadoPago.js';
import { validateWebhook as validateMEWebhook, getTracking } from '../services/melhorEnvio.js';

const router = Router();

/** Verify the provider resource still represents this exact local order. */
export function isVerifiedPaymentForOrder(order, { external_reference, total_amount, currency_id }) {
    const equalAmount = Number.isFinite(Number(total_amount))
        && Math.round(Number(total_amount) * 100) === Math.round(Number(order.total) * 100);
    return external_reference === order.order_number && equalAmount && (!currency_id || currency_id === 'BRL');
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

// ─── Mercado Pago Webhook ──────────────────────────────────────
// POST /api/webhooks/mercado-pago
router.post('/webhooks/mercado-pago', async (req, res) => {
    const event = req.body?.type || req.body?.event;
    const dataId = req.query?.['data.id'] || req.body?.data?.id;

    // Only authenticated deliveries receive a 2xx response.
    if (!validateWebhookSignature(req)) {
        console.warn('[Webhook MP] Invalid signature — rejected');
        return res.status(401).json({ error: 'Assinatura inválida' });
    }

    // body.id is the provider's unique notification ID; data.id is the
    // resource and can recur for each status transition.
    const eventId = req.body?.id ? String(req.body.id) : (req.headers['x-request-id'] || crypto.randomUUID());
    try {
        const inserted = await pool.query(
            `INSERT INTO webhook_events (provider, event_id, event_type, payload, processed)
              VALUES ('mercado_pago', $1, $2, $3, false)
              ON CONFLICT (provider, event_id) DO NOTHING
              RETURNING id`,
            [eventId, event || 'unknown', JSON.stringify(req.body)]
        );
        if (inserted.rowCount === 0) return res.status(200).json({ status: 'already_processed' });
    } catch (err) {
        console.error('[Webhook MP] Could not reserve event:', err.message);
        return res.status(503).json({ error: 'Serviço temporariamente indisponível' });
    }

    try {
        // Find the order by external_reference or MP order ID
        let orderRef = null;

        // For Orders API webhooks, the body contains data.id which is the MP order ID
        if (dataId) {
            // Try to find by MP order ID
            const { rows } = await pool.query(
                'SELECT * FROM orders WHERE mercado_pago_order_id = $1 OR mercado_pago_external_reference = $1',
                [String(dataId)]
            );
            if (rows.length > 0) {
                orderRef = rows[0];
            } else {
                // Try to query MP for the order to get external_reference
                try {
                    const mpData = await getOrderStatus(String(dataId));
                    if (mpData.external_reference) {
                        const { rows: refRows } = await pool.query(
                            'SELECT * FROM orders WHERE order_number = $1',
                            [mpData.external_reference]
                        );
                        if (refRows.length > 0) orderRef = refRows[0];
                    }
                } catch (e) {
                    // Maybe it's a payment ID, not an order ID
                    try {
                        const payData = await getPaymentStatus(parseInt(dataId));
                        if (payData.external_reference) {
                            const { rows: refRows } = await pool.query(
                                'SELECT * FROM orders WHERE order_number = $1',
                                [payData.external_reference]
                            );
                            if (refRows.length > 0) orderRef = refRows[0];
                        }
                    } catch (e2) {
                        console.warn('[Webhook MP] Could not resolve order for data.id:', dataId);
                    }
                }
            }
        }

        if (!orderRef) {
            console.warn('[Webhook MP] Order not found for event:', event, 'data.id:', dataId);
            await markWebhookProcessed('mercado_pago', eventId);
            return res.status(200).json({ status: 'order_not_found' });
        }

        // Get the latest status from MP
        let mpStatus = null;
        let mpPaymentId = null;
        let mpTotal = null;
        let mpReference = null;
        let mpCurrency = null;
        if (orderRef.mercado_pago_order_id) {
            const mpData = await getOrderStatus(orderRef.mercado_pago_order_id);
            mpStatus = mpData.mp_status;
            mpPaymentId = mpData.mp_payment_id;
            mpTotal = mpData.total_amount;
            mpReference = mpData.external_reference;
            mpCurrency = mpData.currency_id;
        } else if (orderRef.mercado_pago_payment_id) {
            const payData = await getPaymentStatus(orderRef.mercado_pago_payment_id);
            mpStatus = payData.mp_status;
            mpPaymentId = payData.mp_payment_id;
            mpTotal = payData.transaction_amount;
            mpReference = payData.external_reference;
            mpCurrency = payData.currency_id;
        }

        if (!mpStatus) {
            await markWebhookProcessed('mercado_pago', eventId);
            return res.status(200).json({ status: 'no_status' });
        }
        if (!isVerifiedPaymentForOrder(orderRef, {
            external_reference: mpReference,
            total_amount: mpTotal,
            currency_id: mpCurrency,
        })) {
            console.warn('[Webhook MP] Rejected order with mismatched reference, amount, or currency');
            await markWebhookProcessed('mercado_pago', eventId);
            return res.status(200).json({ status: 'mismatched_payment' });
        }

        const internalStatus = mapPaymentStatus(mpStatus);

        // Update order idempotently
        const updates = {
            mercado_pago_status: mpStatus,
            payment_status: internalStatus,
            payment_updated_at: new Date(),
        };

        if (mpPaymentId) updates.mercado_pago_payment_id = mpPaymentId;

        if (internalStatus === 'approved' && orderRef.payment_status !== 'approved') {
            updates.paid_at = new Date();
            updates.status = orderRef.status === 'recebido' ? 'pagamento_aprovado' : orderRef.status;
        }

        const setParts = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`);
        const values = Object.values(updates);
        values.push(orderRef.id);

        await withTransaction(async (client) => {
            await client.query(
                `UPDATE orders SET ${setParts.join(', ')}, updated_at = now() WHERE id = $${values.length}`,
                values
            );
            await client.query(
                `INSERT INTO order_events (order_id, event, description, metadata)
                 VALUES ($1, $2, $3, $4)`,
                [orderRef.id, `payment_${internalStatus}`, `Pagamento ${internalStatus} via webhook MP`, JSON.stringify({ mp_status: mpStatus })]
            );
            await client.query(
                'UPDATE webhook_events SET processed = true WHERE provider = $1 AND event_id = $2',
                ['mercado_pago', eventId]
            );
        });

        console.log(`[Webhook MP] Order ${orderRef.order_number} → payment_status: ${internalStatus}`);
        res.status(200).json({ status: 'ok', payment_status: internalStatus });

    } catch (err) {
        console.error('[Webhook MP] Error:', err.message);
        await releaseWebhookForRetry('mercado_pago', eventId);
        res.status(503).json({ error: 'Serviço temporariamente indisponível' });
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
    const eventId = crypto.createHash('sha256').update(req.rawBody || JSON.stringify(req.body)).digest('hex');
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
        console.error('[Webhook ME] Could not reserve event:', err.message);
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
            console.warn('[Webhook ME] Order not found for shipment:', shipmentId);
            await markWebhookProcessed('melhor_envio', eventId);
            return res.status(200).json({ status: 'order_not_found' });
        }

        // Get latest tracking info from Melhor Envio
        let trackingInfo = null;
        if (shipmentId) {
            try {
                trackingInfo = await getTracking(shipmentId);
            } catch (e) {
                console.warn('[Webhook ME] Could not fetch tracking:', e.message);
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

        console.log(`[Webhook ME] Order ${orderRef.order_number} → shipping_status: ${status}`);
        res.status(200).json({ status: 'ok', shipping_status: status });

    } catch (err) {
        console.error('[Webhook ME] Error:', err.message);
        await releaseWebhookForRetry('melhor_envio', eventId);
        res.status(503).json({ error: 'Serviço temporariamente indisponível' });
    }
});

export default router;
