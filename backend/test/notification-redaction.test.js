import test from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/config/db.js';
import { sendOrderNotifications } from '../src/services.js';

test('notification failures never log recipient or raw error details', async () => {
    const query = pool.query;
    const logger = console.error;
    const token = process.env.RESEND_API_KEY;
    const records = [];
    delete process.env.RESEND_API_KEY;
    console.error = (...args) => records.push(args.join(' '));
    pool.query = async sql => {
        if (sql.includes('FROM orders o JOIN')) return { rows: [{ id: 'fixture-order' }] };
        if (sql.includes('FROM settings')) return { rows: [{ value: { recipients: [
            { active: true, email: 'recipient@example.invalid', events: ['payment_approved'] },
        ] } }] };
        if (sql.includes('SELECT * FROM notification_logs')) return { rows: [] };
        if (sql.includes('INSERT INTO notification_logs')) return { rows: [{ id: 'fixture-log' }] };
        return { rows: [] };
    };
    try {
        await sendOrderNotifications('fixture-order', 'payment_approved');
        assert.ok(records.some(record => record.includes('email delivery failed')));
        pool.query = async () => { throw new Error('payer@example.invalid Bearer fixture-secret'); };
        await sendOrderNotifications('fixture-order', 'payment_approved');
        const output = records.join('\n');
        assert.ok(!output.includes('recipient@example.invalid'));
        assert.ok(!output.includes('payer@example.invalid'));
        assert.ok(!output.includes('fixture-secret'));
        assert.ok(!output.includes('RESEND_API_KEY'));
    } finally {
        pool.query = query;
        console.error = logger;
        if (token === undefined) delete process.env.RESEND_API_KEY;
        else process.env.RESEND_API_KEY = token;
    }
});
