import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPool } from '../src/config/db.js';

test('idle PostgreSQL client errors are handled without leaking connection details', () => {
    const output = [];
    const original = console.error;
    console.error = value => output.push(value);
    try {
        const connection = createPool({}, EventEmitter);
        const error = Object.assign(new Error('private connection details'), { code: '08006' });
        assert.doesNotThrow(() => connection.emit('error', error));
        assert.deepEqual(JSON.parse(output[0]), {
            event: 'db_idle_client_error', error_type: 'DatabaseError', error_code: '08006', http_status: 500,
        });
        assert.doesNotMatch(output[0], /private connection details/);
    } finally { console.error = original; }
});
