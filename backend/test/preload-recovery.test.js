import test from 'node:test';
import assert from 'node:assert/strict';
import { installPreloadRecovery } from '../../src/lib/preloadRecovery.js';

test('stale chunks reload once per build and never loop on a persistent outage', () => {
    const target = new EventTarget();
    const saved = new Map();
    const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
    let reloads = 0;
    installPreloadRecovery(target, storage, 'build-1', () => { reloads++; });
    const first = new Event('vite:preloadError', { cancelable: true });
    target.dispatchEvent(first);
    assert.equal(first.defaultPrevented, true);
    assert.equal(reloads, 1);
    target.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    assert.equal(reloads, 1);
    const nextPage = new EventTarget();
    installPreloadRecovery(nextPage, storage, 'build-2', () => { reloads++; });
    nextPage.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    assert.equal(reloads, 2);
});

test('blocked session storage cannot cause repeated reloads', () => {
    const target = new EventTarget();
    const storage = { getItem() { throw new Error('blocked'); } };
    installPreloadRecovery(target, storage, 'build', () => assert.fail('unsafe reload'));
    assert.doesNotThrow(() => target.dispatchEvent(new Event('vite:preloadError')));
    const blockedPage = new EventTarget();
    assert.doesNotThrow(() => installPreloadRecovery(blockedPage, () => { throw new Error('blocked getter'); },
        'build', () => assert.fail('unsafe reload')));
    assert.doesNotThrow(() => blockedPage.dispatchEvent(new Event('vite:preloadError')));
});
