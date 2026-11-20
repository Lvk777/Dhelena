import crypto from 'crypto';
import { safeApplicationId } from './mercadoPagoWebhookLog.js';

// The generic variables remain compatible with the current active TEST setup.
// Retained environments need their own complete set; never borrow another mode's key.
export function paymentContexts(env = process.env) {
    return ['test', 'production'].flatMap(mode => {
        const prefix = `MERCADO_PAGO_${mode.toUpperCase()}_`;
        const active = env.MERCADO_PAGO_MODE === mode;
        const scoped = ['ACCESS_TOKEN', 'WEBHOOK_SECRET', 'APPLICATION_ID'].some(key => env[prefix + key]);
        const accessToken = scoped ? env[prefix + 'ACCESS_TOKEN'] : active ? env.MERCADO_PAGO_ACCESS_TOKEN : null;
        const secret = scoped ? env[prefix + 'WEBHOOK_SECRET'] : active ? env.MERCADO_PAGO_WEBHOOK_SECRET : null;
        const applicationId = safeApplicationId(scoped ? env[prefix + 'APPLICATION_ID'] : active ? env.MERCADO_PAGO_APPLICATION_ID : null);
        if (!accessToken || !secret || ((scoped || mode === 'production') && !applicationId)) return [];
        const credentialId = crypto.createHmac('sha256', secret).update(JSON.stringify([mode, accessToken])).digest('hex');
        return [{ mode, accessToken, secret, applicationId, credentialId }];
    });
}

export function activePaymentContext() {
    return paymentContexts().find(context => context.mode === process.env.MERCADO_PAGO_MODE) || null;
}

export function paymentAttemptContext() {
    const context = activePaymentContext();
    if (!context) throw Object.assign(new Error('Contexto de pagamento incompleto'), { status: 503 });
    return { version: 1, mode: context.mode, credential_id: context.credentialId, application_id: context.applicationId };
}

// Called only with a fresh official readback of this backend's reserved attempt.
export async function bindPaymentAttempt(client, order, resource) {
    const { rows } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [order.id]);
    const context = rows[0]?.snapshot?.payment_context;
    if (!context) return; // Legacy attempts are preserved, never silently assigned a realm.
    if (context.application_id && context.application_id !== resource.application_id) {
        throw Object.assign(new Error('Aplicação do pagamento divergente'), { status: 409 });
    }
    if (typeof resource.live_mode === 'boolean' && resource.live_mode !== (context.mode === 'production')) {
        throw Object.assign(new Error('Ambiente do pagamento divergente'), { status: 409 });
    }
    const bound = { ...context, application_id: resource.application_id, provider_order_id: resource.mp_order_id };
    await client.query("UPDATE orders SET snapshot = jsonb_set(COALESCE(snapshot,'{}'::jsonb),'{payment_context}',$2::jsonb) WHERE id = $1", [order.id, JSON.stringify(bound)]);
}
