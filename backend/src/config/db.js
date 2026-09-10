import pg from 'pg';

const { Pool } = pg;

// ─── Database connection with fallback ──────────────────────────────
// When Supabase DATABASE_URL is set but unreachable (e.g. IPv6-only),
// falls back to local Docker PostgreSQL so the dev environment keeps working.
const FALLBACK_URL = 'postgresql://dhelenas:dhelenas@postgres:5432/dhelenas';
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
        if (isSupabase) {
            console.warn(`[DB] Supabase unreachable (${err.message}), falling back to local PostgreSQL`);
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
