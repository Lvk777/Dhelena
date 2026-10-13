import test from 'node:test';
import assert from 'node:assert/strict';
import { mountCardBrick, loadMercadoPagoSdk, safeChallengeUrl } from '../../src/lib/cardBrick.js';
import { safeChallengeUrl as backendChallenge } from '../src/lib/paymentChallenge.js';

test('correct cardPayment Brick mounts for credit and debit with distinct restrictions and unique containers', async () => {
    const created = []; let ready = 0; let unmounted = 0; let submissions = 0;
    const loadSdk = async () => ({ bricks: () => ({ create: async (type, id, settings) => {
        created.push({ type, id, settings }); settings.callbacks.onReady();
        await settings.callbacks.onSubmit({ token: 'mock-token' }, { paymentTypeId: 'credit_card' });
        return { unmount: () => { unmounted++; } };
    } }) });
    for (const isDebit of [false, true]) {
        const mounted = mountCardBrick({ publicKey: 'mock-public', amount: 120.50, isDebit, maxInstallments: 6,
            containerId: isDebit ? 'debit-unique' : 'credit-unique', loadSdk,
            onReady: () => ready++, onError: assert.fail, onSubmit: async () => submissions++ });
        await mounted.started; mounted.dispose();
    }
    assert.equal(ready, 2); assert.equal(unmounted, 2); assert.equal(submissions, 2);
    assert.equal(created[0].type, 'cardPayment'); assert.equal(created[1].type, 'cardPayment');
    assert.deepEqual(created[0].settings.customization.paymentMethods.types.excluded, ['debit_card', 'prepaid_card']);
    assert.deepEqual(created[1].settings.customization.paymentMethods.types.excluded, ['credit_card', 'prepaid_card']);
    assert.equal(created[0].settings.customization.paymentMethods.maxInstallments, 6);
    assert.equal(created[1].settings.customization.paymentMethods.maxInstallments, 1);
});

test('hung creation ends loading and late controllers unmount instead of reviving an old form', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let resolveController; let errors = 0; let unmounted = 0; let ready = 0;
    const mounted = mountCardBrick({ publicKey: 'mock', amount: 20, maxInstallments: 1, containerId: 'mock',
        loadSdk: async () => ({ bricks: () => ({ create: () => new Promise(resolve => { resolveController = resolve; }) }) }),
        onReady: () => ready++, onError: () => errors++, onSubmit: async () => {} });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    t.mock.timers.tick(20001); assert.equal(errors, 1);
    resolveController({ unmount: () => unmounted++ }); await mounted.started;
    assert.equal(unmounted, 1); assert.equal(ready, 0);
});

test('SDK failure and navigation cleanup settle without an endless spinner or stale mount', async () => {
    let errors = 0; let creates = 0; let resolveSdk;
    const failed = mountCardBrick({ amount: 20, containerId: 'bad', loadSdk: async () => { throw new Error('blocked CDN'); },
        onError: () => errors++, onReady: assert.fail, onSubmit: async () => {} });
    await failed.started; assert.equal(errors, 1);
    const abandoned = mountCardBrick({ amount: 20, containerId: 'old', loadSdk: () => new Promise(resolve => { resolveSdk = resolve; }),
        onError: assert.fail, onReady: assert.fail, onSubmit: async () => {} });
    await Promise.resolve(); abandoned.dispose();
    resolveSdk({ bricks: () => ({ create: () => { creates++; } }) }); await abandoned.started;
    assert.equal(creates, 0);
});

test('SDK script timeout can be retried and concurrent forms share one script', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const scripts = []; let removed = 0;
    const win = {}; const doc = { createElement: () => ({ remove: () => removed++ }), head: { appendChild: script => scripts.push(script) } };
    const first = loadMercadoPagoSdk('mock-public', win, doc);
    const rejected = assert.rejects(first, /demorou/);
    t.mock.timers.tick(12001); await rejected; assert.equal(removed, 1);
    const retry = loadMercadoPagoSdk('mock-public', win, doc);
    const concurrent = loadMercadoPagoSdk('another-public', win, doc);
    assert.equal(scripts.length, 2);
    win.MercadoPago = class { constructor(key) { this.key = key; } };
    scripts[1].onload();
    assert.equal((await retry).key, 'mock-public'); assert.equal((await concurrent).key, 'another-public');
});

test('challenge iframe accepts only the official Brazilian HTTPS authentication path', () => {
    assert.equal(safeChallengeUrl('https://www.mercadopago.com.br/auth/card/validation/pages/mock'), 'https://www.mercadopago.com.br/auth/card/validation/pages/mock');
    for (const url of ['javascript:alert(1)', 'http://www.mercadopago.com.br/auth/card/validation/x',
        'https://www.mercadopago.com.br.evil.invalid/auth/card/validation/x', 'https://evil.invalid/x',
        'https://user@www.mercadopago.com.br/auth/card/validation/x', 'https://www.mercadopago.com.br:444/auth/card/validation/x',
        'https://www.mercadopago.com.br/other']) {
        assert.equal(safeChallengeUrl(url), null);
        assert.equal(backendChallenge(url), safeChallengeUrl(url));
    }
    const official = 'https://www.mercadopago.com.br/auth/card/validation/pages/mock';
    assert.equal(backendChallenge(official), safeChallengeUrl(official));
});
