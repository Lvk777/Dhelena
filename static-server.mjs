import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const types = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.xml': 'application/xml; charset=utf-8',
};

export function createStaticHandler(root = defaultRoot) {
    const rootPath = path.resolve(root);
    return async (request, response) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' }).end();
            return;
        }

        let pathname;
        try {
            pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        } catch {
            response.writeHead(400, { 'Cache-Control': 'no-store' }).end();
            return;
        }
        if (pathname.includes('\0') || pathname.split('/').some(part => part.startsWith('.'))) {
            response.writeHead(404, { 'Cache-Control': 'no-store' }).end();
            return;
        }

        if (pathname === '/health') {
            response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
            response.end(request.method === 'HEAD' ? undefined : 'ok');
            return;
        }

        const requested = path.resolve(rootPath, '.' + pathname);
        if (requested !== rootPath && !requested.startsWith(rootPath + path.sep)) {
            response.writeHead(404, { 'Cache-Control': 'no-store' }).end();
            return;
        }

        let file = requested;
        let info;
        try {
            info = await stat(file);
            if (!info.isFile()) info = null;
        } catch {
            info = null;
        }

        // Only browser navigation may fall back to the SPA. Missing chunks,
        // images, and other files must never be served as cached HTML.
        if (!info) {
            const navigation = pathname === '/' || request.headers.accept?.includes('text/html');
            if (pathname === '/assets' || pathname.startsWith('/assets/') || pathname === '/api'
                || pathname.startsWith('/api/') || path.posix.extname(pathname) || !navigation) {
                response.writeHead(404, { 'Cache-Control': 'no-store' }).end();
                return;
            }
            file = path.join(rootPath, 'index.html');
            try { info = await stat(file); } catch { info = null; }
            if (!info?.isFile()) {
                response.writeHead(503, { 'Cache-Control': 'no-store' }).end();
                return;
            }
        }

        const extension = path.extname(file).toLowerCase();
        const hashedAsset = pathname.startsWith('/assets/') && /-[A-Za-z0-9_-]{8,}\.[^/]+$/.test(pathname);
        const cacheControl = extension === '.html' ? 'no-store'
            : hashedAsset ? 'public, max-age=31536000, immutable'
                : 'public, max-age=3600';
        response.writeHead(200, {
            'Content-Type': types[extension] || 'application/octet-stream',
            'Content-Length': info.size,
            'Cache-Control': cacheControl,
            'X-Content-Type-Options': 'nosniff',
        });
        if (request.method === 'HEAD') response.end();
        else createReadStream(file).pipe(response);
    };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const port = Number(process.env.PORT || 3000);
    createServer(createStaticHandler()).listen(port, '0.0.0.0');
}
