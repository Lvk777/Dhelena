import { refundInFlight } from '../lib/refundState.js';
import { pool } from '../config/db.js';
import * as melhorEnvio from './melhorEnvio.js';
import { assertLabelEligible, getPersistedShippingService, normalizeBrazilianPhone, safeShippingPrintUrl } from '../lib/shipping.js';
import { moneyCents } from '../lib/afterSalesPolicy.js';
import { assertNoWithdrawalRequest } from '../lib/withdrawalRequest.js';

const error = (message, status = 409) => Object.assign(new Error(message), { status });
export function shippingEnvironment(order) {
    const mode = order.snapshot?.shipping_environment;
    if (!['sandbox', 'production'].includes(mode)) throw error('Ambiente do envio não comprovado; preserve o pedido e solicite análise.');
    return mode;
}

export function shippingPreparation(order, address, sender, invoiceKey) {
    const phone = normalizeBrazilianPhone(sender.phone), document = String(sender.document || '').replace(/\D/g, '');
    if (!sender.name || !sender.email || ![10, 11].includes(phone.length) || ![11, 14].includes(document.length)
        || !/^\d{8}$/.test(String(address.cep || '').replace(/\D/g, '')) || !address.street || !address.number
        || !address.district || !address.city || !/^[A-Z]{2}$/.test(address.state || '')) throw error('Dados do remetente incompletos.', 422);
    const to = order.shipping_address || {}, customer = order.snapshot?.customer || {};
    if (!to.street || !to.number || !to.district || !to.city || !/^[A-Z]{2}$/.test(to.state || '')
        || !/^\d{8}$/.test(String(to.cep || '').replace(/\D/g, '')) || !customer.name || !customer.email
        || String(customer.cpf || '').replace(/\D/g, '').length !== 11) throw error('Dados da destinatária incompletos.', 422);
    if (shippingEnvironment(order) === 'production' && !/^\d{44}$/.test(invoiceKey || '')) throw error('Informe a chave de 44 dígitos da NF-e do envio comercial.', 422);
    if (invoiceKey && !/^\d{44}$/.test(invoiceKey)) throw error('Chave de NF-e inválida.', 422);
    const volumes = order.snapshot?.shipping_packages;
    if (!Array.isArray(volumes) || !volumes.length || volumes.some(v => ['weight', 'height', 'width', 'length'].some(k => !Number.isFinite(Number(v[k])) || Number(v[k]) <= 0))) throw error('Volumes da cotação ausentes ou inválidos.');
    // Multiple-volume carrier contracts require a separate reviewed packing flow.
    if (volumes.length > 1) throw error('Envio com múltiplos volumes exige expedição assistida; nenhuma etiqueta foi comprada.');
    return { environment: shippingEnvironment(order), serviceId: getPersistedShippingService(order), invoiceKey,
        from: { ...sender, phone, document, address: address.street, ...address, postal_code: address.cep.replace(/\D/g, '') },
        to: { name: customer.name, phone: normalizeBrazilianPhone(customer.phone), email: customer.email,
            document: customer.cpf.replace(/\D/g, ''), address: to.street, number: to.number, complement: to.complement || '',
            district: to.district, city: to.city, state: to.state, postal_code: to.cep.replace(/\D/g, '') },
        products: (order.snapshot?.items || []).map(i => ({ name: i.product_name, qty: i.quantity, price: Number(i.unit_price) })),
        volumes, orderNumber: order.order_number, totalValue: Number(order.subtotal) - Number(order.discount) };
}

