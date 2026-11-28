import crypto from 'crypto';
import { pool } from '../config/db.js';
import * as providerDefault from './melhorEnvio.js';
import { shippingEnvironment } from './shippingOperations.js';
import { notificationMetadata } from './notificationOutbox.js';
import { logSafeError } from '../lib/safeErrorLog.js';

const fail = code => Object.assign(new Error('Atualização de envio pendente de verificação'), { code });
// PostgreSQL JSONB reorders object keys. Authenticate a fixed ordered tuple.
function proof(core, secret) { return crypto.createHmac('sha256',secret).update(JSON.stringify([core.version,core.shipment_id,core.event_id])).digest('hex'); }
export async function acknowledgeShippingWebhook(req, { db = pool, env = process.env } = {}) {
    if (!providerDefault.validateWebhook(req,env)) throw Object.assign(fail('invalid_signature'),{status:401});
    const id = req.body?.shipment_id || req.body?.data?.shipment_id || req.body?.data?.id;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw Object.assign(fail('invalid_resource'),{status:400});
    const eventId = crypto.createHash('sha256').update(req.rawBody).digest('hex');
    const core = { version:1, shipment_id:id, event_id:eventId };
    const payload = { me_queue:core, seal:proof(core,env.MELHOR_ENVIO_WEBHOOK_SECRET), queue:{state:'pending',attempts:0,next_at:0} };
    // One short durable write; external APIs are never in the HTTP acknowledgement.
    const receipt = async () => {
        const client=await db.connect();
        try {
            await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='1000ms'");await client.query("SET LOCAL statement_timeout='5000ms'");
            const result=await client.query(`INSERT INTO webhook_events(provider,event_id,event_type,payload,processed)
                VALUES('melhor_envio',$1,'shipping_update',$2,false) ON CONFLICT(provider,event_id) DO NOTHING RETURNING id`,[eventId,JSON.stringify(payload)]);
            let status='queued';
            if(!result.rowCount){const existing=await client.query("SELECT processed FROM webhook_events WHERE provider='melhor_envio' AND event_id=$1",[eventId]);
                if(!existing.rows.length)throw fail('persistence_unconfirmed');status=existing.rows[0].processed===true?'already_processed':'pending';}
            await client.query('COMMIT');return status;
        }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err;}finally{client.release();}
    };
    let timeout;
    return Promise.race([receipt(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(fail('receipt_timeout')),10000);timeout.unref?.();})]).finally(()=>clearTimeout(timeout));
}

export function officialShippingUpdate(order, tracking) {
    if (order.payment_status !== 'approved' || order.status === 'cancelado') throw fail('order_not_eligible');
    const mapped = { posted:'enviado',in_transit:'em_transporte',out_for_delivery:'saiu_entrega',delivered:'entregue' }[tracking.status];
    const ranks = { recebido:0,pagamento_aprovado:1,em_separacao:2,enviado:3,em_transporte:4,saiu_entrega:5,entregue:6 };
    const next = mapped && ranks[mapped] > (ranks[order.status] ?? 100) ? mapped : order.status;
    const changed = next !== order.status || (tracking.tracking_code && tracking.tracking_code !== order.tracking_code);
    const shippingStatus=mapped && ranks[mapped] < (ranks[order.status] ?? 0) ? order.shipping_status : tracking.status;
    return { status:next,changed,shipping_status:shippingStatus,event:next !== order.status && next === 'enviado' ? 'order_shipped' : next !== order.status && next === 'entregue' ? 'order_delivered' : 'shipping_updated' };
}

