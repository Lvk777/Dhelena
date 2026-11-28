import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { detectRealMime, upload } from '../src/routes/upload.js';

test('Multer 2 accepts a product image in memory and enforces the size limit', async () => {
    const app = express();
    app.post('/upload', upload.single('file'), (req, res) => {
        res.json({ mime: detectRealMime(req.file.buffer), bytes: req.file.size });
    });
    app.use((error, req, res, next) => {
        res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ code: error.code || 'INVALID_FILE' });
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
        const endpoint = `http://127.0.0.1:${server.address().port}/upload`;
        const image = new FormData();
        image.append('file', new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'product.jpg');
        const accepted = await fetch(endpoint, { method: 'POST', body: image });
        assert.equal(accepted.status, 200);
        assert.deepEqual(await accepted.json(), { mime: 'image/jpeg', bytes: 4 });

        const oversized = new FormData();
        oversized.append('file', new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: 'image/png' }), 'large.png');
        const rejected = await fetch(endpoint, { method: 'POST', body: oversized });
        assert.equal(rejected.status, 413);
        assert.deepEqual(await rejected.json(), { code: 'LIMIT_FILE_SIZE' });
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});

test('declared MIME does not bypass content checks', () => {
    assert.equal(detectRealMime(Buffer.from('not-an-image')), null);
    assert.equal(detectRealMime(Buffer.from('RIFF....WRONG')), null);
});
