import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperationalRefundService } from '../src/services/operationalRefund.js';
import { assertPilotRefund } from '../src/lib/refundPilotScope.js';

const order = {
    id: '10000000-0000-4000-8000-000000000019',
    order_number: 'DH-2026-000019', status: 'recebido',
    payment_status: 'approved', payment_provider: 'mercado_pago',
    paid_at: new Date('2026-11-19T12:00:00Z'), total: '39.98',
    mercado_pago_order_id: 'ORD-TEST-19', mercado_pago_payment_id: 'PAY-TEST-19',
    snapshot: { payment_context: { version: 1, mode: 'test', credential_id: 'cred',
        application_id: 'app', provider_order_id: 'ORD-TEST-19' } },
};
const context = { mode: 'test', credentialId: 'cred', applicationId: 'app' };
const remote = {
    id: 'ORD-TEST-19', external_reference: 'DH-2026-000019',
    currency: 'BRL', total_amount: 39.98,
    payment: { id: 'PAY-TEST-19', amount: 39.98, status: 'approved' }, refunds: [],
    provider_resource: { user_id: 'seller', resource_type: 'online',
        mp_order_id: 'ORD-TEST-19', application_id: 'app', live_mode: false },
};

function make({ localOrder = order, remoteOrder = remote, enabled = true } = {}) {
    const calls = { reads: 0, refunds: 0, writes: 0 };
    const db = { query: async sql => {
        if (sql.startsWith('SELECT * FROM orders')) return { rows: [localOrder] };
        if (sql.startsWith('SELECT * FROM order_refunds')) return { rows: [] };
        if (sql.startsWith('SELECT * FROM order_items')) return { rows: [] };
        calls.writes++;
        throw new Error('An unexpected write was attempted');
    } };
    const provider = {
        getWebhookCredentialIdentity: async () => ({ mode: 'test', userId: 'seller' }),
        getRefundableOrder: async () => { calls.reads++; return remoteOrder; },
        refundOrder: async () => { calls.refunds++; throw new Error('Financial refund must not happen during tests'); },
    };
    const env = { INTEGRATION_ENCRYPTION_KEY: 'mock-signing-key',
        AFTER_SALES_OPERATIONAL_PILOT_ENABLED: enabled ? 'true' : 'false',
        AFTER_SALES_OPERATIONAL_ORDER_SCOPE: 'DH-2026-000019' };
    const service = createOperationalRefundService({ db,
        transaction: async callback => callback(db), provider,
        contexts: () => [context], env,
        now: () => Date.parse('2026-11-24T12:00:00Z') });
    return { service, calls };
}

test('pilot preview derives R$39,98 from the verified provider without issuing refund', async () => {
    const { service, calls } = make();
    const result = await service.preview(order.id, 'admin',
        { kind: 'full', reason: 'Estorno de homologação', selected_items: [] });
    assert.equal(result.amount_cents, 3998);
    assert.equal(result.enabled, true);
    assert.equal(result.kind, 'full');
    assert.equal(calls.reads, 1);
    assert.equal(calls.refunds, 0);
    assert.equal(calls.writes, 0);
});

test('pilot denies any other order, payment amount or partial refund', async () => {
    const { service, calls } = make({ localOrder: { ...order, order_number: 'DH-2026-000020' } });
    await assert.rejects(service.preview(order.id, 'admin',
        { kind: 'full', reason: 'Estorno de homologação', selected_items: [] }), /não está autorizado/);
    assert.equal(calls.reads, 0);
    assert.throws(() => assertPilotRefund(order, 'partial', 3998,
        { AFTER_SALES_OPERATIONAL_PILOT_ENABLED: 'true', AFTER_SALES_OPERATIONAL_ORDER_SCOPE: 'DH-2026-000019' }), /não está autorizado/);
    const anotherAmount = make({ remoteOrder: { ...remote, total_amount: 39.97 } });
    await assert.rejects(anotherAmount.service.preview(order.id, 'admin',
        { kind: 'full', reason: 'Estorno de homologação', selected_items: [] }), /não correspondem ao pedido/);
});

test('pilot flag blocks financial request and prevents provider calls', async () => {
    const { service, calls } = make({ enabled: false });
    await assert.rejects(service.request(order.id, 'admin',
        { kind: 'full', reason: 'Estorno de homologação', selected_items: [], confirm: true },
        'test-refund-operation-000019'), /desabilitados/);
    assert.deepEqual(calls, { reads: 0, refunds: 0, writes: 0 });
});

