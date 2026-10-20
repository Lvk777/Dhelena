import test from 'node:test';
import assert from 'node:assert/strict';
import {createShippingOperations,shippingEnvironment,shippingPreparation} from '../src/services/shippingOperations.js';
import {createShippingWebhookWorker,officialShippingUpdate} from '../src/services/shippingWebhookQueue.js';
import {safeShippingPrintUrl} from '../src/lib/shipping.js';
const origin={cep:'01001000',street:'Origem',number:'1',district:'Centro',city:'São Paulo',state:'SP'};
const sender={name:'Fixture',document:'12345678909',phone:'11999999999',email:'sender@example.test'};
const orderFixture={id:'fixture',shipping_quote_id:'1',payment_status:'approved',status:'pagamento_aprovado',shipping_method:'melhor_envio',
    subtotal:100,discount:5,shipping_address:{...origin},snapshot:{shipping_environment:'sandbox',customer:{...sender,cpf:sender.document},
        items:[{product_name:'Peça',quantity:1,unit_price:100}],shipping_packages:[{weight:0.3,height:3,width:20,length:30}]}};
function fixture(){
    let order=structuredClone(orderFixture),locked=false,backup;const calls=[];
    const query=async(sql,args=[])=>{
        if(sql==='BEGIN'){backup=structuredClone(order);return {rows:[]};}
        if(sql==='ROLLBACK'){order=backup;return {rows:[]};}
        if(sql==='COMMIT'||sql.startsWith('SET LOCAL'))return {rows:[]};
        if(sql.includes('pg_try_advisory_lock')){const result=!locked;if(result)locked=true;return {rows:[{locked:result}]};}
        if(sql.includes('pg_advisory_unlock')){locked=false;return {rows:[]};}
        if(sql.includes('to_regclass'))return {rows:[{relation:null}]};
        if(sql.includes('FROM orders'))return {rows:[structuredClone(order)]};
        if(sql.includes('FROM settings'))return {rows:[{key:'address',value:origin},{key:'shipping_sender',value:sender}]};
        if(sql.startsWith('UPDATE orders')){order.shipping_status=args[1];order.melhor_envio_shipment_id=args[2]||order.melhor_envio_shipment_id;
            order.snapshot.shipping_operation=JSON.parse(args[3]);return {rows:[]};}
        if(sql.startsWith('INSERT INTO order_events') || sql.startsWith('INSERT INTO audit_logs'))return {rows:[]};
        throw new Error('Unexpected mock SQL:'+sql);
    };
    const provider={addShipmentToCart:async request=>{calls.push(['cart',request.environment,request.to.complement]);return {shipment_id:'shipping-fixture',price:'18.90'};},
        getShipment:async(id,mode)=>{calls.push(['read',mode]);return {shipment_id:id,status:'pending',price:'18.90'};},
        checkoutShipments:async(ids,mode)=>calls.push(['checkout',mode]),generateShipments:async(ids,mode)=>calls.push(['generate',mode]),
        printShipments:async(ids,mode)=>{calls.push(['print',mode]);return {print_url:'https://sandbox.melhorenvio.com.br/imprimir/fixture'};},
        getTracking:async(id,mode)=>{calls.push(['tracking',mode]);return {status:'released',tracking_code:'MOCK'};}};
    const db={query,connect:async()=>({query,release(){}})},env={SHIPPING_LABEL_PURCHASE_ENABLED:'true'};
    return {operate:createShippingOperations({db,provider,env}),provider,env,calls,get order(){return order;}};
}
test('preparation and retries never buy a label; destination complement is preserved',async()=>{
    const f=fixture();f.order.shipping_address.complement='Apto fixture';await f.operate('fixture','prepare');await f.operate('fixture','prepare');
    assert.equal(f.calls.filter(c=>c[0]==='cart').length,1);assert.equal(f.calls[0][2],'Apto fixture');assert.equal(f.order.shipping_status,'cart_created');
});
test('purchase requires flag, explicit approval, fresh exact price and a single checkpoint',async()=>{
    const f=fixture();await f.operate('fixture','prepare');
    await assert.rejects(f.operate('fixture','purchase',{expected_price_cents:1890}));
    await assert.rejects(f.operate('fixture','purchase',{confirm_purchase:true,expected_price_cents:1889}));
    f.env.SHIPPING_LABEL_PURCHASE_ENABLED='false';await assert.rejects(f.operate('fixture','purchase',{confirm_purchase:true,expected_price_cents:1890}));
    f.env.SHIPPING_LABEL_PURCHASE_ENABLED='true';await f.operate('fixture','purchase',{confirm_purchase:true,expected_price_cents:1890});
    await f.operate('fixture','purchase',{confirm_purchase:true,expected_price_cents:1890});assert.equal(f.calls.filter(c=>c[0]==='checkout').length,1);
});
test('timeout after cart acceptance preserves in-flight reservation across restart',async()=>{
    const f=fixture();f.provider.addShipmentToCart=async()=>{f.calls.push(['cart']);throw new Error('timeout');};
    await assert.rejects(f.operate('fixture','prepare'));await assert.rejects(f.operate('fixture','prepare'));
    assert.equal(f.calls.length,1);assert.equal(f.order.shipping_status,'cart_inflight');
});
test('uncertain purchase cannot issue another checkout; official release resolves without charging',async()=>{
    const f=fixture();await f.operate('fixture','prepare');f.provider.checkoutShipments=async()=>{f.calls.push(['checkout']);throw new Error('timeout');};
    await assert.rejects(f.operate('fixture','purchase',{confirm_purchase:true,expected_price_cents:1890}));
    await assert.rejects(f.operate('fixture','purchase',{confirm_purchase:true,expected_price_cents:1890}));
    await f.operate('fixture','refresh');assert.equal(f.order.shipping_status,'generated');assert.equal(f.calls.filter(c=>c[0]==='checkout').length,1);
});
test('generation is asynchronous, repeated request does not generate twice, print is independent',async()=>{
    const f=fixture();await f.operate('fixture','prepare');await f.operate('fixture','purchase',{confirm_purchase:true,expected_price_cents:1890});
    await f.operate('fixture','generate');await f.operate('fixture','generate');assert.equal(f.calls.filter(c=>c[0]==='generate').length,1);
    assert.equal(f.calls.some(c=>c[0]==='print'),false);await f.operate('fixture','print');assert.equal(f.order.shipping_status,'generated');
});
test('tracking keeps the original Sandbox even when the active environment changes',async()=>{
    const f=fixture();await f.operate('fixture','prepare');f.env.MELHOR_ENVIO_MODE='production';await f.operate('fixture','refresh');
    assert.ok(f.calls.filter(c=>c[0]==='tracking').every(c=>c[1]==='sandbox'));
    assert.throws(()=>shippingEnvironment({snapshot:{}}));
});
test('production requires a real fiscal key and unsupported multiple volumes fail before cart',()=>{
    const order=structuredClone(orderFixture);order.snapshot.shipping_environment='production';
    assert.throws(()=>shippingPreparation(order,origin,sender));
    assert.equal(shippingPreparation(order,origin,sender,'1'.repeat(44)).invoiceKey.length,44);
    order.snapshot.shipping_packages.push(order.snapshot.shipping_packages[0]);assert.throws(()=>shippingPreparation(order,origin,sender,'1'.repeat(44)));
});
test('shipping status cannot regress a delivered order or advance an unpaid one',()=>{
    const order={status:'entregue',payment_status:'approved',tracking_code:'MOCK'};
    assert.equal(officialShippingUpdate(order,{status:'posted',tracking_code:'MOCK'}).changed,false);
    assert.throws(()=>officialShippingUpdate({...order,payment_status:'pending'},{status:'delivered'}));
});
test('label print links allow only HTTPS Melhor Envio hosts without credentials or unusual ports',()=>{
    assert.ok(safeShippingPrintUrl('https://sandbox.melhorenvio.com.br/imprimir/fixture'));
    for(const url of ['javascript:alert(1)','https://evil.example/imprimir/fixture','https://melhorenvio.com.br.evil.example/','https://user:secret@melhorenvio.com.br/','http://melhorenvio.com.br/','https://melhorenvio.com.br:444/'])assert.equal(safeShippingPrintUrl(url),null);
});

test('unsupported cancellation and disabled tracking worker make no provider or database calls',async()=>{
    const f=fixture();
    await assert.rejects(f.operate('fixture','cancel',{confirm_cancel:true}),{status:400});
    assert.equal(f.calls.length,0);
    let touched=false;
    const worker=createShippingWebhookWorker({db:{query(){touched=true;throw Error('unexpected database access');}},env:{}});
    assert.equal(await worker.processOne(),false);
    assert.equal(touched,false);
});
