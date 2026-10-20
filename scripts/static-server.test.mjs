import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createStaticHandler } from '../static-server.mjs';

test('SPA routes work while missing assets fail and HTML cannot stay cached', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dhelenas-static-'));
    const server = createServer(createStaticHandler(root));
    try {
        await mkdir(path.join(root, 'assets'));
        await writeFile(path.join(root, 'index.html'), '<!doctype html><title>test</title>');
        await writeFile(path.join(root, 'assets', 'index-Abc12345.js'), 'export default 1;');
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${server.address().port}`;

        const page = await fetch(base + '/colecao', { headers: { Accept: 'text/html' } });
        assert.equal(page.status, 200);
        assert.match(page.headers.get('content-type'), /^text\/html/);
        assert.equal(page.headers.get('cache-control'), 'no-store');

        const home = await fetch(base + '/');
        assert.equal(home.status, 200);
        assert.equal(home.headers.get('cache-control'), 'no-store');

        const asset = await fetch(base + '/assets/index-Abc12345.js');
        assert.equal(asset.status, 200);
        assert.match(asset.headers.get('content-type'), /^text\/javascript/);
        assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');

        const missing = await fetch(base + '/assets/removed-Abc12345.js', { headers: { Accept: 'text/html' } });
        assert.equal(missing.status, 404);
        assert.equal(missing.headers.get('cache-control'), 'no-store');
        assert.doesNotMatch(await missing.text(), /doctype html/i);

        const health = await fetch(base + '/health');
        assert.equal(health.status, 200);
        assert.equal(await health.text(), 'ok');
    } finally {
        await new Promise(resolve => server.close(resolve));
        await rm(root, { recursive: true, force: true });
    }
});
