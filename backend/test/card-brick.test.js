import test from 'node:test';
import assert from 'node:assert/strict';
import { mountCardBrick, loadMercadoPagoSdk, safeChallengeUrl, classifyCardBrickError } from '../../src/lib/cardBrick.js';
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

for (const [scenario, cause] of [
    ['invalid card number', 'missing_payment_information'],
    ['incomplete card', 'incomplete_fields'],
    ['unsupported BIN', 'no_payment_method_for_provided_bin'],
    ['excluded brand/type', 'payment_method_not_in_allowed_types'],
    ['invalid expiry', 'incomplete_fields'],
    ['invalid CVV', 'incomplete_fields'],
]) test(`${scenario}: SDK validation keeps the controller, container and correction path alive`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let callbacks; let creates = 0; let unmounts = 0; let ready = 0; let submits = 0;
    const issues = [];
    const mounted = mountCardBrick({ publicKey: 'mock', amount: 50, maxInstallments: 6, containerId: 'stable-input-container',
        loadSdk: async () => ({ bricks: () => ({ create: async (_type, id, settings) => {
            assert.equal(id, 'stable-input-container'); creates++; callbacks = settings.callbacks;
            callbacks.onReady(); return { unmount: () => unmounts++ };
        } }) }), onReady: () => ready++, onError: assert.fail, onIssue: issue => issues.push(issue),
        onSubmit: async () => submits++ });
    await mounted.started;
    for (let input = 0; input < 3; input++) callbacks.onError({ type: 'non_critical', cause, message: 'Synthetic invalid field' });
    callbacks.onReady(); // A repeated ready event cannot reset React or its form.
    t.mock.timers.tick(60000);
    assert.equal(creates, 1); assert.equal(unmounts, 0); assert.equal(ready, 1);
    assert.ok(issues.every(issue => issue.category === 'validation' && issue.critical === false));
    await callbacks.onSubmit({ token: 'mock-corrected-card' }, { paymentTypeId: 'credit_card' });
    assert.equal(submits, 1); mounted.dispose(); assert.equal(unmounts, 1);
});

test('tokenization and communication errors are recoverable without remounting secure fields', async () => {
    let callbacks; let unmounts = 0; const categories = [];
    const mounted = mountCardBrick({ amount: 50, containerId: 'stable', onReady: () => {}, onError: assert.fail,
        onIssue: issue => categories.push(issue.category), onSubmit: async () => {},
        loadSdk: async () => ({ bricks: () => ({ create: async (_type, _id, settings) => {
            callbacks = settings.callbacks; callbacks.onReady(); return { unmount: () => unmounts++ };
        } }) }) });
    await mounted.started;
    for (const cause of ['card_token_creation_failed', 'secure_fields_card_token_creation_failed',
        'get_card_bin_payment_methods_failed', 'get_payment_installments_failed']) callbacks.onError({ type: 'non_critical', cause });
    assert.deepEqual(categories, ['tokenization', 'tokenization', 'communication', 'communication']);
    assert.equal(unmounts, 0); mounted.dispose();
});

for (const cause of ['incorrect_initialization', 'container_not_found', 'fields_setup_failed', 'fields_setup_failed_after_3_tries']) {
    test(`critical ${cause} closes only the broken form and prevents submission`, async () => {
        let callbacks; let unmounts = 0; let errors = 0; let submits = 0;
        const mounted = mountCardBrick({ amount: 50, containerId: 'broken', onReady: () => {}, onError: () => errors++,
            onSubmit: async () => submits++, loadSdk: async () => ({ bricks: () => ({ create: async (_type, _id, settings) => {
                callbacks = settings.callbacks; callbacks.onReady(); return { unmount: () => unmounts++ };
            } }) }) });
        await mounted.started; callbacks.onError({ type: 'critical', cause });
        assert.equal(errors, 1); assert.equal(unmounts, 1);
        await assert.rejects(callbacks.onSubmit({}, {}), /encerrado/); assert.equal(submits, 0);
    });
}

test('pre-ready communication error fails promptly and leaves a safe retry path', async () => {
    let callbacks; let errors = 0; let ready = 0; let unmounts = 0; const diagnostics = [];
    const mounted = mountCardBrick({ amount: 50, containerId: 'not-ready', onReady: () => ready++, onError: () => errors++,
        onDiagnostic: issue => diagnostics.push(issue),
        onSubmit: async () => {}, loadSdk: async () => ({ bricks: () => ({ create: async (_type, _id, settings) => {
            callbacks = settings.callbacks; return { unmount: () => unmounts++ };
        } }) }) });
    await mounted.started; callbacks.onError({ type: 'non_critical', cause: 'get_payment_methods_failed' });
    assert.equal(ready, 0); assert.equal(errors, 1); assert.equal(unmounts, 1);
    assert.deepEqual(diagnostics, [{ category: 'communication', cause: 'get_payment_methods_failed', critical: false }]);
    callbacks.onReady(); assert.equal(ready, 0);
});

for (const isDebit of [false, true]) test(`${isDebit ? 'debit' : 'credit'} SDK failure can retry without submitting payment`, async () => {
    let loads = 0; let ready = 0; let submits = 0; const errors = [];
    const loadSdk = async () => {
        if (++loads === 1) throw new Error('synthetic CDN failure with private details');
        return { bricks: () => ({ create: async (_type, _id, settings) => {
            settings.callbacks.onReady(); return { unmount: () => {} };
        } }) };
    };
    const options = { publicKey: 'mock-public', amount: 16.15, maxInstallments: 1, isDebit,
        onReady: () => ready++, onError: message => errors.push(message), onSubmit: async () => submits++, loadSdk };
    const first = mountCardBrick({ ...options, containerId: 'first' }); await first.started;
    assert.equal(ready, 0); assert.equal(errors.length, 1);
    assert.equal(errors[0].includes('private details'), false);
    first.dispose();
    const retried = mountCardBrick({ ...options, containerId: 'retry' }); await retried.started;
    assert.equal(ready, 1); assert.equal(submits, 0); retried.dispose();
});

test('error classification never retains PAN, CVV, SDK message or raw provider data', () => {
    const event = { type: 'non_critical', cause: 'missing_payment_information', message: 'synthetic PAN and CVV', raw: { token: 'mock-private' } };
    assert.deepEqual(classifyCardBrickError(event), { category: 'validation', cause: 'missing_payment_information', critical: false });
    assert.deepEqual(classifyCardBrickError({ type: 'non_critical', cause: 'syntheticsecrettoken' }),
        { category: 'recoverable', cause: null, critical: false });
    assert.equal(classifyCardBrickError({ type: 'critical', cause: 'new_fatal_sdk_error' }).critical, true);
    assert.equal(classifyCardBrickError({ type: 'non_critical', cause: 'new_sdk_error' }).critical, false);
});
