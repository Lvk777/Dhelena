import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'fs';
import { auth, errorHandler } from './middleware.js';
import { pool } from './config/db.js';
import { globalLimiter } from './middleware/rateLimiters.js';
import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';
import orderRoutes from './routes/orders.js';
import userRoutes from './routes/user.js';
import adminRoutes from './routes/admin.js';
import uploadRoutes from './routes/upload.js';
import lookRoutes from './routes/look.js';
import analyticsRoutes from './routes/analytics.js';
import contactRoutes from './routes/contact.js';
import securityRoutes from './routes/security.js';
import sitemapRoutes from './routes/sitemap.js';
import webhookRoutes from './routes/webhooks.js';

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
    const required = ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CORS_ORIGIN'];
    const missing = required.filter((name) => !process.env[name]);
    if (missing.length > 0 || process.env.CORS_ORIGIN === '*') {
        console.error('[API] FATAL: production configuration is incomplete or unsafe.');
        process.exit(1);
    }
}

// ─── Trust proxy (Railway + Cloudflare) ───────────────────────────
// In production, requests pass through Cloudflare → Railway proxy → Express.
// Trust only the immediately connected proxy. This makes protocol detection
// work without trusting an arbitrary X-Forwarded-For chain. It does not prove
// that the upstream request came from Cloudflare: direct Railway traffic must
// be blocked at infrastructure level before req.ip is a trusted identity.
if (isProduction) {
    // Cloudflare must remain the public edge and enforce visitor-IP limits.
    app.set('trust proxy', 1);
}

// ─── Security headers (Helmet) ────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: false, // Disabled to not break Supabase/inline styles; configure per-domain in production
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
}));
app.use(helmet.frameguard({ action: 'deny' }));
app.use(helmet.xContentTypeOptions());
app.use(helmet.referrerPolicy({ policy: 'strict-origin-when-cross-origin' }));

// ─── CORS ─────────────────────────────────────────────────────────
const corsOrigin = process.env.CORS_ORIGIN || (isProduction ? '' : '*');
app.use(cors({
    origin: corsOrigin === '*' ? true : (corsOrigin ? corsOrigin.split(',').map(s => s.trim()) : false),
    credentials: true,
}));

// ─── Body size limits ─────────────────────────────────────────────
app.use(express.json({
    limit: '100kb',
    // Melhor Envio signs the exact request payload. Keep it only in memory
    // for signature verification; it is never logged or returned.
    verify: (req, res, buffer) => { req.rawBody = Buffer.from(buffer); },
})); // JSON payloads limited to 100kb
app.use(express.urlencoded({ limit: '100kb', extended: true }));

// ─── Global rate limiter ──────────────────────────────────────────
app.use(globalLimiter);

app.use(auth);

// ─── Routes ───────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api', contactRoutes);
app.use('/api', analyticsRoutes);
app.use('/api', catalogRoutes);
app.use('/api', orderRoutes);
app.use('/api', userRoutes);
app.use('/api', adminRoutes);
app.use('/api', uploadRoutes);
app.use('/api', lookRoutes);
app.use('/api', securityRoutes);
app.use('/api', sitemapRoutes);
app.use('/api', webhookRoutes);

// ─── Health check ─────────────────────────────────────────────────
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', database: 'connected' });
    } catch {
        res.status(503).json({ status: 'error', database: 'disconnected' });
    }
});

// ─── Static files for uploads (dev only) ─────────────────────────
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use('/api/uploads', express.static(uploadDir));

// ─── Auto-run migrations + seed on first start ────────────────────
let initialized = false;
async function ensureInitialized() {
    if (initialized) return;
    try {
        // Check if core tables already exist (e.g. Supabase with pre-existing schema).
        // If they do, skip migrations — the schema is already set up and the
        // connected role may not own the tables (ALTER TABLE requires ownership).
        const { rows: tableCheck } = await pool.query(
            "SELECT to_regclass('public.products') AS exists"
        );
        const schemaExists = !!tableCheck[0].exists;

        if (!schemaExists) {
            const migrationsDir = './migrations';
            if (fs.existsSync(migrationsDir)) {
                const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
                for (const file of files) {
                    const sql = fs.readFileSync(`${migrationsDir}/${file}`, 'utf8');
                    await pool.query(sql);
                    console.log(`[Migration] ✓ ${file}`);
                }
            }
        } else {
            console.log('[Migration] Schema already exists — skipping migrations');
        }

        // Seed: NEVER run automatically in production.
        // In development, only seed when schema is fresh (no pre-existing tables).
        if (!isProduction) {
            const { rows } = await pool.query('SELECT COUNT(*) as cnt FROM products');
            if (parseInt(rows[0].cnt) === 0 && !schemaExists) {
                console.log('[Seed] Products table empty, running seed...');
                const { runSeed } = await import('../seed/seed.js');
                await runSeed();
            } else if (parseInt(rows[0].cnt) === 0 && schemaExists) {
                console.log('[Seed] Products table empty but schema pre-exists — skipping seed (run manually if needed)');
            }
        } else {
            console.log('[Seed] Production mode — automatic seed disabled');
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
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[D'Helenas API] Running on port ${PORT}`);
    ensureInitialized();
});

let shuttingDown = false;
async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[API] ${signal} received; closing HTTP server`);
    server.close(async () => {
        try { await pool.end(); } catch { /* pool may not have connected yet */ }
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
