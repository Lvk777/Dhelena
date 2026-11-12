import crypto from 'node:crypto';
import { pool, withTransaction } from '../config/db.js';
import { paymentContexts } from '../lib/mercadoPagoContext.js';
import { verifyPaymentResourceForOrder } from '../lib/paymentVerification.js';
import { applyVerifiedOrderInTransaction, recordVerifiedNonApprovedOrderInTransaction } from '../lib/paymentReconciliation.js';
import * as mp from './mercadoPago.js';

const needsReconciliation = () => Object.assign(new Error('Conciliação necessária'), { code: 'PAYMENT_CONTEXT_UNVERIFIED' });
const localStatus = order => ({ payment_status: order.payment_status, payment_method: order.payment_method,
    reconciliation_required: true, status_message: 'Este pagamento precisa de conciliação. Entre em contato com o atendimento antes de uma nova tentativa.',
    challenge_url: null });

// Fixed tuple survives JSONB key reordering. Only a server attestation of an
// independent official read is evidence; notification bodies/IDs/prefixes are not.
export function legacyStatusEvidencePayload(order, evidence) {
    return JSON.stringify(['legacy-status-official-read-v1', order.id, evidence.provider_order_id,
        evidence.mode, evidence.credential_id, evidence.application_id, evidence.seller_id]);
}

export function resolveStatusContext(order, contexts, evidence = []) {
    const bound = order.snapshot?.payment_context;
    if (bound) {
        const matched = contexts.filter(c => bound.version === 1 && c.mode === bound.mode
            && c.credentialId === bound.credential_id && !!c.applicationId && c.applicationId === bound.application_id
            && !!order.mercado_pago_order_id && bound.provider_order_id === order.mercado_pago_order_id);
        if (matched.length !== 1) throw needsReconciliation();
        return { context: matched[0], legacy: false };
    }
    if (!order.mercado_pago_order_id) throw needsReconciliation();
    const matched = [];
    for (const proof of evidence) {
        if (proof?.version !== 1 || proof.source !== 'official_order_read'
            || proof.provider_order_id !== order.mercado_pago_order_id
            || !/^[1-9][0-9]*$/.test(String(proof.seller_id || '')) || !/^[a-f0-9]{64}$/.test(proof.seal || '')) continue;
        for (const context of contexts) {
            if (context.mode !== proof.mode || context.credentialId !== proof.credential_id
                || !context.applicationId || context.applicationId !== proof.application_id) continue;
            const expected = crypto.createHmac('sha256', context.secret).update(legacyStatusEvidencePayload(order, proof)).digest();
            if (crypto.timingSafeEqual(expected, Buffer.from(proof.seal, 'hex'))) matched.push({ context, legacy: true, sellerId: proof.seller_id });
        }
    }
    // Duplicated identical attestations are harmless; contradictory proofs block.
    const distinct = [...new Map(matched.map(m => [JSON.stringify([m.context.credentialId, m.context.mode, m.sellerId]), m])).values()];
    if (distinct.length !== 1) throw needsReconciliation();
    return distinct[0];
}

function verifyIdentity(order, resource, selected, identity) {
    const c = selected.context;
    if (identity.mode !== c.mode || resource.user_id !== identity.userId
        || (selected.sellerId && selected.sellerId !== identity.userId)
        || resource.resource_type !== 'online' || resource.application_id !== c.applicationId
        || resource.mp_order_id !== order.mercado_pago_order_id
        || (typeof resource.live_mode === 'boolean' && resource.live_mode !== (c.mode === 'production'))) throw needsReconciliation();
    return verifyPaymentResourceForOrder(order, resource);
}

const fingerprint = order => JSON.stringify([order.snapshot?.payment_context, order.snapshot?.card_installment_offer,
    order.mercado_pago_order_id, order.mercado_pago_payment_id, order.order_number, order.total,
    order.payment_status, order.status, order.payment_attempt_started_at, order.payment_method]);

/** Historical selection never falls back to the active mode, including on 404.
 * Legacy reads cannot update financial state, release a reservation or backfill a snapshot.
 */
export async function readPaymentStatus(order, { provider = mp, contexts = paymentContexts(), db = pool,
    transaction = withTransaction } = {}) {
    try {
        // No provider calls at all for an unbound reservation.
        if (!order.mercado_pago_order_id) return localStatus(order);
        let evidence = [];
        if (!order.snapshot?.payment_context) {
            const result = await db.query("SELECT changes FROM audit_logs WHERE entity_type = 'order' AND entity_id = $1 AND action = 'payment_context_verified'", [order.id]);
            evidence = result.rows.map(r => r.changes);
        }
        const selected = resolveStatusContext(order, contexts, evidence);
        const identity = await provider.getWebhookCredentialIdentity(selected.context);
        if (identity.mode !== selected.context.mode || (selected.sellerId && identity.userId !== selected.sellerId)) throw needsReconciliation();
        const resource = verifyIdentity(order, await provider.getOrderStatus(order.mercado_pago_order_id, selected.context), selected, identity);
        if (selected.legacy) return { ...localStatus(order), context_verified: true,
            provider_payment_status: provider.mapPaymentStatus(resource.mp_status, resource.mp_status_detail),
            mp_status: resource.mp_status, mp_status_detail: resource.mp_status_detail, status_read_only: true };
        const internalStatus = provider.mapPaymentStatus(resource.mp_status, resource.mp_status_detail);
        return transaction(async client => {
            const { rows } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [order.id]);
            const current = rows[0];
            // Do not apply a stale GET after a webhook, cancellation, refund or method change.
            if (!current || fingerprint(current) !== fingerprint(order)) return localStatus(current || order);
            const result = internalStatus === 'approved'
                ? await applyVerifiedOrderInTransaction(client, order.id, resource, 'status_poll')
                : await recordVerifiedNonApprovedOrderInTransaction(client, order.id, resource, 'status_poll');
            return { payment_status: result.payment_status, payment_method: current.payment_method,
                mp_status: resource.mp_status, mp_status_detail: resource.mp_status_detail,
                reconciliation_required: result.outcome === 'manual_reconciliation_required',
                challenge_url: result.outcome === 'manual_reconciliation_required' ? null : resource.challenge_url };
        });
    } catch {
        // Provider 404/timeouts and invalid provenance never trigger a cross-context retry.
        return localStatus(order);
    }
}
