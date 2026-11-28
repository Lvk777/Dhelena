import fs from 'node:fs/promises';
import pg from 'pg';
import { databaseConnectionOptions } from '../src/config/databaseSsl.js';

if (process.env.APPLY_FISCAL_MIGRATION !== '1' || !process.env.DATABASE_URL) {
    throw new Error('Set APPLY_FISCAL_MIGRATION=1 and DATABASE_URL to apply only fiscal migration 022.');
}
const client = new pg.Client(databaseConnectionOptions(process.env.DATABASE_URL, { production: true }));
await client.connect();
try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['fiscal-documents-migration-022']);
    const existing = await client.query("SELECT to_regclass('public.orders') AS orders, to_regclass('public.profiles') AS profiles");
    if (!existing.rows[0]?.orders || !existing.rows[0]?.profiles) throw new Error('Required production schema is missing.');
    await client.query(await fs.readFile(new URL('../migrations/022_fiscal_documents.sql', import.meta.url), 'utf8'));
    await client.query('COMMIT');
    console.log('Fiscal migration 022 applied. No order, payment or stock rows were changed.');
} catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
} finally { await client.end(); }
