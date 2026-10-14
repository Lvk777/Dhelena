import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationWorker,queueOrderEmails} from '../src/services/notificationOutbox.js';
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
    const worker=createNotificationWorker({db,env:{TRANSACTIONAL_EMAIL_ENABLED:'true',RESEND_API_KEY:'synthetic-only'}});
    assert.equal(await worker.processOne(),true);assert.equal(await worker.processOne(),false);assert.equal(requests,1);
});
test('outbox with missing migration fails closed before order or delivery mutation',async()=>{
    let queries=0;const db={query:async()=>{queries++;return {rows:[{count:0}]};}};
    assert.equal(await queueOrderEmails(null,null,{db,env:{TRANSACTIONAL_EMAIL_ENABLED:'true'}}),0);
    assert.equal(await createNotificationWorker({db,env:{TRANSACTIONAL_EMAIL_ENABLED:'true',RESEND_API_KEY:'synthetic'}}).processOne(),false);
    assert.equal(queries,2);
});
test('email preparation duration comes from the persisted order, never a fixed new promise',()=>{
    const order={order_number:'SYNTHETIC',status:'pagamento_aprovado',snapshot:{delivery_estimate:{preparation_business_days:3}}};
    const email=buildOrderEmail(order,'customer@example.test','payment_approved',{from:'Boutique <sender@example.test>'});
    assert.ok(email.text.includes('até 3 dia(s) úteis'));delete order.snapshot.delivery_estimate;
    assert.ok(buildOrderEmail(order,'customer@example.test','payment_approved',{}).text.includes('prazo contratado'));
});