test('syncs an already processed provider refund without issuing another refund or changing stock', async () => {
    let current={...order,payment_status:'approved'};
    const refund={id:'refund-local-19',kind:'full',amount:'39.98',status:'processed',
        provider_refund_id:'RF-19',provider_payment_id:'PAY-TEST-19'};
    let providerRefundCalls=0,stockWrites=0,updated=false;
    const client={query:async(sql)=>{
        if(sql.startsWith('SELECT * FROM orders'))return {rows:[current]};
        if(sql.startsWith('SELECT * FROM order_refunds'))return {rows:[refund]};
        if(sql.startsWith('SELECT * FROM order_items'))return {rows:[]};
        if(sql.startsWith('UPDATE orders SET payment_status')){current={...current,payment_status:'refunded'};updated=true;return {rows:[]};}
        if(sql.startsWith('INSERT INTO audit_logs'))return {rows:[]};
        stockWrites++;throw new Error('Unexpected mutation');
    }};
    const provider={
        getWebhookCredentialIdentity:async()=>({mode:'test',userId:'seller'}),
        getRefundableOrder:async()=>({...remote,refunds:[{id:'RF-19',transaction_id:'PAY-TEST-19',amount:39.98,status:'processed'}]}),
        refundOrder:async()=>{providerRefundCalls++;throw new Error('must never refund');},
    };
    const service=createOperationalRefundService({db:client,transaction:async callback=>callback(client),provider,
        contexts:()=>[context],env:{AFTER_SALES_OPERATIONAL_PILOT_ENABLED:'true',
            AFTER_SALES_OPERATIONAL_ORDER_SCOPE:'DH-2026-000019'}});
    const result=await service.syncRefundedStatus(order.id,'admin');
    assert.deepEqual(result,{payment_status:'refunded',already_synced:false});
    assert.equal(updated,true);assert.equal(providerRefundCalls,0);assert.equal(stockWrites,0);
    const repeated=await service.syncRefundedStatus(order.id,'admin');
    assert.equal(repeated.already_synced,true);
});

test('pilot financial flow confirms, records refund once and never restocks automatically (mock provider)', async () => {
    let local = structuredClone(order);
    let storedRefund = null;
    let refundedRemotely = false;
    let providerPosts = 0;
    let stockWrites = 0;
    const db = { query: async (sql, params = []) => {
        if (sql.startsWith('SELECT * FROM orders')) return { rows: [local] };
        if (sql.startsWith('SELECT * FROM order_refunds WHERE order_id')) return { rows: storedRefund ? [storedRefund] : [] };
        if (sql.startsWith('SELECT * FROM order_items')) return { rows: [] };
        if (sql.startsWith('INSERT INTO order_refunds')) {
            storedRefund = { id: 'refund-local-19', order_id: local.id, idempotency_key: params[1],
                kind: params[2], amount: params[3], status: 'reserved', provider_order_id: params[4],
                provider_payment_id: params[5], reason: params[6], actor_id: params[7],
                selected_items: [], return_id: null };
            return { rows: [storedRefund] };
        }
        if (sql.startsWith('SELECT * FROM order_refunds WHERE id')) return { rows: [storedRefund] };
        if (sql.startsWith('UPDATE order_refunds SET status =')) {
            storedRefund = { ...storedRefund, status: params[0], provider_refund_id: params[1], provider_status: params[2] };
            return { rows: [storedRefund] };
        }
        if (sql.startsWith('SELECT amount FROM order_refunds')) return { rows: [storedRefund] };
        if (sql.startsWith('UPDATE orders SET payment_status')) {
            local = { ...local, payment_status: params[0] };
            return { rows: [] };
        }
        if (sql.startsWith('INSERT INTO order_events') || sql.startsWith('INSERT INTO audit_logs')) return { rows: [] };
        if (/stock|products/i.test(sql)) stockWrites++;
        throw new Error(`Unexpected SQL: ${sql}`);
    } };
    const provider = {
        getWebhookCredentialIdentity: async () => ({ mode: 'test', userId: 'seller' }),
        getRefundableOrder: async () => refundedRemotely ? {
            ...remote, payment: { ...remote.payment, status: 'refunded' },
            refunds: [{ id: 'refund-remote-19', transaction_id: 'PAY-TEST-19', amount: 39.98, status: 'processed' }],
        } : remote,
        refundOrder: async ({ amount, full, mpOrderId }) => {
            providerPosts++;
            assert.equal(amount, 3998);
            assert.equal(full, true);
            assert.equal(mpOrderId, 'ORD-TEST-19');
            refundedRemotely = true;
            return { id: 'ORD-TEST-19' };
        },
    };
    const service = createOperationalRefundService({ db, transaction: callback => callback(db), provider,
        contexts: () => [context], env: { INTEGRATION_ENCRYPTION_KEY: 'mock-signing-key',
            AFTER_SALES_OPERATIONAL_PILOT_ENABLED: 'true',
            AFTER_SALES_OPERATIONAL_ORDER_SCOPE: 'DH-2026-000019' },
        now: () => Date.parse('2026-11-24T12:00:00Z') });
    const request = { kind: 'full', reason: 'Estorno da compra de homologação', selected_items: [] };
    const preview = await service.preview(order.id, 'admin', request);
    const result = await service.request(order.id, 'admin',
        { ...request, confirmation: preview.confirmation, confirm: true }, 'refund-pilot-000019');
    assert.equal(result.status, 'processed');
    assert.equal(local.payment_status, 'refunded');
    assert.equal(providerPosts, 1);
    assert.equal(stockWrites, 0);
    const repeated = await service.request(order.id, 'admin',
        { ...request, confirmation: preview.confirmation, confirm: true }, 'refund-pilot-000019');
    assert.equal(repeated.id, result.id);
    assert.equal(providerPosts, 1);
});