export function createShippingOperations({ db = pool, provider = melhorEnvio, env = process.env } = {}) {
    return async function operate(orderId, action, input = {}, actorId = null) {
        if (!['prepare', 'purchase', 'generate', 'print', 'refresh'].includes(action)) throw error('Ação de envio inválida.', 400);
        if (action === 'purchase' && (env.SHIPPING_LABEL_PURCHASE_ENABLED !== 'true' || input.confirm_purchase !== true)) throw error('Compra de etiquetas exige liberação operacional e confirmação explícita.', 403);
        const client = await db.connect(); let locked = false, inTransaction = false;
        const begin = async () => { await client.query('BEGIN'); inTransaction = true; await client.query("SET LOCAL lock_timeout='2000ms'"); await client.query("SET LOCAL statement_timeout='5000ms'"); };
        const commit = async () => { await client.query('COMMIT'); inTransaction = false; };
        const read = async () => {
            const { rows } = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
            if (!rows[0]) throw error('Pedido não encontrado.', 404);
            await assertNoWithdrawalRequest(client, orderId, env);
            assertLabelEligible(rows[0]); shippingEnvironment(rows[0]); if(await refundInFlight(client,orderId))throw error('Reembolso pendente impede expedição.');return rows[0];
        };
        const save = async (state, shipmentId, operation = {}) => {
            await client.query(`UPDATE orders SET shipping_status=$2, melhor_envio_shipment_id=COALESCE($3,melhor_envio_shipment_id),
                snapshot=jsonb_set(COALESCE(snapshot,'{}'::jsonb),'{shipping_operation}',$4::jsonb),updated_at=now() WHERE id=$1`,
            [orderId, state, shipmentId || null, JSON.stringify({ version: 1, ...operation })]);
        };
        const record = async (event, description, metadata = {}) => {
            await client.query('INSERT INTO order_events(order_id,event,description,metadata) VALUES($1,$2,$3,$4)',
                [orderId,event,description,JSON.stringify(metadata)]);
            await client.query(`INSERT INTO audit_logs(admin_id,action,entity_type,entity_id,changes) VALUES($1,$2,'order',$3,$4)`,
                [actorId,`shipping.${event}`,orderId,JSON.stringify(metadata)]);
        };
        try {
            const lock = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [`shipping-label:${orderId}`]);
            locked = lock.rows[0]?.locked === true;
            if (!locked) throw error('Uma operação de envio já está em andamento.');
            await begin(); let order = await read(), mode = shippingEnvironment(order), id = order.melhor_envio_shipment_id;
            const state = order.shipping_status, operation = order.snapshot?.shipping_operation || {};
            if (action === 'prepare') {
                if (id) { await commit(); return { shipment_id: id, status: state, environment: mode, price: operation.price ?? null }; }
                if (['cart_inflight', 'cart_uncertain'].includes(state)) throw error('Preparação com resultado incerto. Confira o painel do Melhor Envio antes de outra tentativa.');
                const settings = await client.query("SELECT key,value FROM settings WHERE key IN ('address','shipping_sender')");
                const values = Object.fromEntries(settings.rows.map(r => [r.key, r.value]));
                const request = shippingPreparation(order, values.address || {}, values.shipping_sender || {}, input.invoice_key);
                await save('cart_inflight', null); await commit();
                // Durable reservation survives a crash before or after the provider accepted the cart.
                await begin(); await read();
                const shipment = await provider.addShipmentToCart(request);
                id = shipment.shipment_id;
                await save('cart_created', id, { price: shipment.price });
                await record('label_prepared','Etiqueta preparada; compra ainda não realizada',{environment:mode});
                await commit(); return { shipment_id: id, status: 'cart_created', environment: mode, price: shipment.price };
            }
            if (!id) throw error('Prepare a etiqueta antes de continuar.');
            if (action === 'refresh') {
                await commit(); const tracking = await provider.getTracking(id, mode);
                if(state==='cart_created'){const cart=await provider.getShipment(id,mode);await begin();await read();await save(state,id,{...operation,price:cart.price});await commit();return {...tracking,price:cart.price,environment:mode,shipment_id:id};}
                // Resolving an ambiguous purchase requires positive official evidence; never replay checkout.
                if (['purchase_inflight', 'purchase_uncertain', 'generating'].includes(state) && ['released', 'posted', 'delivered'].includes(tracking.status)) {
                    await begin(); await read(); await save('generated', id, operation); await commit();
                }
                return { ...tracking, shipment_id: id, environment: mode };
            }
            if (action === 'purchase') {
                if (['purchased', 'generating', 'generated'].includes(state)) { await commit(); return { shipment_id: id, status: state, environment: mode }; }
                if (state !== 'cart_created') throw error('Compra pendente de confirmação no provedor; não será repetida.');
                const official = await provider.getShipment(id, mode);
                const cents = moneyCents(official.price);
                if (!Number.isSafeInteger(input.expected_price_cents) || cents !== input.expected_price_cents || !['pending', 'cart_created'].includes(official.status)) throw error('Preço ou estado da etiqueta mudou; confira novamente antes da compra.');
                await save('purchase_inflight', id, { price: official.price, actor_id: actorId });
                await record('label_purchase_requested','Compra de etiqueta confirmada pela administração',{environment:mode,price_cents:cents}); await commit();
                await begin(); await read();
                await provider.checkoutShipments([id], mode);
                await save('purchased', id, { price: official.price, actor_id: actorId });
                await record('label_purchased','Compra de etiqueta confirmada no provedor',{environment:mode,price_cents:cents}); await commit();
                return { shipment_id: id, status: 'purchased', environment: mode, price: official.price };
            }
            if (action === 'generate') {
                if (['generated', 'generating'].includes(state)) { await commit(); return { shipment_id: id, status: state, environment: mode }; }
                if (state !== 'purchased') throw error('Geração exige compra confirmada.');
                await save('generating', id, operation); await commit();
                await begin(); await read(); await provider.generateShipments([id], mode);
                await record('label_generation_requested','Geração de etiqueta solicitada',{environment:mode}); await commit();
                return { shipment_id: id, status: 'generating', environment: mode, message: 'Geração solicitada. Consulte o status antes de imprimir.' };
            }
            const official = await provider.getTracking(id, mode);
            if (!['released', 'posted', 'delivered'].includes(official.status)) throw error('Etiqueta ainda não liberada para impressão.');
            const printed = await provider.printShipments([id], mode);
            if(!safeShippingPrintUrl(printed.print_url))throw error('Link de impressão não confirmado no domínio do Melhor Envio.',502);
            await save(['posted','in_transit','out_for_delivery','delivered'].includes(state)?state:'generated', id, operation); await commit();
            return { ...printed, shipment_id: id, status: 'generated', environment: mode };
        } catch (err) {
            if (inTransaction) await client.query('ROLLBACK').catch(() => {});
            // Do not clear a durable in-flight checkpoint on uncertain external outcomes.
            throw err;
        } finally {
            if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`shipping-label:${orderId}`]).catch(() => {});
            client.release();
        }
    };
}
export const operateShipping = createShippingOperations();
