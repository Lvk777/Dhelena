import { Router } from 'express';
import { pool } from '../config/db.js';

const router = Router();

// GET /api/sitemap.xml — dynamic sitemap with products and collections
router.get('/sitemap.xml', async (req, res, next) => {
    try {
        const origin = `${req.protocol}://${req.get('host')}`;

        // Static pages
        const staticUrls = [
            { loc: '/', priority: '1.0', changefreq: 'daily' },
            { loc: '/loja', priority: '0.9', changefreq: 'daily' },
            { loc: '/colecoes', priority: '0.8', changefreq: 'weekly' },
            { loc: '/monte-seu-look', priority: '0.7', changefreq: 'weekly' },
            { loc: '/sobre', priority: '0.5', changefreq: 'monthly' },
            { loc: '/contato', priority: '0.5', changefreq: 'monthly' },
        ];

        // Active products
        const { rows: products } = await pool.query(
            "SELECT id, name, updated_at FROM products WHERE status = 'published' ORDER BY updated_at DESC"
        );

        // All collections (no status column on this table)
        const { rows: collections } = await pool.query(
            "SELECT id, name, slug, updated_at FROM collections ORDER BY updated_at DESC"
        );

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

        for (const u of staticUrls) {
            xml += `  <url><loc>${origin}${u.loc}</loc><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>\n`;
        }

        for (const p of products) {
            xml += `  <url><loc>${origin}/produto/${p.id}</loc><changefreq>weekly</changefreq><priority>0.6</priority></url>\n`;
        }

        for (const c of collections) {
            xml += `  <url><loc>${origin}/colecoes#${encodeURIComponent(c.name)}</loc><changefreq>weekly</changefreq><priority>0.6</priority></url>\n`;
        }

        xml += '</urlset>';

        res.set('Content-Type', 'application/xml');
        res.send(xml);
    } catch (err) {
        next(err);
    }
});

export default router;
