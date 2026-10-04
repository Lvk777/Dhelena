import pg from 'pg';

const { Pool } = pg;

// ─── Database connection ───────────────────────────────────────────
// In production: DATABASE_URL is required — no fallback.
// In development: falls back to local Docker PostgreSQL if Supabase is unreachable.
const isProduction = process.env.NODE_ENV === 'production';
const FALLBACK_URL = 'postgresql://postgres:postgres@postgres:5432/dhelenas';

if (isProduction && !process.env.DATABASE_URL) {
    console.error('[DB] FATAL: DATABASE_URL is required in production. Exiting.');
    process.exit(1);
}

const dbUrl = process.env.DATABASE_URL || FALLBACK_URL;
const isSupabase = dbUrl.includes('supabase');

let _pool = new Pool({
    connectionString: dbUrl,
    ssl: isSupabase ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 5000,
});

let _tested = false;
async function ensurePool() {
    if (_tested) return;
    _tested = true;
    try {
        await _pool.query('SELECT 1');
        console.log(`[DB] Connected to ${isSupabase ? 'Supabase PostgreSQL' : 'local PostgreSQL'}`);
    } catch (err) {
        if (isProduction) {
            console.error('[DB] FATAL: Database unreachable in production. Exiting.');
            process.exit(1);
        }
        if (isSupabase) {
            console.warn(`[DB] Supabase unreachable, falling back to local PostgreSQL (dev only)`);
            _pool = new Pool({ connectionString: FALLBACK_URL });
            await _pool.query('SELECT 1');
            console.log('[DB] Connected to local PostgreSQL (fallback)');
        } else {
            throw err;
        }
    }
}

// Wrapper that ensures connection is tested before first use
export const pool = {
    async query(text, params) {
        await ensurePool();
        return _pool.query(text, params);
    },
    async connect() {
        await ensurePool();
        return _pool.connect();
    },
    async end() {
        return _pool.end();
    },
    on(event, handler) {
        return _pool.on(event, handler);
    },
};

export async function query(text, params) {
    return pool.query(text, params);
}

export async function withTransaction(callback) {
    await ensurePool();
    const client = await _pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}
