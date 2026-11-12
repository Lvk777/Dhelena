import test from 'node:test';
import assert from 'node:assert/strict';
import { requestPasswordRecovery, RECOVERY_ACCEPTED_MESSAGE, RECOVERY_UNAVAILABLE_MESSAGE } from '../../src/lib/passwordRecovery.js';

test('recovery accepts the provider request without claiming delivery or account existence', async () => {
    const requests = [];
    for (const email of ['existing@example.invalid', 'unknown@example.invalid']) {
        const result = await requestPasswordRecovery(email, async value => { requests.push(value); return {}; });
        assert.deepEqual(result, { accepted: true, message: RECOVERY_ACCEPTED_MESSAGE });
    }
    assert.equal(requests.length, 2);
    assert.equal(/enviamos|em instantes/i.test(RECOVERY_ACCEPTED_MESSAGE), false);
});

test('delivery failures, unauthorized SMTP and rate limits never become a sent state', async () => {
    for (const status of [400, 429, 500]) {
        const result = await requestPasswordRecovery('synthetic@example.invalid', async () => {
            throw Object.assign(new Error('private provider payload'), { status });
        });
        assert.deepEqual(result, { accepted: false, message: RECOVERY_UNAVAILABLE_MESSAGE });
        assert.equal(result.message.includes('private'), false);
    }
});

test('network outage is retryable and the next successful request is accepted', async () => {
    const failed = await requestPasswordRecovery('synthetic@example.invalid', async () => { throw new TypeError('fetch failed'); });
    assert.equal(failed.accepted, false);
    const retried = await requestPasswordRecovery('synthetic@example.invalid', async () => ({}));
    assert.equal(retried.accepted, true);
});

test('untrusted error getters and customer information are never read into recovery messages', async () => {
    const result = await requestPasswordRecovery('synthetic@example.invalid', async () => {
        throw { get message() { throw new Error('must not read'); } };
    });
    assert.deepEqual(result, { accepted: false, message: RECOVERY_UNAVAILABLE_MESSAGE });
});
