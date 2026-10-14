/**
 * Webhook routes — Mercado Pago & Melhor Envio
 * These routes do NOT require auth (login).
 * Security comes from signature/secret validation.
 */
import { Router } from 'express';
import crypto from 'crypto';
import { authenticateOrderDelivery, acknowledgeOrderDelivery } from '../services/mercadoPagoWebhookQueue.js';
import { acknowledgeShippingWebhook } from '../services/shippingWebhookQueue.js';
import { isVerifiedPaymentForOrder } from '../lib/paymentVerification.js';



import { logSafeError } from '../lib/safeErrorLog.js';

const router = Router();

export { isVerifiedPaymentForOrder };

export function createWebhookEventId(req, preferNotificationId = false) {
    if (preferNotificationId && req.body?.id) return String(req.body.id);
    return crypto.createHash('sha256').update(req.rawBody || JSON.stringify(req.body)).digest('hex');
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
// Melhor Envio: persist authenticated receipt; process outside the HTTP request.
router.post('/webhooks/melhor-envio', async (req, res) => {
    try { res.json({ status: await acknowledgeShippingWebhook(req) }); }
    catch (error) {
        logSafeError('me_webhook_receipt_failed', error);
        res.status(error.status || 503).json({ error: error.status === 401 ? 'Assinatura inválida' : 'Notificação indisponível' });
    }
});

export default router;
