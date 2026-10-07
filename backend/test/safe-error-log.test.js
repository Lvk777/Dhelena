import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync } from 'node:fs';
import { safeErrorMetadata, logSafeError } from '../src/lib/safeErrorLog.js';
import { errorHandler } from '../src/middleware.js';

test('error logging retains only useful bounded technical metadata', () => {
    const error = Object.assign(new SyntaxError('payer@example.invalid Bearer fixture-token'), {
        status: 400, code: '22P02', detail: 'fixture-cpf', stack: 'private stack',
        request: { headers: { Authorization: 'Bearer fixture-token' } },
    });
    assert.deepEqual(safeErrorMetadata(error), { error_type: 'DatabaseError', error_code: '22P02', http_status: 400 });
    assert.deepEqual(safeErrorMetadata({ name: 'TypeError', cause: { code: 'ECONNRESET', message: 'private' } }),
        { error_type: 'TypeError', error_code: 'ECONNRESET', http_status: 500 });
});

test('untrusted error codes, names and hostile getters never become log data', () => {
    for (const error of [null, 'fixture-token', { name: 'payer@example.invalid', code: 'fixture-token', status: '400' },
        { get code() { throw new Error('private getter'); } }, { cause: { get code() { throw new Error('private cause'); } } }]) {
        assert.doesNotThrow(() => safeErrorMetadata(error));
        assert.deepEqual(safeErrorMetadata(error), { error_type: 'Error', error_code: null, http_status: 500 });
    }
    let reads = 0;
    const error = { get name() { return ++reads === 1 ? 'Error' : 'fixture-token'; } };
    assert.equal(safeErrorMetadata(error).error_type, 'Error');
    assert.equal(reads, 1);
});

test('invalid JSON containing sensitive input does not leak through the global API logger', async () => {
    const saved = console.error;
    const records = [];
    console.error = value => records.push(value);
    const app = express();
    app.use(express.json());
    app.post('/fixture', (req, res) => res.json({ ok: true }));
    app.use(errorHandler);
    const server = app.listen(0, '127.0.0.1');
    try {
        await new Promise(resolve => server.once('listening', resolve));
        const response = await fetch(`http://127.0.0.1:${server.address().port}/fixture`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: '{"email":"payer@example.invalid","cpf":"fixture-cpf","token":"fixture-token",}',
        });
        assert.equal(response.status, 400);
        const log = JSON.parse(records[0]);
        assert.deepEqual(log, { event: 'api_request_failed', error_type: 'SyntaxError', error_code: null, http_status: 400 });
        assert.ok(!records.join('').includes('payer@example.invalid'));
        assert.ok(!records.join('').includes('fixture-token'));
        assert.ok(!records.join('').includes('fixture-cpf'));
    } finally {
        console.error = saved;
        await new Promise(resolve => server.close(resolve));
    }
});

test('warning logger uses the same whitelist, without serializing error bodies', () => {
    const saved = console.warn;
    const records = [];
    console.warn = value => records.push(value);
    try {
        logSafeError('me_tracking_fetch_failed', { statusCode: 503, message: 'private', body: 'private' }, 'warn');
        assert.deepEqual(JSON.parse(records[0]), {
            event: 'me_tracking_fetch_failed', error_type: 'Error', error_code: null, http_status: 503,
        });
    } finally { console.warn = saved; }
});

test('reviewed runtime modules cannot regress to logging raw error messages', () => {
    for (const file of ['middleware.js', 'middleware/securityLog.js', 'index.js', 'routes/security.js',
        'routes/orders.js', 'routes/upload.js', 'routes/webhooks.js']) {
        const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
        assert.doesNotMatch(source, /console\.(?:error|warn|log)\([^\n]*\b(?:err|error|e|uploadError)\.message/);
    }
    const webhook = readFileSync(new URL('../src/routes/webhooks.js', import.meta.url), 'utf8');
    assert.doesNotMatch(webhook, /console\.(?:warn|log)\([^\n]*\$\{(?:status|shipmentId)\}/);
});
