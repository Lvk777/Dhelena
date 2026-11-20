import { pool } from '../config/db.js';

const fail = (message, status = 422) => Object.assign(new Error(message), { status });

export function validateFiscalUnlink(input = {}) {
    const reason = String(input.reason ?? '').trim();
    if (reason.length < 10 || reason.length > 1000) throw fail('Informe um motivo de 10 a 1000 caracteres para preservar a justificativa da troca.');
    if (!['national', 'svrs'].includes(input.official_source)
        || !['authorized', 'cancelled'].includes(input.prior_official_status)
        || input.confirmed_official_check !== true || input.confirmed_not_cancellation !== true) {
        throw fail('Consulte a situação da nota no portal oficial, registre o resultado e confirme que desvincular não cancela a NF-e.');
    }
    if (typeof input.document_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.document_id)) {
        throw fail('A nota fiscal mudou. Atualize o pedido antes de confirmar a desvinculação.', 409);
    }
    return { documentId: input.document_id, reason, source: input.official_source,
        priorStatus: input.prior_official_status };
}

export function assertFiscalUnlinkEligible(order) {
    if (!order) throw fail('Pedido não encontrado.', 404);
    if (order.melhor_envio_shipment_id || ['cart_created', 'purchase_inflight', 'purchase_uncertain',
        'purchased', 'generating', 'generated', 'posted', 'in_transit', 'out_for_delivery', 'delivered']
        .includes(order.shipping_status)) {
        throw fail('Este pedido já tem um envio identificado ou avançado no Melhor Envio. Solicite análise administrativa específica antes de trocar a NF-e.', 409);
    }
}

export function createFiscalUnlink({ db = pool } = {}) {
    return async function unlink(orderId, actorId, input) {
        const reviewed = validateFiscalUnlink(input);
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await client.query("SET LOCAL lock_timeout='2000ms'");
            const { rows: orders } = await client.query('SELECT id,shipping_status,melhor_envio_shipment_id FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
            assertFiscalUnlinkEligible(orders[0]);
            const { rows } = await client.query('SELECT id,access_key,origin,status FROM fiscal_documents WHERE order_id=$1 AND unlinked_at IS NULL FOR UPDATE', [orderId]);
            const current = rows[0];
            if (!current || current.id !== reviewed.documentId) throw fail('A nota fiscal ativa mudou. Atualize o pedido e confira antes de tentar novamente.', 409);
            if (current.origin !== 'xml') throw fail('Este cadastro não possui XML importado para desvincular.', 409);
            await client.query(`UPDATE fiscal_documents SET unlinked_at=now(),unlinked_by=$2,unlink_reason=$3,
                unlink_official_source=$4,prior_official_status=$5,updated_at=now()
                WHERE id=$1 AND unlinked_at IS NULL`, [current.id, actorId, reviewed.reason, reviewed.source, reviewed.priorStatus]);
            await client.query(`INSERT INTO audit_logs(admin_id,action,entity_type,entity_id,changes)
                VALUES($1,'fiscal.xml_unlinked','order',$2,$3)`, [actorId, orderId,
                JSON.stringify({ document_id: current.id, key_last4: current.access_key.trim().slice(-4),
                    previous_status: current.status, prior_official_status: reviewed.priorStatus,
                    official_source: reviewed.source, reason: reviewed.reason, shipping_released: false })]);
            await client.query('COMMIT');
            return { unlinked: true, document_id: current.id };
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            if (error.code === '55P03') throw fail('Outra operação está atualizando este pedido. Aguarde e tente novamente.', 409);
            throw error;
        } finally { client.release(); }
    };
}

export const unlinkFiscalDocument = createFiscalUnlink();
