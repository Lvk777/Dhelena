import crypto from 'crypto';
import { pool, withTransaction } from '../config/db.js';
import * as mercadoPago from './mercadoPago.js';
import { paymentContexts } from '../lib/mercadoPagoContext.js';
import { verifyResourceContext } from './mercadoPagoWebhookQueue.js';
import { planRefund, findIdempotentRefund, moneyCents, afterSalesError } from '../lib/afterSalesPolicy.js';
import { recordRefundOutcome } from '../afterSalesService.js';

function input(request) {
    const kind=request?.kind,reason=String(request?.reason||'').trim(),selected=request?.selected_items||[];
    if(!['full','remaining','partial'].includes(kind)||reason.length<5||reason.length>500||!Array.isArray(selected)
        ||(kind==='partial'&&!selected.length)||(kind!=='partial'&&selected.length)
        ||selected.some(i=>!i||Object.keys(i).some(k=>!['order_item_id','quantity'].includes(k)))) throw afterSalesError('Tipo, itens ou motivo inválidos.',400);
    return {kind,reason,selected};
}
function stateDigest(order,ledger) {
    return crypto.createHash('sha256').update(JSON.stringify([order.id,order.total,order.payment_status,order.mercado_pago_order_id,
        order.mercado_pago_payment_id,order.snapshot?.payment_context,ledger.map(r=>[r.id,r.status,r.amount])])).digest('hex');
}
function sign(data,key) { if(!key)throw afterSalesError('Confirmação segura de reembolso não configurada.',503);
    return crypto.createHmac('sha256',key).update('dhelenas-operational-refund-v1:'+data).digest('hex'); }
