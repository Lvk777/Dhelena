import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseConnectionOptions } from '../src/config/databaseSsl.js';

const local = 'postgresql://user:pass@localhost:5432/dhelenas';
const remote = 'postgresql://user:pass@aws-0-sa-east-1.pooler.supabase.com:6543/postgres';

test('local development preserves an unencrypted Docker database connection', () => {
    assert.deepEqual(databaseConnectionOptions(local), { connectionString: local, ssl: false });
});

test('Supabase and production force TLS with hostname and certificate validation', () => {
    for (const [url, opts] of [[remote, {}], [local, { production: true }]]) {
        const actual = databaseConnectionOptions(url, opts);
        assert.equal(new URL(actual.connectionString).searchParams.has('sslmode'), false);
        assert.deepEqual(actual.ssl, { rejectUnauthorized: true });
    }
});

test('a supplied sslmode=require cannot override the validating TLS option', () => {
    const actual = databaseConnectionOptions(`${remote}?sslmode=require&application_name=dhelenas`);
    const parsed = new URL(actual.connectionString);
    assert.equal(parsed.searchParams.has('sslmode'), false);
    assert.equal(parsed.searchParams.get('application_name'), 'dhelenas');
});

test('Supabase root certificate can be supplied by a private PEM environment variable', () => {
    const actual = databaseConnectionOptions(remote, { caPem: '-----BEGIN CERTIFICATE-----\\nTEST\\n-----END CERTIFICATE-----' });
    assert.equal(actual.ssl.ca, '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----');
    assert.equal(actual.ssl.rejectUnauthorized, true);
});

test('insecure remote sslmode values fail closed', () => {
    for (const mode of ['disable', 'allow', 'prefer', 'no-verify']) {
        assert.throws(() => databaseConnectionOptions(`${remote}?sslmode=${mode}`), /certificado TLS/);
    }
});
