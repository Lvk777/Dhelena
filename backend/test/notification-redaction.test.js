import test from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/config/db.js';
import { sendOrderNotifications } from '../src/services.js';

test('communication disabled is inert; queue failures never log recipients, tokens or raw errors', async () => {
    const query=pool.query,logger=console.error,flag=process.env.TRANSACTIONAL_EMAIL_ENABLED;
    const records=[];let called=false;
    console.error=(...args)=>records.push(args.join(' '));
    pool.query=async()=>{called=true;throw new Error('payer@example.invalid Bearer fixture-secret');};
    try {
        process.env.TRANSACTIONAL_EMAIL_ENABLED='false';
        await sendOrderNotifications('fixture-order','payment_approved');
        assert.equal(called,false);
        process.env.TRANSACTIONAL_EMAIL_ENABLED='true';
        await sendOrderNotifications('fixture-order','payment_approved');
        assert.ok(records.some(r=>JSON.parse(r).event==='notifications_dispatch_failed'));
        assert.equal(/payer@|fixture-secret|Bearer/.test(records.join(' ')),false);
    }finally{pool.query=query;console.error=logger;if(flag===undefined)delete process.env.TRANSACTIONAL_EMAIL_ENABLED;else process.env.TRANSACTIONAL_EMAIL_ENABLED=flag;}
});
