// Empty synthetic LOCAL database only. Never imports production environment files.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import pg from 'pg';

const directory = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(directory, '../..');
const url = new URL(process.env.TEST_DATABASE_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
assert.match(url.pathname, /^\/dhelenas_audit_security_[a-z0-9_]+$/);
const env = { ...process.env, DATABASE_URL: url.href, TEST_DATABASE_URL: url.href, NODE_ENV: 'test',
    JWT_SECRET: 'isolated-synthetic-test-only',
    UPLOAD_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dhelenas-synthetic-')) };
for (const key of Object.keys(env)) {
    if (/^(SUPABASE|MERCADO_PAGO|MELHOR_ENVIO|RESEND|WHATSAPP|AFTER_SALES)/.test(key)) delete env[key];
}
const client = new pg.Client({ connectionString: url.href });
await client.connect();
async function run(file) {
    const child = spawn(process.execPath, [path.join(backend, file)], { env, stdio: 'inherit' });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    assert.equal(code, 0, file);
}
const sql = file => client.query(fs.readFileSync(path.join(directory, file), 'utf8'));
let server;
try {
    const existing = await client.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'");
    assert.equal(existing.rows[0].n, 0, 'Refusing a nonempty database; create a new isolated database');
    const fixture = spawnSync(process.env.PYTHON || 'python', [path.join(directory, 'build_local_fixture.py')], { encoding: 'utf8' });
    assert.equal(fixture.status, 0, 'fixture generator failed');
    await client.query(fixture.stdout);
    const fingerprint = (await sql('2026-10-12_schema_fingerprint.sql')).rows[0];
    assert.equal(fingerprint.columns_md5, '92e13b0f0ee075b1ade55fe05da60ce2', '400 production column definitions must match');
    assert.equal(fingerprint.constraints_md5, 'ebf2a217ce0c61f04bc60b3e39df8350', '94 production constraints must match');
    await sql('synthetic_staging_data.sql');
    await sql('2026-10-11_01_revoke_direct_access.sql');
    await sql('2026-10-11_02_enable_rls.sql');
    await run('supabase/security/verify_local_postgres.mjs');
    await sql('2026-10-11_03_safe_rls_recovery.sql');
    await sql('2026-10-11_02_enable_rls.sql');
    await run('supabase/security/verify_local_postgres.mjs');
    console.log('PASS: recovery retains revoked grants; RLS reapplied');

    const portProbe = net.createServer();
    await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
    env.PORT = String(portProbe.address().port);
    await new Promise(resolve => portProbe.close(resolve));
    server = spawn(process.execPath, [path.join(backend, 'src/index.js')], { env, stdio: 'inherit' });
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt++) {
        assert.equal(server.exitCode, null, 'isolated backend exited before health check');
        try { ready = (await fetch(`http://127.0.0.1:${env.PORT}/health`)).ok; } catch { /* starting */ }
        if (ready) break;
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(ready, 'isolated backend failed to start');
    await run('supabase/security/verify_local_backend.mjs');
    server.kill();
    await new Promise(resolve => server.once('exit', resolve));
    server = null;
    for (const file of ['postgresConcurrency.mjs', 'couponConcurrency.mjs', 'supabaseProfiles.mjs']) {
        await run('integration/' + file);
    }
    await run('integration/categoryMigration.mjs');
    const result = await sql('2026-10-11_public_rls_postcheck.sql');
    console.log('POSTCHECK', JSON.stringify(result.rows));
    console.log('PASS: local rehearsal complete; hosted Supabase and real backup still require separate validation');
} finally {
    if (server) server.kill();
    await client.end();
}
