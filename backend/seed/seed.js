import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { pool } from '../src/config/db.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runSeed() {
    // Try multiple paths for seed data
    const possiblePaths = [
        '/app/frontend-data/initialData.json',  // Docker mount
        path.join(__dirname, '..', 'src', 'data', 'initialData.json'),  // Backend local
        path.join(__dirname, 'initialData.json'),  // Seed dir
        '/repo-root/src/data/initialData.json',  // Alternate mount
    ];
    let data;
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            data = JSON.parse(fs.readFileSync(p, 'utf8'));
            console.log(`[Seed] Loading from ${p}`);
            break;
        }
    }
    if (!data) throw new Error('initialData.json not found');

    // 1. Admin user
    const hash = await bcrypt.hash('admin123', 10);
    await pool.query(
        `INSERT INTO users (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET role = $4, password_hash = $2`,
        ['admin@dhelenas.com', hash, 'Administrador', 'admin']
    );
    console.log('[Seed] Admin user: admin@dhelenas.com / admin123');

    // 2. Categories
    for (const c of data.Category) {
        await pool.query(
            'INSERT INTO categories (name, slug, image, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING',
            [c.name, c.slug, c.image, c.sort_order]
        );
    }
    console.log(`[Seed] ${data.Category.length} categories`);

    // 3. Collections
    for (const c of data.Collection) {
        await pool.query(
            'INSERT INTO collections (name, slug, description, image, sort_order) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (slug) DO NOTHING',
            [c.name, c.slug, c.description, c.image, c.sort_order]
        );
    }
    console.log(`[Seed] ${data.Collection.length} collections`);

    // 4. Products
    for (const p of data.Product) {
        await pool.query(
            `INSERT INTO products (name, sku, category, collection, description, short_description, details,
                price, sale_price, cost_price, installments, images, colors, sizes, badges,
                composition, modeling, length, lining, transparency, elasticity, care, measurements,
                weight, package_height, package_width, package_length, status, rating, sold_count, created_date, updated_date)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
             ON CONFLICT (sku) DO NOTHING`,
            [
                p.name, p.sku, p.category, p.collection, p.description, p.short_description, p.details,
                p.price, p.sale_price, p.cost_price, p.installments,
                JSON.stringify(p.images || []), JSON.stringify(p.colors || []), JSON.stringify(p.sizes || []),
                JSON.stringify(p.badges || {}), p.composition, p.modeling, p.length, p.lining,
                p.transparency, p.elasticity, p.care, p.measurements, p.weight,
                p.package_height, p.package_width, p.package_length,
                p.status || 'published', p.rating || 5, p.sold_count || 0,
                p.created_date || new Date().toISOString(), p.updated_date || new Date().toISOString()
            ]
        );
    }
    console.log(`[Seed] ${data.Product.length} products`);

    // 5. Banners
    for (const b of data.Banner) {
        await pool.query(
            `INSERT INTO banners (title, subtitle, text, eyebrow, image, link, primary_cta_label, primary_cta_link,
                secondary_cta_label, secondary_cta_link, position, sort_order, active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [b.title, b.subtitle, b.text, b.eyebrow, b.image, b.link, b.primary_cta_label, b.primary_cta_link,
             b.secondary_cta_label, b.secondary_cta_link, b.position, b.sort_order, b.active]
        );
    }
    console.log(`[Seed] ${data.Banner.length} banners`);

    // 6. Settings
    for (const s of data.Setting) {
        await pool.query(
            'INSERT INTO settings (key, value, is_public) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = $2, is_public = $3',
            [s.key, JSON.stringify(s.value), s.is_public]
        );
    }
    console.log(`[Seed] ${data.Setting.length} settings`);

    // 7. Default notification settings
    await pool.query(
        `INSERT INTO settings (key, value, is_public)
         VALUES ('notifications', '{"email_enabled": true, "whatsapp_enabled": true, "recipients": [{"name": "Juliane", "email": "", "whatsapp": "", "active": true}, {"name": "Lucilene", "email": "", "whatsapp": "", "active": true}]}', false)
         ON CONFLICT (key) DO NOTHING`
    );
    console.log('[Seed] Default notification settings');
    console.log('[Seed] Complete!');
}

// Auto-run when called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runSeed().then(() => pool.end()).catch(err => {
        console.error('[Seed] Error:', err.message);
        process.exit(1);
    });
}
