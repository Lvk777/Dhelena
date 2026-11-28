// Browser rehearsal: loopback, in-memory synthetic data, no DB/provider requests.
import express from 'express';
if(process.env.NODE_ENV!=='test')throw Error('Requires NODE_ENV=test');
const app=express();app.use(express.json());
app.use((req,res,next)=>{res.set('Access-Control-Allow-Origin','http://127.0.0.1:5953');res.set('Access-Control-Allow-Headers','Authorization,Content-Type,X-Idempotency-Key');
    res.set('Access-Control-Allow-Methods','GET,POST,PATCH,OPTIONS');if(req.method==='OPTIONS')return res.sendStatus(204);next();});
const id='11111111-1111-4111-8111-111111111111';
const user={id:'22222222-2222-4222-8222-222222222222',email:'admin@example.test',full_name:'Administradora sintética',role:'admin'};
const order={id,order_number:'UI-SYNTHETIC-ONLY',user_id:user.id,payment_status:'approved',status:'pagamento_aprovado',payment_method:'credito',subtotal:100,total:120,discount:0,shipping_cost:20,
    shipping_method:'melhor_envio',shipping_status:null,shipping_quote_id:'1',created_date:new Date().toISOString(),items:[],snapshot:{shipping_environment:'sandbox',payment_context:{mode:'test',version:1}},shipping_address:{}};
app.get('/api/auth/me',(req,res)=>req.headers.authorization?res.json(user):res.status(401).json({error:'Sessão sintética necessária'}));
app.post('/api/auth/login',(req,res)=>res.json({token:'synthetic-session-only',user}));
app.get('/api/settings',(req,res)=>res.json([{key:'maintenance',value:{maintenance_mode:false}},{key:'general',value:{store_name:'D’Helenas — ENSAIO SINTÉTICO'}}]));
app.get('/api/settings/admin',(req,res)=>res.json([]));
app.get('/api/orders/:id/shipping/readiness',(req,res)=>res.json({environment:'sandbox',status:order.shipping_status,purchase_enabled:false,price:order.snapshot.shipping_operation?.price??null}));
app.post('/api/orders/:id/shipping/label',(req,res)=>{
    if(req.body.action==='purchase')return res.status(403).json({error:'Compra desativada no ensaio'});
    if(req.body.action==='prepare'){order.melhor_envio_shipment_id='synthetic-shipment';order.shipping_status='cart_created';order.snapshot.shipping_operation={price:'18.90'};}
    res.json({shipment_id:'synthetic-shipment',status:order.shipping_status,...(req.body.action==='print'?{print_url:'https://sandbox.melhorenvio.com.br/imprimir/synthetic-fixture'}:{})});
});
app.post('/api/orders/:id/refunds/operational/preview',(req,res)=>res.json({mode:'test',enabled:false,amount_cents:12000,confirmation:'synthetic-not-financial'}));
app.get('/api/orders/:id/after-sales',(req,res)=>res.json({returns:[],refunds:[],physical_schema_ready:true,refunds_enabled:false}));
app.get('/api/orders/:id/events',(req,res)=>res.json([]));
app.get('/api/orders/:id/tracking',(req,res)=>res.json({status:'pending',tracking_code:null,history:[]}));
app.get('/api/orders/:id',(req,res)=>res.json(order));
app.get('/api/orders',(req,res)=>res.json([order]));
app.get('/api/notifications/readiness',(req,res)=>res.json({delivery_enabled:false,outbox_schema_ready:false,api_key_configured:false,sender_and_reply_to_ready:false}));
app.get('/api/*',(req,res)=>res.json([]));
app.post('/api/*',(req,res)=>res.status(403).json({error:'Operação externa desativada no ensaio'}));
app.listen(5954,'127.0.0.1',()=>console.log('Operations UI fixture: only synthetic data; no external calls'));
