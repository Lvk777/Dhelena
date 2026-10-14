// Local visual rehearsal. Synthetic accounts only; no DB/providers/emails/financial operations.
import express from 'express';
if (process.env.NODE_ENV !== 'test') throw Error('Requires test mode');
const app = express(); app.use(express.json());
app.use((req, res, next) => { res.set('Access-Control-Allow-Origin', 'http://127.0.0.1:5953'); res.set('Access-Control-Allow-Headers', 'Authorization,Content-Type'); res.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS'); if (req.method === 'OPTIONS') return res.sendStatus(204); next(); });
const user = { id: '22222222-2222-4222-8222-222222222222', email: 'customer@example.test', full_name: 'Cliente de ensaio', role: 'customer', phone: '11999999999', cpf: '11144477735' };
app.get('/api/auth/capabilities', (_req, res) => res.json({ available: true, google: false }));
app.get('/api/auth/me', (req, res) => req.headers.authorization === 'Bearer synthetic-session-only' ? res.json(user) : res.status(401).json({ error: 'Não autenticado' }));
app.post('/api/auth/login', (req, res) => req.body.email === user.email && req.body.password === 'Existing123' ? res.json({ token: 'synthetic-session-only', user }) : res.status(401).json({ error: 'E-mail ou senha inválidos.' }));
app.patch('/api/auth/me', (_req, res) => res.status(503).json({ error: 'Falha sintética: seus campos foram preservados.' }));
app.get('/api/settings', (_req, res) => res.json([{ key: 'maintenance', value: { maintenance_mode: true } }, { key: 'general', value: { store_name: 'D’Helenas — ENSAIO LOCAL' } }]));
app.get('/api/addresses', (_req, res) => res.json([]));
app.post('/api/addresses', (_req, res) => res.status(503).json({ error: 'Falha sintética de gravação' }));
app.get('/api/orders', (_req, res) => res.status(503).json({ error: 'Falha sintética de consulta' }));
app.get('/api/*', (_req, res) => res.json([]));
app.use((_req, res) => res.status(403).json({ error: 'Operação desativada no ensaio' }));
app.listen(5954, '127.0.0.1', () => console.log('Auth UI fixture: synthetic-only, maintenance ON, no external writes'));