export function createShippingWebhookWorker({ db=pool,provider=providerDefault,env=process.env,now=Date.now,intervalMs=30000 }={}) {
    let timer,running,stopped=false;
    async function processOne() {
        if(env.SHIPPING_TRACKING_WORKER_ENABLED!=='true' || !env.MELHOR_ENVIO_WEBHOOK_SECRET) return false;
        const c=await db.connect(); let event;
        try {
            await c.query('BEGIN'); await c.query("SET LOCAL lock_timeout='1000ms'"); await c.query("SET LOCAL statement_timeout='5000ms'");
            const selected=await c.query(`SELECT * FROM webhook_events WHERE provider='melhor_envio' AND processed=false
                AND payload->'me_queue'->>'version'='1' AND COALESCE(payload->'queue'->>'state','pending')<>'blocked'
                AND CASE WHEN payload->'queue'->>'next_at' ~ '^[0-9]{1,16}$' THEN (payload->'queue'->>'next_at')::bigint ELSE 0 END<=$1
                ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,[now()]);
            event=selected.rows[0];
            if(!event) {await c.query('COMMIT');return false;}
            const payload=event.payload,core=payload.me_queue;
            if(core.event_id!==event.event_id || typeof payload.seal!=='string' || !/^[a-f0-9]{64}$/.test(payload.seal)
                || !crypto.timingSafeEqual(Buffer.from(payload.seal),Buffer.from(proof(core,env.MELHOR_ENVIO_WEBHOOK_SECRET)))) throw fail('invalid_durable_proof');
            const orders=await c.query('SELECT * FROM orders WHERE melhor_envio_shipment_id=$1 FOR UPDATE',[core.shipment_id]);
            if(orders.rows.length===0) throw fail('shipment_not_bound');
            if(orders.rows.length!==1) throw fail('ambiguous_shipment');
            const order=orders.rows[0]; let mode;
            try {mode=shippingEnvironment(order);} catch {throw fail('legacy_environment_unverified');}
            const official=await provider.getTracking(core.shipment_id,mode);
            const change=officialShippingUpdate(order,official);
            if(change.changed) {
                await c.query(`UPDATE orders SET status=$2,tracking_code=COALESCE($3,tracking_code),shipping_status=$4,
                    posted_at=COALESCE($5,posted_at),snapshot=jsonb_set(COALESCE(snapshot,'{}'::jsonb),'{shipping_tracking}',$6::jsonb),updated_at=now() WHERE id=$1`,
                [order.id,change.status,official.tracking_code||null,change.shipping_status,
                    validDate(official.posted_at),JSON.stringify({status:change.shipping_status,delivered_at:validDate(official.delivered_at)})]);
                await c.query('INSERT INTO order_events(order_id,event,description,metadata) VALUES($1,$2,$3,$4)',
                [order.id,change.event,'Atualização confirmada pela transportadora',JSON.stringify(notificationMetadata({shipping_environment:mode},
                    {MERCADO_PAGO_MODE:order.snapshot?.payment_context?.mode || 'unverified'}))]);
            }
            await c.query('UPDATE webhook_events SET processed=true WHERE id=$1',[event.id]);
            await c.query('COMMIT');return true;
        } catch(err) {
            await c.query('ROLLBACK').catch(()=>{});
            if(!event) throw err;
            const blocked=['invalid_durable_proof','legacy_environment_unverified','ambiguous_shipment','order_not_eligible'].includes(err.code);
            const attempts=(Number(event.payload.queue?.attempts)||0)+1;
            await c.query(`UPDATE webhook_events SET payload=jsonb_set(payload,'{queue}',$2::jsonb)
                WHERE id=$1 AND processed=false AND payload=$3::jsonb`,[event.id,JSON.stringify({state:blocked?'blocked':'pending',attempts,
                    next_at:now()+Math.min(300000,15000*2**Math.min(attempts,4)),reason:blocked?err.code:'tracking_retry'}),JSON.stringify(event.payload)]);
            logSafeError('shipping_queue_pending',err);return true;
        } finally {c.release();}
    }
    async function tick(){if(stopped||running||env.SHIPPING_TRACKING_WORKER_ENABLED!=='true')return running;
        running=(async()=>{for(let i=0;i<10&&!stopped;i++)if(!await processOne())break;})().catch(e=>logSafeError('shipping_worker_failed',e)).finally(()=>{running=null;});return running;}
    return {processOne,tick,start(){if(timer||env.SHIPPING_TRACKING_WORKER_ENABLED!=='true')return;stopped=false;void tick();timer=setInterval(()=>void tick(),intervalMs);timer.unref?.();},async stop(){stopped=true;clearInterval(timer);await running;}};
}
function validDate(value){return value&&!Number.isNaN(Date.parse(value))?new Date(value).toISOString():null;}
