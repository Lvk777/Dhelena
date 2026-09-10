import fs from 'fs';
import path from 'path';
import { pool } from './config/db.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runMigrations() {
    const migrationsDir = path.join(__dirname, '..', 'migrations');
    if (!fs.existsSync(migrationsDir)) {
        console.log('[Migration] No migrations directory');
        await pool.end();
        return;
    }
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
        console.log(`[Migration] Running ${file}...`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        await pool.query(sql);
        console.log(`[Migration] ✓ ${file}`);
    }
    console.log('[Migration] All migrations completed');
    await pool.end();
}

runMigrations().catch(err => {
    console.error('[Migration] Error:', err.message);
    process.exit(1);
});
