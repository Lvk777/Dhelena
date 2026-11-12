// UI rehearsal only. Loopback, synthetic data, no database and no providers.
// Never use this process as the application backend.
import express from 'express';
import { previewCheckout } from '../src/lib/checkoutPreview.js';
import { validateCoupon } from '../src/services.js';
import { withDeliveryEstimate } from '../src/lib/deliveryEstimate.js';
if (process.env.NODE_ENV !== 'test') throw new Error('Synthetic UI fixture requires NODE_ENV=test');
const app = express();
app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', 'http://127.0.0.1:5953');
    res.set('Access-Control-Allow-Headers', 'Authorization,Content-Type');
    res.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});
app.use(express.json());
const id = '11111111-1111-4111-8111-111111111111';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640"><rect width="480" height="640" fill="#eadfe3"/><text x="240" y="300" text-anchor="middle" font-size="26" fill="#292526">Peça sintética</text><text x="240" y="345" text-anchor="middle" font-size="16">Ensaio local</text></svg>`;
const item = { id, name: 'Peça sintética', price: 199.90, status: 'published', category: 'Teste',
    sizes: ['M'], colors: [{ id: 'off_white', name: 'Off-white', stock: { M: 3 } }],
    images: ['data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')],
    weight: 0.3, package_height: 10, package_width: 15, package_length: 20 };
const user = { id: '22222222-2222-4222-8222-222222222222', email: 'synthetic@example.invalid',
    full_name: 'Cliente sintética', phone: '11999999999', cpf: '11144477735', role: 'customer' };
const settings = { general: { store_name: "D'Helenas", email: 'synthetic@example.invalid', phone: '(11) 99999-9999' }, store: { top_bar_text: 'ENSAIO LOCAL — PAGAMENTOS SIMULADOS' },
    maintenance: { maintenance_mode: false }, shipping: { pickup_enabled: false, pickup_name: 'Retirada sintética',
        free_shipping_enabled: true, free_shipping_threshold: 499, melhor_envio_enabled: true },
    payments: { pix_enabled: true, pix_discount: 5 }, address: { cep: '01001000' }, policies: {}, social: {}, seo: {} };
const coupon = { id: 'fixture', code: 'FIXTURE', active: true, discount_type: 'percentage', discount_value: 1, min_order_value: 0 };
const db = { query: async (sql, values = []) => {
    if (!sql.trim().startsWith('SELECT')) throw new Error('Synthetic preview attempted a mutation');
    if (sql.includes('FROM products')) return { rows: [structuredClone(item)] };
    if (sql.includes('FROM settings')) return { rows: Object.entries(settings).map(([key, value]) => ({ key, value })) };
    if (sql.includes('FROM coupons')) return { rows: values[0] === coupon.code ? [coupon] : [] };
    if (sql.includes('FROM look_promotions')) return { rows: [] };
    return { rows: [{ count: 0 }] };
} };
const options = { db, env: { PIX_DISCOUNT_ENABLED: 'true', SHIPPING_PREPARATION_ENABLED: process.env.SHIPPING_PREPARATION_ENABLED },
    quoteShipping: async () => [{ id: 1, price: 20, company: 'Transportadora sintética', name: 'Mock', delivery_time: 3 }] };
app.get('/health', (req, res) => res.json({ synthetic: true }));
app.get('/api/settings', (req, res) => res.json(Object.entries(settings)
    .filter(([key]) => !['payments', 'address'].includes(key)).map(([key, value]) => ({ id: key, key, value, is_public: true }))));
app.get('/api/products', (req, res) => res.json([item]));
app.get('/api/products/:id', (req, res) => res.json(item));
app.get('/api/auth/me', (req, res) => req.headers.authorization ? res.json(user) : res.status(401).json({ error: 'Não autenticado' }));
app.post('/api/auth/login', (req, res) => res.json({ token: 'synthetic-local-session', user }));
app.post('/api/auth/register', (req, res) => res.status(201).json({ token: 'synthetic-local-session', user }));
app.patch('/api/auth/me', (req, res) => { for (const key of ['full_name', 'phone', 'birth_date']) if (req.body[key]) user[key] = req.body[key]; res.json(user); });
app.post('/api/auth/forgot-password', (req, res) => res.status(503).json({ error: 'Synthetic email outage' }));
app.get('/api/payments/methods', (req, res) => res.json({ enabled: { pix: true, credit_card: true, debit_card: true },
    max_installments: 6, public_key: null, environment: 'Mock', pix_discount: { enabled: true, percentage: 5 } }));
app.post('/api/shipping/quote', (req, res) => res.json({ options: [withDeliveryEstimate({ id: 1, price: 20, company: 'Transportadora sintética', name: 'Mock', delivery_time: 3 }, settings.shipping, options.env)] }));
app.post('/api/checkout/preview', async (req, res, next) => { try { res.json(await previewCheckout(req.body, user.id, options)); } catch (error) { next(error); } });
app.post('/api/coupons/validate', async (req, res) => res.json(await validateCoupon(req.body.code, user.id, 199.90, [], { db })));
app.post('/api/look-promotions/validate', (req, res) => res.json({ promotion: null, discount: 0 }));
app.post('/api/orders', (req, res) => res.status(403).json({ error: 'Order creation disabled in UI fixture' }));
app.get('/api/*', (req, res) => res.json([]));
app.use((error, req, res, next) => res.status(error.status || 500).json({ error: 'Synthetic preview rejected' }));
app.listen(5954, '127.0.0.1', () => console.log('Synthetic UI API at 127.0.0.1:5954; no real orders/payments/emails'));
