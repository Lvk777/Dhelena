// Read-only local storefront rehearsal. Fetches only public catalog/settings once.
// No customer records, credentials, orders, payments or provider operations.
import express from 'express';

if (process.env.NODE_ENV !== 'test') throw Error('Requires NODE_ENV=test');
const base = 'https://api.dhelenas.com/api';
const resources = ['products', 'categories', 'collections', 'banners', 'settings'];
const data = Object.fromEntries(await Promise.all(resources.map(async resource => {
    const response = await fetch(`${base}/${resource}`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Error(`Public ${resource} unavailable`);
    return [resource, await response.json()];
})));
data.settings = data.settings.map(row => row.key === 'maintenance'
    ? { ...row, value: { ...row.value, maintenance_mode: false } } : row);

const app = express();
app.use(express.json());
app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', 'http://127.0.0.1:5953');
    res.set('Access-Control-Allow-Headers', 'Authorization,Content-Type');
    res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});
const admin = { id: '22222222-2222-4222-8222-222222222222', email: 'admin@example.test', full_name: 'Admin sintética', role: 'admin' };
app.post('/api/auth/login', (req, res) => req.body.email === admin.email && req.body.password === 'Synthetic123'
    ? res.json({ token: 'synthetic-catalog-session', user: admin }) : res.status(401).json({ error: 'Credenciais sintéticas inválidas' }));
app.get('/api/auth/me', (req, res) => req.headers.authorization === 'Bearer synthetic-catalog-session'
    ? res.json(admin) : res.status(401).json({ error: 'Sessão sintética necessária' }));
for (const resource of resources) app.get(`/api/${resource}`, (_req, res) => res.json(data[resource]));
app.get('/api/products/:id', (req, res) => {
    const product = data.products.find(item => item.id === req.params.id);
    return product ? res.json(product) : res.sendStatus(404);
});
app.get('/api/auth/capabilities', (_req, res) => res.json({ available: false, google: false }));
app.get('/api/*', (_req, res) => res.json([]));
app.use((_req, res) => res.status(405).json({ error: 'Fixture somente leitura' }));
app.listen(5954, '127.0.0.1', () => console.log(`Catalog UI fixture: ${data.products.length} public products; no external writes`));
