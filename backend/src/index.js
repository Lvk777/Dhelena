import express from 'express';
import cors from 'cors';
import fs from 'fs';
import { auth, errorHandler } from './middleware.js';
import { pool } from './config/db.js';
import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';
import orderRoutes from './routes/orders.js';
import userRoutes from './routes/user.js';
import adminRoutes from './routes/admin.js';
import uploadRoutes from './routes/upload.js';
import lookRoutes from './routes/look.js';

const app = express();

// ─── CORS ──────────────────────────────────────────────────────────
const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({
    origin: corsOrigin === '*' ? true : corsOrigin.split(',').map(s => s.trim()),
    credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(auth);

// ─── Routes ─────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api', catalogRoutes);
app.use('/api', orderRoutes);
app.use('/api', userRoutes);
app.use('/api', adminRoutes);
app.use('/api', uploadRoutes);
app.use('/api', lookRoutes);

// ─── Health check ──────────────────────────────────────────────────
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', database: 'connected' });
    } catch {
        res.status(503).json({ status: 'error', database: 'disconnected' });
    }
});

// ─── Static files for uploads (dev only) ───────────────────────────
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use('/api/uploads', express.static(uploadDir));

// ─── Auto-run migrations + seed on first start ─────────────────────
let initialized = false;
async function ensureInitialized() {
    if (initialized) return;
    try {
        const migrationsDir = './migrations';
        if (fs.existsSync(migrationsDir)) {
            const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
            for (const file of files) {
                const sql = fs.readFileSync(`${migrationsDir}/${file}`, 'utf8');
                await pool.query(sql);
                console.log(`[Migration] ✓ ${file}`);
            }
        }

        const { rows } = await pool.query('SELECT COUNT(*) as cnt FROM products');
        if (parseInt(rows[0].cnt) === 0) {
            console.log('[Seed] Products table empty, running seed...');
            const { runSeed } = await import('../seed/seed.js');
            await runSeed();
        }
        initialized = true;
        console.log('[API] Database initialized');
    } catch (err) {
        console.error('[API] Init error:', err.message);
        initialized = true;
    }
}

app.use(async (req, res, next) => {
    if (!initialized) await ensureInitialized();
    next();
});

app.use(errorHandler);

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[D'Helenas API] Running on port ${PORT}`);
    ensureInitialized();
});
