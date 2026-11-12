import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationWorker,queueOrderEmails,transactionalEmailCutover} from '../src/services/notificationOutbox.js';
import {buildOrderEmail} from '../src/services/orderEmail.js';

test('installed Resend SDK carries the stable idempotency key and cancellation signal to mocked HTTP',async t=>{
    const previous=global.fetch;t.after(()=>{global.fetch=previous;});let requests=0;
    const job={id:'synthetic-job',source_event_id:'synthetic-event',status:'pending',attempts:0,created_at:new Date(Date.now()-1000).toISOString(),
        delivery_payload:{from:'Boutique <sender@example.test>',to:'customer@example.test',subject:'Synthetic only',text:'Fixture',replyTo:'support@example.test'}};
    global.fetch=async(url,options)=>{requests++;assert.equal(url,'https://api.resend.com/emails');
        assert.equal(options.headers.get('Idempotency-Key'),'order-email-synthetic-job');assert.ok(options.signal instanceof AbortSignal);
        assert.equal(JSON.parse(options.body).reply_to,'support@example.test');return {ok:true,json:async()=>({id:'synthetic-provider-id'})};};
    const query=async(sql)=>{
        if(sql.includes('information_schema.columns'))return {rows:[{count:4}]};
        if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]};
        if(sql.startsWith('SELECT * FROM notification_logs'))return {rows:job.status==='sent'?[]:[structuredClone(job)]};
        if(sql.includes("status='retrying'")){job.status='retrying';return {rows:[]};}
        if(sql.includes("status='sent'")){job.status='sent';return {rows:[]};}
        if(sql.includes('pg_advisory_unlock'))return {rows:[]};
        throw Error('Unexpected synthetic query');
    };
    const db={query,connect:async()=>({query,release(){}})};
    const worker=createNotificationWorker({db,env:{TRANSACTIONAL_EMAIL_ENABLED:'true',TRANSACTIONAL_EMAIL_START_AT:new Date(Date.now()-60_000).toISOString(),RESEND_API_KEY:'synthetic-only'}});
    assert.equal(await worker.processOne(),true);assert.equal(await worker.processOne(),false);assert.equal(requests,1);
});
test('outbox with missing migration fails closed before order or delivery mutation',async()=>{
    let queries=0;const db={query:async()=>{queries++;return {rows:[{count:0}]};}};
    const env={TRANSACTIONAL_EMAIL_ENABLED:'true',TRANSACTIONAL_EMAIL_START_AT:new Date(Date.now()-60_000).toISOString(),RESEND_API_KEY:'synthetic'};
    assert.equal(await queueOrderEmails(null,null,{db,env}),0);
    assert.equal(await createNotificationWorker({db,env}).processOne(),false);
    assert.equal(queries,2);
});
test('enabled email remains inert without a valid activation cutover',async()=>{
    let queries=0;
    const db={query:async()=>{queries++;throw Error('must remain inert');}};
    for(const value of [undefined,'2026-02-30','2026-02-30T12:00:00Z','yesterday']){
        const env={TRANSACTIONAL_EMAIL_ENABLED:'true',TRANSACTIONAL_EMAIL_START_AT:value,RESEND_API_KEY:'synthetic'};
        assert.equal(transactionalEmailCutover(env),null);
        assert.equal(await queueOrderEmails(null,null,{db,env}),0);
        assert.equal(await createNotificationWorker({db,env}).processOne(),false);
    }
    assert.equal(queries,0);
});
test('cutover excludes historic events and queues distinct buyer and institutional messages once',async()=>{
    const cutover='2026-10-29T12:00:00.000Z';
    const env={TRANSACTIONAL_EMAIL_ENABLED:'true',TRANSACTIONAL_EMAIL_START_AT:cutover,
        TRANSACTIONAL_EMAIL_ENVIRONMENT:'production',EMAIL_FROM:'pedidos@dhelenas.com',
        EMAIL_ALLOWED_SENDERS:'pedidos@dhelenas.com',EMAIL_REPLY_TO:'contato@dhelenas.com'};
    const rows=[
        {source_event_id:'historic',notification_event:'order_created',created_at:'2026-10-28T12:00:00Z'},
        {source_event_id:'created',notification_event:'order_created',created_at:'2026-10-29T12:01:00Z'},
        {source_event_id:'approved',notification_event:'payment_approved',created_at:'2026-10-29T12:02:00Z'},
    ].map(row=>({id:'synthetic-order',order_number:'SYNTHETIC-1',status:row.notification_event==='payment_approved'?'pagamento_aprovado':'recebido',
        user_email:'conta@example.test',checkout_email:'compradora@example.test',user_name:'Compradora',total:20,subtotal:20,shipping_cost:0,discount:0,
        snapshot:{items:[]},...row}));
    const queuedEvents=new Set(), sent=new Map();
    const settings=[{key:'general',value:{email:'contato@dhelenas.com'}},
        {key:'emails',value:{sender_name:'D’Helenas Boutique',sender_email:'pedidos@dhelenas.com',reply_to:'pedidos@dhelenas.com',customer_enabled:true}},
        {key:'notifications',value:{email_enabled:true,recipients:[{name:'Juliane',email:'',active:true},
            {name:'Lucilene',email:'',active:true},
            {name:'Pedidos',email:'pedidos@dhelenas.com',active:true,
                events:['order_created','payment_approved','order_cancelled','order_shipped','order_delivered']}]}}];
    const query=async(sql,params=[])=>{
        if(sql.includes('information_schema.columns'))return {rows:[{count:4}]};
        if(sql.includes("SELECT key,value FROM settings"))return {rows:settings};
        if(sql.includes('FROM order_events e JOIN orders')){
            assert.match(sql,/e\.created_at >= \$5::timestamptz/);
            return {rows:rows.filter(row=>row.created_at>=params[4] && !queuedEvents.has(row.source_event_id)
                && (params[1]===null || row.notification_event===params[1]))};
        }
        if(sql.startsWith('INSERT INTO notification_logs')){
            const [orderId,event,recipient,,payload]=params;
            const key=`${orderId}:${event}:${recipient}`;
            if(sent.has(key))return {rowCount:0,rows:[]};
            sent.set(key,JSON.parse(payload));return {rowCount:1,rows:[]};
        }
        if(sql.startsWith('UPDATE order_events SET metadata')){queuedEvents.add(params[0]);return {rows:[]};}
        return {rows:[]};
    };
    const db={query,connect:async()=>({query,release(){}})};
    assert.equal(await queueOrderEmails(null,'order_created',{db,env}),2);
    assert.equal(await queueOrderEmails(null,'order_created',{db,env}),0);
    assert.equal(sent.size,2);
    assert.deepEqual([...sent.values()].map(payload=>payload.to).sort(),['compradora@example.test','pedidos@dhelenas.com']);
    for(const payload of sent.values()){
        assert.equal(payload.from,'D’Helenas Boutique <pedidos@dhelenas.com>');
        assert.equal(payload.replyTo,'pedidos@dhelenas.com');
        assert.match(payload.text,/Recebemos seu pedido/);
        assert.doesNotMatch(payload.text,/pagamento foi confirmado/i);
    }
    assert.equal(await queueOrderEmails(null,'payment_approved',{db,env}),2);
    assert.equal(sent.size,4);
    assert.equal([...sent.values()].filter(payload=>/Pagamento aprovado/.test(payload.subject)).length,2);
    assert.equal(queuedEvents.has('historic'),false);
});
test('a failed delivery retries its frozen payload with the same provider key',async()=>{
    const now=Date.now(), keys=[];
    const job={id:'synthetic-job',source_event_id:'synthetic-event',status:'pending',attempts:0,
        created_at:new Date(now-1000).toISOString(),next_attempt_at:new Date(now-1000).toISOString(),
        delivery_payload:{from:'D’Helenas Boutique <pedidos@dhelenas.com>',to:'compradora@example.test',
            replyTo:'pedidos@dhelenas.com',subject:'Pedido recebido: SYNTHETIC-1',text:'Synthetic only'}};
    const query=async(sql,params=[])=>{
        if(sql.includes('information_schema.columns'))return {rows:[{count:4}]};
        if(sql.startsWith('SELECT * FROM notification_logs')){
            if(sql.includes('ORDER BY'))assert.match(sql,/e\.created_at >= \$1::timestamptz/);
            return {rows:job.status==='sent'?[]:[structuredClone(job)]};
        }
        if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]};
        if(sql.includes("status='retrying'")){job.status='retrying';job.attempts++;job.first_attempt_at ||= new Date(now).toISOString();return {rows:[]};}
        if(sql.includes("status='failed'")){job.status='failed';job.error=params[1];job.next_attempt_at=new Date(now-1000).toISOString();return {rows:[]};}
        if(sql.includes("status='sent'")){job.status='sent';job.delivery_payload=null;return {rows:[]};}
        if(sql.includes('pg_advisory_unlock'))return {rows:[]};
        throw Error('Unexpected synthetic query');
    };
    const db={query,connect:async()=>({query,release(){}})};
    const env={TRANSACTIONAL_EMAIL_ENABLED:'true',TRANSACTIONAL_EMAIL_START_AT:new Date(now-60_000).toISOString(),RESEND_API_KEY:'synthetic'};
    let calls=0;
    const worker=createNotificationWorker({db,env,now:()=>now,send:async(payload,key)=>{
        keys.push(key);calls++;assert.equal(payload.to,'compradora@example.test');
        if(calls===1)throw Error('Synthetic provider outage');
        return {data:{id:'synthetic-provider-id'}};
    }});
    assert.equal(await worker.processOne(),true);
    assert.equal(job.status,'failed');
    assert.equal(await worker.processOne(),true);
    assert.equal(job.status,'sent');
    assert.equal(await worker.processOne(),false);
    assert.deepEqual(keys,['order-email-synthetic-job','order-email-synthetic-job']);
    assert.equal(job.delivery_payload,null);
});
test('email preparation duration comes from the persisted order, never a fixed new promise',()=>{
    const order={order_number:'SYNTHETIC',status:'pagamento_aprovado',snapshot:{delivery_estimate:{preparation_business_days:3}}};
    const email=buildOrderEmail(order,'customer@example.test','payment_approved',{from:'Boutique <sender@example.test>'});
    assert.ok(email.text.includes('até 3 dia(s) úteis'));delete order.snapshot.delivery_estimate;
    assert.ok(buildOrderEmail(order,'customer@example.test','payment_approved',{}).text.includes('prazo contratado'));
});
