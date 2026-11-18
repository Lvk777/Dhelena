import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import catalogRouter from '../src/routes/catalog.js';

const id = '11111111-1111-4111-8111-111111111111';

async function requestDelete(user) {
    const app = express();
    if (user) app.use((req, _res, next) => { req.user = user; next(); });
    app.use('/api', catalogRouter);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
        return await fetch(`http://127.0.0.1:${server.address().port}/api/products/${id}`, { method: 'DELETE' });
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
}

test('permanent product deletion requires an authenticated administrator', async () => {
    assert.equal((await requestDelete()).status, 401);
    assert.equal((await requestDelete({ id: 'customer', role: 'customer' })).status, 403);
});
