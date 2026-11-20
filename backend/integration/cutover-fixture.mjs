// Local-only UI regression fixture. Never starts the real backend or a database.
import http from 'node:http';
import fs from 'node:fs';
import { createServer } from 'vite';

if (!process.argv.includes('--local-fixture') || process.env.NODE_ENV === 'production') throw new Error('Local fixture opt-in required.');
const root = new URL('../../', import.meta.url);
const initial = JSON.parse(fs.readFileSync(new URL('src/data/initialData.json', root), 'utf8'));
const product = initial.Product[0];
const launchEmpty = process.argv.includes('--launch-empty');
const fixtureProducts = launchEmpty ? [{ ...product, status: 'archived' }] : initial.Product;
const orderId = '11111111-1111-4111-8111-111111111111';
const fixtureUser = { id: '22222222-2222-4222-8222-222222222222', role: 'admin', email: 'fixture@example.test', full_name: 'QA Fixture', phone: '(11) 91234-5678', cpf: '52998224725' };
const order = { id: orderId, order_number: 'QA-FIXTURE-ONLY', user_id: fixtureUser.id, status: 'pagamento_aprovado', payment_status: 'approved', payment_method: 'pix', total: 80, subtotal: 80, discount: 0, shipping_cost: 0, shipping_method: 'retirada', created_date: new Date().toISOString(),
    snapshot: { customer: { name: 'QA Fixture', email: fixtureUser.email }, items: [{ product_id: product.id, product_name: product.name, color_id: product.colors[0].id, color_name: product.colors[0].name, size: product.sizes[0], quantity: 1, unit_price: 80, subtotal: 80, image: product.images[0] }] }, shipping_address: {} };