export function createOperationalRefundService({db=pool,transaction=withTransaction,provider=mercadoPago,contexts=paymentContexts,env=process.env,now=Date.now}={}) {
    async function official(order, supplied) {
        const bound=order?.snapshot?.payment_context;
        const matches=contexts().filter(c=>c.mode===bound?.mode&&c.credentialId===bound?.credential_id);
        if(matches.length!==1)throw afterSalesError('Tentativa legada ou credencial não comprovada; conciliação separada necessária.');
        const context=matches[0],identity=await provider.getWebhookCredentialIdentity(context);
        const remote=supplied || await provider.getRefundableOrder(order.mercado_pago_order_id,context);
        try { verifyResourceContext({version:1,resource_id:order.mercado_pago_order_id,application_id:bound.application_id},context,identity,order,remote.provider_resource); }
        catch {throw afterSalesError('Ambiente, aplicação ou vendedor do pagamento divergem.');}
        return {context,remote};
    }
    function confirm(order,ledger,request,actor,amount,token) {
        const data={version:1,order:order.id,actor,request,amount,state:stateDigest(order,ledger),expires:now()+300000};
        if(!token){const encoded=Buffer.from(JSON.stringify(data)).toString('base64url');return encoded+'.'+sign(encoded,env.INTEGRATION_ENCRYPTION_KEY);}
        const [encoded,signature,...extra]=String(token).split('.');
        if(extra.length||!encoded||!signature||! /^[a-f0-9]{64}$/.test(signature))throw afterSalesError('Confirmação inválida.');
        if(!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(sign(encoded,env.INTEGRATION_ENCRYPTION_KEY))))throw afterSalesError('Confirmação inválida.');
        let supplied;try{supplied=JSON.parse(Buffer.from(encoded,'base64url').toString());}catch{throw afterSalesError('Confirmação inválida.');}
        const {expires,...rest}=supplied;const expected={...data};delete expected.expires;
        if(!Number.isSafeInteger(expires)||expires<now()||expires>now()+300000||JSON.stringify(rest)!==JSON.stringify(expected))throw afterSalesError('Prévia expirou ou os valores mudaram. Consulte novamente.');
        return true;
    }
    function compareLedger(remote,ledger) {
        const done=ledger.filter(r=>r.status==='processed');
        if(remote.refunds.length!==done.length||done.some(row=>!remote.refunds.some(r=>r.id===row.provider_refund_id
            &&String(r.transaction_id)===String(row.provider_payment_id)&&r.status==='processed'&&moneyCents(r.amount)===moneyCents(row.amount))))throw afterSalesError('Histórico de reembolsos exige conciliação.');
    }
    async function load(client,id,lock=false,allowClosed=false) {
        const order=(await client.query(`SELECT * FROM orders WHERE id=$1${lock?' FOR UPDATE':''}`,[id])).rows[0];
        if(!order)throw afterSalesError('Pedido não encontrado.',404);
        if(!allowClosed&&!['approved','partially_refunded'].includes(order.payment_status))throw afterSalesError('Pagamento não elegível a reembolso.');
        const ledger=(await client.query('SELECT * FROM order_refunds WHERE order_id=$1 ORDER BY created_at',[id])).rows;
        const items=(await client.query('SELECT * FROM order_items WHERE order_id=$1',[id])).rows;
        return {order,ledger,items};
    }
    async function preview(id,actor,raw) {
        const request=input(raw),{order,ledger,items}=await load(db,id),{context,remote}=await official(order);
        compareLedger(remote,ledger);const amount=planRefund(order,remote,ledger,request.kind,request.selected,items);
        return {mode:context.mode,amount_cents:amount,kind:request.kind,enabled:env.AFTER_SALES_OPERATIONAL_ENABLED==='true'&&env.AFTER_SALES_REFUNDS_ENABLED==='true',
            confirmation:confirm(order,ledger,request,actor,amount),expires_in_seconds:300};
    }
    async function request(id,actor,raw,key) {
        if(env.AFTER_SALES_OPERATIONAL_ENABLED!=='true'||env.AFTER_SALES_REFUNDS_ENABLED!=='true')throw afterSalesError('Reembolsos operacionais desabilitados até homologação.',403);
        if(!/^[A-Za-z0-9_-]{8,128}$/.test(key||''))throw afterSalesError('Chave de idempotência inválida.',400);
        const desired=input(raw);
        const reservation=await transaction(async client=>{
            const {order,ledger,items}=await load(client,id,true,true);
            const previous=findIdempotentRefund(ledger,key,desired.kind,desired.reason,desired.selected,null);
            if(previous)return {previous};
            const {context,remote}=await official(order);compareLedger(remote,ledger);
            const amount=planRefund(order,remote,ledger,desired.kind,desired.selected,items);
            if(raw.confirm!==true)throw afterSalesError('Confirme explicitamente o reembolso.',400);
            confirm(order,ledger,desired,actor,amount,raw.confirmation);
            const saved=(await client.query(`INSERT INTO order_refunds(order_id,idempotency_key,kind,amount,status,provider_order_id,provider_payment_id,reason,actor_id,selected_items,return_id)
                VALUES($1,$2,$3,$4,'reserved',$5,$6,$7,$8,$9,NULL) RETURNING *`,[id,key,desired.kind,(amount/100).toFixed(2),order.mercado_pago_order_id,
                order.mercado_pago_payment_id,desired.reason,actor,JSON.stringify(desired.selected)])).rows[0];
            return {saved,ledger,amount,context};
        });
        if(reservation.previous)return reservation.previous;
        try {
            const result=await provider.refundOrder({mpOrderId:reservation.saved.provider_order_id,mpPaymentId:reservation.saved.provider_payment_id,
                amount:reservation.amount,full:desired.kind==='full',idempotencyKey:`refund-${reservation.saved.id}`,credentialContext:reservation.context});
            if(result.id!==reservation.saved.provider_order_id)throw afterSalesError('Resposta de reembolso divergente.');
            const refreshed=await provider.getRefundableOrder(reservation.saved.provider_order_id,reservation.context);
            // Verify official account/application again before any local financial confirmation.
            const {order}=await load(db,id);await official(order,refreshed);
            return await recordRefundOutcome(reservation.saved.id,refreshed,reservation.ledger,transaction);
        }catch{
            await db.query("UPDATE order_refunds SET status='reconciliation_required',provider_status='outcome_unconfirmed',updated_at=now() WHERE id=$1 AND status<>'processed'",[reservation.saved.id]);
            throw afterSalesError('Resultado pendente de confirmação oficial. Não repita o reembolso.');
        }
    }
    async function reconcile(id,actor,refundId) {
        if(env.AFTER_SALES_OPERATIONAL_ENABLED!=='true'||env.AFTER_SALES_REFUNDS_ENABLED!=='true')throw afterSalesError('Conciliação operacional desabilitada até homologação.',403);
        const {order,ledger}=await load(db,id,false,true);
        const row=ledger.find(r=>r.id===refundId);
        if(!row)throw afterSalesError('Reembolso não encontrado.',404);
        if(row.status==='processed')return row;
        const {remote}=await official(order),prior=ledger.filter(r=>r.id!==row.id);
        if(remote.refunds.length===prior.filter(r=>r.status==='processed').length){compareLedger(remote,prior);return row;}
        return recordRefundOutcome(row.id,remote,prior,transaction);
    }
    return {preview,request,reconcile};
}
export const operationalRefunds=createOperationalRefundService();
