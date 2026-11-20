// Creates and removes only randomly named disposable localhost databases.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const adminUrl = new URL(process.env.POSTGRES_ADMIN_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(adminUrl.hostname));
assert.equal(adminUrl.pathname, '/postgres');
const admin = new pg.Client({ connectionString: adminUrl.href });
await admin.connect();

try {
    for (const script of ['migration018Compatibility.mjs', 'orderReservationLifecycle.mjs']) {
        const databaseName = `dhelenas_audit_reservation_${randomBytes(8).toString('hex')}`;
        const testUrl = new URL(adminUrl.href);
        testUrl.pathname = `/${databaseName}`;
        await admin.query(`CREATE DATABASE ${databaseName}`);
        try {
            const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], {
                env: { ...process.env, TEST_DATABASE_URL: testUrl.href },
                stdio: 'inherit',
            });
            if (result.error) throw result.error;
            assert.equal(result.status, 0, `${script} failed`);
        } finally {
            await admin.query(`DROP DATABASE ${databaseName} WITH (FORCE)`);
        }
    }
} finally {
    await admin.end();
}