const settings = [
    { key: 'general', value: { store_name: "D'Helenas", public_address: '', business_hours: '', company_name: '', cnpj: '', email: '', phone: '', whatsapp: '', external_link_origins: ['https://www.instagram.com'] } },
    { key: 'maintenance', value: { maintenance_mode: true } },
    { key: 'shipping', value: { pickup_enabled: true, pickup_name: 'Retirada', pickup_address: 'PUBLIC PICKUP FIXTURE ONLY', pickup_instructions: 'PICKUP INSTRUCTIONS FIXTURE ONLY', pickup_time: 'A combinar', free_shipping_enabled: true, free_shipping_threshold: 499, melhor_envio_enabled: true } },
    { key: 'address', value: { street: 'PRIVATE SENDER FIXTURE', cep: '01001000' } },
    { key: 'shipping_sender', value: { name: 'PRIVATE SENDER FIXTURE', email: 'private@example.test' } },
    { key: 'emails', value: { sender_name: "D'Helenas", sender_email: '', reply_to: '' } },
    { key: 'policies', value: { privacy_policy: 'POLICY FIXTURE ONLY', return_policy: '', shipping_policy: '', terms_of_use: '' } },
    { key: 'social', value: { instagram: '', whatsapp: '' } },
].map((row, i) => ({ ...row, id: String(i + 1), is_public: !['address', 'shipping_sender', 'emails'].includes(row.key) }));
const banners = initial.Banner.map((banner, i) => ({ ...banner, internal_name: 'QA Banner ' + i, button_text: i === 0 ? 'UNSAFE CTA FIXTURE' : 'Ver coleção', button_link: i === 0 ? '/\\evil.example' : '/colecoes' }));
const calls = [], prohibited = [];
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1:5562'), path = url.pathname.replace(/^\/api/, '');
    res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5552');
    res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,OPTIONS');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    calls.push({ method: req.method, path });
    const send = (body, status = 200) => { res.writeHead(status); res.end(JSON.stringify(body)); };
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    if (path === '/qa-proof') return send({ fixtureOnly: true, calls, prohibited });
    if (req.method !== 'GET') {
        if (launchEmpty && req.method === 'POST' && path === '/products' && body.status === 'draft' && body.name?.trim()) {
            const draft = { ...body, id: '88888888-8888-4888-8888-888888888888', updated_date: new Date().toISOString() };
            fixtureProducts.push(draft);
            return send(draft, 201);
        }
        if (path === '/auth/login') return send({ token: 'LOCAL_FIXTURE_ONLY', user: fixtureUser });
        if (path === '/shipping/quote') return send({ options: [{ id: 1, name: 'QA service', company: 'QA carrier', price: 12.5, delivery_time: 3 }] });
        if (path === '/coupons/validate') return send({ valid: body.code === 'QA-FIXTURE', discount: 5, discount_type: 'fixed', discount_value: 5 });
        if (path === '/analytics/track' || path === '/audit-logs') return send({ success: true });
        if (path.startsWith('/settings')) {
            const record = settings.find(row => row.id === path.split('/').at(-1) || row.key === body.key);
            if (!record) return send({ error: 'Missing fixture' }, 404);
            record.value = body.value; return send(record);
        }
        prohibited.push({ method: req.method, path }); return send({ error: 'MUTATION BLOCKED IN LOCAL FIXTURE' }, 403);
    }
    if (path === '/auth/me') return send(fixtureUser);
    if (path === '/products') return send(fixtureProducts);
    if (path.startsWith('/products/')) return send(initial.Product.find(row => row.id === path.split('/')[2]) || product);
    if (path === '/categories') return send(initial.Category);
    if (path === '/collections') return send(initial.Collection);
    if (path === '/banners') return send(banners);
    if (path === '/settings') return send(settings);
    if (path === '/orders') return send([order]);
    if (path === '/admin/launch-summary') return send({ configured: true, start_at: new Date().toISOString(), orders: 0,
        paid_orders: 0, buyers: 0, gross_paid: 0, refunds: 0, net_revenue: 0, average_paid_order: 0,
        profit: 0, profit_note: 'Dados sintéticos; custos de vendas futuras serão conciliados.',
        refund_inconsistencies: 0, published_products: 0, daily: [], monthly: [], statuses: [],
        top_products: [], recent_orders: [] });
    if (path.endsWith('/events')) return send([{ id: 'fixture-event', event: 'payment_approved', status: 'pagamento_aprovado', created_at: order.created_date }]);
    if (path.startsWith('/orders/') && !path.includes('/after-sales') && !path.includes('/payment-preview')) return send(order);
    if (path.endsWith('/after-sales')) return send({ refunds: [], returns: [], refund_available: false });
    if (path === '/coupons') return send([{ id: 'fixture-coupon', code: 'QA-FIXTURE', active: true, discount_type: 'fixed', discount_value: 5 }]);
    if (path === '/payments/methods') return send({ enabled: { pix: true, credit_card: true, debit_card: true }, max_installments: 6, mode: 'test', public_key: '' });
    if (path === '/integrations/config') return send([]);
    if (path === '/integrations/status') return send([{ key: 'melhorEnvio', status: 'Configurado', environment: 'Sandbox (teste)', readiness: { mode: 'sandbox' }, environments: { sandbox: { oauth_token_present: true, token_expired: false }, production: { oauth_configured: false, oauth_token_present: false } } }]);
    if (path === '/stock-movements' || path === '/audit-logs' || path === '/notifications' || path === '/users' || path === '/favorites' || path === '/addresses' || path === '/size-guides' || path === '/look-promotions' || path === '/look-promotions/admin' || path === '/login-history') return send([]);
    return send({});
});
server.listen(5562, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
process.env.VITE_API_URL = 'http://127.0.0.1:5562';
process.env.VITE_SUPABASE_URL = '';
process.env.VITE_SUPABASE_ANON_KEY = '';
const vite = await createServer({ root: fs.realpathSync(root), mode: 'development', server: { host: '127.0.0.1', port: 5552, strictPort: true } });
await vite.listen();
console.log(JSON.stringify({ fixtureOnly: true, launchEmpty, url: 'http://127.0.0.1:5552', productId: product.id, orderId, api: 'http://127.0.0.1:5562/api', financialMutationsAllowed: false }));
const stop = async () => { await vite.close(); server.closeAllConnections(); server.close(); process.exit(0); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
