import { Router } from 'express';
import { pool, withTransaction } from '../config/db.js';
import { auth, requireAdmin } from '../middleware.js';
import { logAudit } from '../services.js';
import { searchLimiter } from '../middleware/rateLimiters.js';
import { publicSetting, validateSettingValue } from '../lib/publicSettings.js';
import { safeNavigation } from '../lib/navigation.js';
import { effectiveSizes, stockForSize } from '../lib/variantStock.js';

const router = Router();

export async function withStockSummary(products, db = pool) {
    if (!products.length) return products;
    const { rows } = await db.query(
        `SELECT r.product_id, r.color_id, r.size, r.status,
                SUM(CASE WHEN r.status = 'sold' THEN r.quantity - COALESCE(restored.quantity, 0)
                         ELSE r.quantity END)::integer AS quantity
         FROM stock_reservations r
         LEFT JOIN LATERAL (
             SELECT COALESCE(SUM(quantity), 0)::integer AS quantity
             FROM stock_restorations WHERE order_item_id = r.order_item_id
         ) restored ON true
         WHERE r.product_id = ANY($1::uuid[]) AND r.status IN ('active', 'sold')
         GROUP BY r.product_id, r.color_id, r.size, r.status`,
        [products.map(product => product.id)]);
    const byProduct = new Map();
    for (const row of rows) {
        const summary = byProduct.get(row.product_id) || { reserved: 0, sold: 0, variants: {}, soldVariants: {} };
        const key = `${row.color_id}:${row.size}`;
        if (row.status === 'active') {
            summary.reserved += row.quantity;
            summary.variants[key] = (summary.variants[key] || 0) + row.quantity;
        } else {
            summary.sold += row.quantity;
            summary.soldVariants[key] = (summary.soldVariants[key] || 0) + row.quantity;
        }
        byProduct.set(row.product_id, summary);
    }
    return products.map(product => {
        const summary = byProduct.get(product.id) || { reserved: 0, sold: 0, variants: {}, soldVariants: {} };
        const available = (product.colors || []).reduce((sum, color) =>
            sum + effectiveSizes(product).reduce((value, size) => value + stockForSize(product, color, size), 0), 0);
        return { ...product, stock_summary: {
            on_hand: available + summary.reserved, reserved: summary.reserved, available,
            sold_confirmed_new: summary.sold, reserved_by_variant: summary.variants,
            sold_by_variant: summary.soldVariants,
            legacy_sold_count: product.sold_count,
        } };
    });
}

// Identifiers cannot be bound as SQL parameters. Keep writable columns
// explicit even for admin requests; never interpolate a JSON key directly.
export const CATALOG_WRITE_FIELDS = {
    products: new Set([
        'name', 'sku', 'category', 'subcategory', 'collection', 'description',
        'short_description', 'details', 'price', 'sale_price', 'cost_price',
        'installments', 'images', 'colors', 'sizes', 'badges', 'composition',
        'modeling', 'length', 'lining', 'transparency', 'elasticity', 'care',
        'measurements', 'weight', 'package_height', 'package_width',
        'package_length', 'status', 'size_guide_id', 'custom_measurements',
    ]),
    categories: new Set(['name', 'slug', 'image', 'description', 'status', 'sort_order', 'parent_id']),
    collections: new Set(['name', 'slug', 'description', 'image', 'banner_image', 'status', 'featured', 'start_date', 'end_date', 'sort_order']),
    banners: new Set([
        'title', 'subtitle', 'text', 'eyebrow', 'image', 'link',
        'primary_cta_label', 'primary_cta_link', 'secondary_cta_label',
        'secondary_cta_link', 'position', 'sort_order', 'active',
        'internal_name', 'image_mobile', 'start_date', 'end_date', 'priority',
        'promotion_id', 'display_mode', 'button_text', 'button_link',
        'max_image_size_mb',
    ]),
};

export function catalogWriteKeys(table, data) {
    if (!data || typeof data !== 'object' || Array.isArray(data) || !CATALOG_WRITE_FIELDS[table]) {
        throw Object.assign(new Error('Dados de catálogo inválidos'), { status: 400 });
    }
    const keys = Object.keys(data);
    if (!keys.length || keys.some(key => !CATALOG_WRITE_FIELDS[table].has(key))) {
        throw Object.assign(new Error('Campo de catálogo inválido'), { status: 400 });
    }
    return keys;
}

export function validateProductForPublication(product) {
    if (product.status !== 'published') return;
    if (!Number.isFinite(Number(product.price)) || Number(product.price) <= 0) {
        throw Object.assign(new Error('Preço do produto deve ser maior que zero'), { status: 400 });
    }
    if (product.sale_price != null && product.sale_price !== ''
        && (!Number.isFinite(Number(product.sale_price)) || Number(product.sale_price) <= 0
            || Number(product.sale_price) >= Number(product.price))) {
        throw Object.assign(new Error('Preço promocional deve ser maior que zero e menor que o preço normal'), { status: 400 });
    }
    if (['weight', 'package_height', 'package_width', 'package_length'].some(field =>
        !Number.isFinite(Number(product[field])) || Number(product[field]) <= 0)) {
        throw Object.assign(new Error('Informe peso e dimensões válidos para calcular o frete'), { status: 400 });
    }
    const sizes = product.sizes || [];
    const colors = product.colors || [];
    if (!Array.isArray(sizes) || !sizes.length || !Array.isArray(colors) || !colors.length) {
        throw Object.assign(new Error('Informe cor e tamanho antes de publicar'), { status: 400 });
    }
    if (new Set(sizes).size !== sizes.length || sizes.some(size => typeof size !== 'string' || !size.trim())
        || new Set(colors.map(color => color.id)).size !== colors.length
        || colors.some(color => !color.id || !String(color.name || '').trim()
        || sizes.some(size => !Object.hasOwn(color.stock || {}, size))
        || Object.keys(color.stock || {}).some(size => !sizes.includes(size))
        || Object.values(color.stock || {}).some(value => !Number.isSafeInteger(Number(value)) || Number(value) < 0))) {
        throw Object.assign(new Error('Estoque e tamanhos das cores não correspondem'), { status: 400 });
    }
}

// ─── Query-field allowlists ─────────────────────────────────────────
// Values are parameterized below, but identifiers cannot be parameterized by
// PostgreSQL.  Never interpolate a client-provided field name into SQL.
export const CATALOG_FILTER_FIELDS = {
    products: new Set(['category', 'subcategory', 'collection', 'status']),
    categories: new Set(['slug', 'parent_id', 'status']),
    collections: new Set(['slug', 'status', 'featured']),
    banners: new Set(['active', 'position']),
};

export const CATALOG_SORT_FIELDS = {
    products: new Set(['created_date', 'updated_date', 'name', 'price', 'sale_price', 'sold_count', 'rating', 'status']),
    categories: new Set(['sort_order', 'name', 'slug', 'created_at', 'updated_at']),
    collections: new Set(['sort_order', 'name', 'slug', 'created_at', 'updated_at']),
    banners: new Set(['sort_order', 'priority', 'start_date', 'end_date', 'created_at', 'updated_at']),
};

// ─── Helper: build WHERE clause from query params ──────────────────
export function buildFilter(req, allowedFields, extraConditions = []) {
    const conditions = [...extraConditions];
    const params = [];
    let idx = extraConditions.length + 1;

    for (const [key, value] of Object.entries(req.query)) {
        if (['sort', 'limit', 'page'].includes(key) || !allowedFields.has(key)) continue;
        if (typeof value !== 'string' || value.length > 200) {
            throw Object.assign(new Error('Filtro de catálogo inválido'), { status: 400 });
        }

        if (value === 'true' || value === 'false') {
            conditions.push(`${key} = $${idx++}`);
            params.push(value === 'true');
        } else if (value.startsWith('{')) {
            try {
                const parsed = JSON.parse(value);
                if (parsed.$in && Array.isArray(parsed.$in)) {
                    conditions.push(`${key} = ANY($${idx++})`);
                    params.push(parsed.$in);
                }
            } catch { /* ignore invalid JSON */ }
        } else {
            conditions.push(`${key} = $${idx++}`);
            params.push(value);
        }
    }
    return { conditions, params };
}

export function buildSort(req, allowedFields, defaultField, defaultDir = 'ASC') {
    const sortField = typeof req.query.sort === 'string' ? req.query.sort : defaultField;
    const desc = sortField.startsWith('-');
    const field = desc ? sortField.slice(1) : sortField;
    const safe = allowedFields.has(field) ? field : defaultField;
    return `ORDER BY ${safe} ${desc ? 'DESC' : defaultDir === 'DESC' && !desc ? 'DESC' : 'ASC'}`;
}

function withCatalogLimit(query, rawLimit) {
    if (rawLimit === undefined) return query;
    const limit = Number(rawLimit);
    if (typeof rawLimit !== 'string' || !Number.isSafeInteger(limit) || limit < 1) {
        throw Object.assign(new Error('Limite de catálogo inválido'), { status: 400 });
    }
    return `${query} LIMIT ${Math.min(limit, 200)}`;
}

// ─── Helper: generic INSERT ─────────────────────────────────────────
async function insertRow(table, data, dateField = 'updated_at') {
    const keys = catalogWriteKeys(table, data);

    const values = keys.map(k => {
        const v = data[k];
        if (v !== null && typeof v === 'object') return JSON.stringify(v);
        if (v === undefined) return null;
        return v;
    });
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const columns = keys.join(', ');
    const { rows } = await pool.query(
        `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) RETURNING *`,
        values
    );
    return rows[0];
}

// ─── Helper: generic UPDATE ─────────────────────────────────────────
async function updateRow(table, id, data, dateField = 'updated_at', db = pool) {
    const keys = catalogWriteKeys(table, data);

    const setParts = keys.map((k, i) => `${k} = $${i + 1}`);
    const values = keys.map(k => {
        const v = data[k];
        if (v !== null && typeof v === 'object') return JSON.stringify(v);
        if (v === undefined) return null;
        return v;
    });
    values.push(id);
    const { rows } = await db.query(
        `UPDATE ${table} SET ${setParts.join(', ')}, ${dateField} = now() WHERE id = $${values.length} RETURNING *`,
        values
    );
    return rows[0];
}

// ─── PRODUCTS ───────────────────────────────────────────────────────
router.get('/products', searchLimiter, async (req, res, next) => {
    try {
        const isAdmin = req.user?.role === 'admin';
        const extra = isAdmin ? [] : ['status = $1'];
        const extraParams = isAdmin ? [] : ['published'];
        const { conditions, params } = buildFilter(req, CATALOG_FILTER_FIELDS.products, extra);
        const allParams = [...extraParams, ...params];

        let query = 'SELECT * FROM products';
        if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ' + buildSort(req, CATALOG_SORT_FIELDS.products, 'created_date', 'DESC');
        query += ', id DESC';
        // Cap page size to prevent unlimited queries
        const maxLimit = isAdmin ? 200 : 60;
        const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || maxLimit, 1), maxLimit);
        const page = Math.min(Math.max(Number.parseInt(req.query.page, 10) || 1, 1), 100);
        query += ` LIMIT ${limit} OFFSET ${(page - 1) * limit}`;

        const { rows } = await pool.query(query, allParams);
        res.json(isAdmin ? await withStockSummary(rows) : rows);
    } catch (err) { next(err); }
});

router.get('/products/:id', async (req, res, next) => {
    try {
        const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Produto não encontrado' });
        // Non-admin: only published
        if (req.user?.role !== 'admin' && rows[0].status !== 'published') {
            return res.status(404).json({ error: 'Produto não encontrado' });
        }
        res.json(req.user?.role === 'admin' ? (await withStockSummary(rows))[0] : rows[0]);
    } catch (err) { next(err); }
});

router.post('/products', auth, requireAdmin, async (req, res, next) => {
    try {
        validateProductForPublication(req.body);
        const product = await insertRow('products', req.body, 'updated_date');
        await logAudit(req.user.id, 'product.create', 'product', product.id, { name: req.body.name }, req.ip);
        res.status(201).json(product);
    } catch (err) { next(err); }
});

router.patch('/products/:id', auth, requireAdmin, async (req, res, next) => {
    try {
        const { expected_updated_date: expectedUpdatedDate, ...changes } = req.body;
        const product = await withTransaction(async client => {
            const { rows: existing } = await client.query('SELECT status, price, sale_price, sizes, colors, weight, package_height, package_width, package_length, updated_date FROM products WHERE id = $1 FOR UPDATE', [req.params.id]);
            if (!existing.length) return null;
            if (expectedUpdatedDate && new Date(existing[0].updated_date).getTime() !== new Date(expectedUpdatedDate).getTime()) {
                throw Object.assign(new Error('O produto mudou desde a abertura do formulário. Recarregue antes de salvar.'), { status: 409 });
            }
            validateProductForPublication({ ...existing[0], ...changes });
            return updateRow('products', req.params.id, changes, 'updated_date', client);
        });
        if (!product) return res.status(404).json({ error: 'Produto não encontrado' });
        await logAudit(req.user.id, 'product.update', 'product', req.params.id, changes, req.ip);
        res.json(product);
    } catch (err) { next(err); }
});

router.delete('/products/:id', auth, requireAdmin, async (req, res, next) => {
    try {
        await pool.query("UPDATE products SET status = 'archived', updated_date = now() WHERE id = $1", [req.params.id]);
        await logAudit(req.user.id, 'product.archive', 'product', req.params.id, null, req.ip);
        res.json({ id: req.params.id });
    } catch (err) { next(err); }
});

// ─── CATEGORIES ────────────────────────────────────────────────────
router.get('/categories', async (req, res, next) => {
    try {
        const isAdmin = req.user?.role === 'admin';
        const { conditions, params } = buildFilter(req, CATALOG_FILTER_FIELDS.categories);
        if (!isAdmin) conditions.push("status = 'active'");
        let query = 'SELECT *, created_at as created_date, updated_at as updated_date FROM categories';
        if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ' + buildSort(req, CATALOG_SORT_FIELDS.categories, 'sort_order', 'ASC');
        query = withCatalogLimit(query, req.query.limit);
        let rows;
        try {
            ({ rows } = await pool.query(query, params));
        } catch (err) {
            if (err.code !== '42703') throw err;
            // Existing deployments may receive this code before migration 014.
            // The legacy schema has no publication status to filter.
            const legacy = buildFilter(req, new Set(['slug', 'parent_id']));
            let legacyQuery = 'SELECT *, created_at as created_date, updated_at as updated_date FROM categories';
            if (legacy.conditions.length) legacyQuery += ' WHERE ' + legacy.conditions.join(' AND ');
            legacyQuery += ' ' + buildSort(req, CATALOG_SORT_FIELDS.categories, 'sort_order', 'ASC');
            legacyQuery = withCatalogLimit(legacyQuery, req.query.limit);
            ({ rows } = await pool.query(legacyQuery, legacy.params));
        }
        res.json(rows);
    } catch (err) { next(err); }
});

router.post('/categories', auth, requireAdmin, async (req, res, next) => {
    try { res.status(201).json(await insertRow('categories', req.body)); }
    catch (err) { next(err); }
});

router.patch('/categories/:id', auth, requireAdmin, async (req, res, next) => {
    try {
        const row = await updateRow('categories', req.params.id, req.body);
        if (!row) return res.status(404).json({ error: 'Não encontrado' });
        res.json(row);
    } catch (err) { next(err); }
});

router.delete('/categories/:id', auth, requireAdmin, async (req, res, next) => {
    try {
        await pool.query('DELETE FROM categories WHERE id = $1', [req.params.id]);
        res.json({ id: req.params.id });
    } catch (err) { next(err); }
});

// ─── COLLECTIONS ───────────────────────────────────────────────────
router.get('/collections', async (req, res, next) => {
    try {
        const isAdmin = req.user?.role === 'admin';
        const { conditions, params } = buildFilter(req, CATALOG_FILTER_FIELDS.collections);
        if (!isAdmin) conditions.push("status = 'active'", '(start_date IS NULL OR start_date <= now())', '(end_date IS NULL OR end_date >= now())');
        let query = 'SELECT *, created_at as created_date, updated_at as updated_date FROM collections';
        if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ' + buildSort(req, CATALOG_SORT_FIELDS.collections, 'sort_order', 'ASC');
        query = withCatalogLimit(query, req.query.limit);
        let rows;
        try {
            ({ rows } = await pool.query(query, params));
        } catch (err) {
            if (err.code !== '42703') throw err;
            const legacy = buildFilter(req, new Set(['slug']));
            let legacyQuery = 'SELECT *, created_at as created_date, updated_at as updated_date FROM collections';
            if (legacy.conditions.length) legacyQuery += ' WHERE ' + legacy.conditions.join(' AND ');
            legacyQuery += ' ' + buildSort(req, CATALOG_SORT_FIELDS.collections, 'sort_order', 'ASC');
            legacyQuery = withCatalogLimit(legacyQuery, req.query.limit);
            ({ rows } = await pool.query(legacyQuery, legacy.params));
        }
        res.json(rows);
    } catch (err) { next(err); }
});

router.post('/collections', auth, requireAdmin, async (req, res, next) => {
    try { res.status(201).json(await insertRow('collections', req.body)); }
    catch (err) { next(err); }
});

router.patch('/collections/:id', auth, requireAdmin, async (req, res, next) => {
    try {
        const row = await updateRow('collections', req.params.id, req.body);
        if (!row) return res.status(404).json({ error: 'Não encontrado' });
        res.json(row);
    } catch (err) { next(err); }
});

router.delete('/collections/:id', auth, requireAdmin, async (req, res, next) => {
    try {
        await pool.query('DELETE FROM collections WHERE id = $1', [req.params.id]);
        res.json({ id: req.params.id });
    } catch (err) { next(err); }
});

// ─── BANNERS ───────────────────────────────────────────────────────
router.get('/banners', async (req, res, next) => {
    try {
        const isAdmin = req.user?.role === 'admin';
        const extra = isAdmin ? [] : ['active = $1'];
        const extraParams = isAdmin ? [] : [true];
        const { conditions, params } = buildFilter(req, CATALOG_FILTER_FIELDS.banners, extra);
        const allParams = [...extraParams, ...params];

        let query = 'SELECT *, created_at as created_date, updated_at as updated_date FROM banners';
        if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');

        // For public access: filter by date validity and priority ordering
        if (!isAdmin) {
            const dateParamIdx = allParams.length + 1;
            if (conditions.length > 0) query += ' AND';
            else query += ' WHERE';
            query += ` (start_date IS NULL OR start_date <= $${dateParamIdx}) AND (end_date IS NULL OR end_date >= $${dateParamIdx})`;
            allParams.push(new Date());
        }

        query += ' ' + buildSort(req, CATALOG_SORT_FIELDS.banners, isAdmin ? 'sort_order' : 'priority', isAdmin ? 'ASC' : 'DESC');
        query = withCatalogLimit(query, req.query.limit);
        const { rows } = await pool.query(query, allParams);
        res.json(rows);
    } catch (err) { next(err); }
});

export async function validateBannerLinks(data, db = pool) {
    const fields = ['link', 'button_link', 'primary_cta_link', 'secondary_cta_link'];
    const supplied = fields.filter(field => Object.hasOwn(data, field) && data[field] !== null && data[field] !== '');
    if (!supplied.length) return;
    const { rows } = await db.query("SELECT value FROM settings WHERE key = 'general'");
    const allowedOrigins = rows[0]?.value?.external_link_origins || [];
    for (const field of supplied) if (!safeNavigation(data[field], { allowedOrigins })) {
        throw Object.assign(new Error(`Destino ${field} inválido ou não autorizado.`), { status: 400 });
    }
}

router.post('/banners', auth, requireAdmin, async (req, res, next) => {
    try { await validateBannerLinks(req.body); res.status(201).json(await insertRow('banners', req.body)); }
    catch (err) { next(err); }
});

router.patch('/banners/:id', auth, requireAdmin, async (req, res, next) => {
    try {
        await validateBannerLinks(req.body);
        const row = await updateRow('banners', req.params.id, req.body);
        if (!row) return res.status(404).json({ error: 'Não encontrado' });
        res.json(row);
    } catch (err) { next(err); }
});

router.delete('/banners/:id', auth, requireAdmin, async (req, res, next) => {
    try {
        await pool.query('DELETE FROM banners WHERE id = $1', [req.params.id]);
        res.json({ id: req.params.id });
    } catch (err) { next(err); }
});

// ─── SETTINGS ──────────────────────────────────────────────────────
// Server-side allowlist: only these setting keys may be created/updated via POST.
// Keys not in this list (e.g. "notifications", "look_promotion") are internal and protected.
export const ALLOWED_SETTING_KEYS = new Set([
    'general', 'store', 'address', 'shipping', 'payments',
    'emails', 'social', 'seo', 'policies', 'maintenance', 'shipping_sender',
]);

// Server-side public-keys list: is_public is determined HERE, never trusted from the client.
export const PUBLIC_SETTING_KEYS = new Set([
    'general', 'store', 'shipping', 'social', 'seo', 'policies', 'maintenance',
]);

router.get('/settings', async (req, res, next) => {
    try {
        const isAdmin = req.user?.role === 'admin';
        let query, params;
        if (isAdmin) {
            query = 'SELECT *, created_at as created_date, updated_at as updated_date FROM settings ORDER BY key';
            params = [];
        } else {
            query = 'SELECT *, created_at as created_date, updated_at as updated_date FROM settings WHERE is_public = true ORDER BY key';
            params = [];
        }
        const { rows } = await pool.query(query, params);
        res.json(isAdmin ? rows : rows.map(publicSetting).filter(Boolean));
    } catch (err) { next(err); }
});

router.post('/settings', auth, requireAdmin, async (req, res, next) => {
    try {
        const { key, value } = req.body;
        if (!key) return res.status(400).json({ error: 'key é obrigatório' });
        if (!ALLOWED_SETTING_KEYS.has(key)) {
            return res.status(403).json({ error: 'Esta configuração não pode ser alterada por esta rota' });
        }
        validateSettingValue(key, value);
        // is_public is determined server-side — never trust the client
        const is_public = PUBLIC_SETTING_KEYS.has(key);
        const { rows } = await pool.query(
            `INSERT INTO settings (key, value, is_public, updated_by)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (key) DO UPDATE SET value = $2, is_public = $3, updated_by = $4, updated_at = now()
             RETURNING *, created_at as created_date, updated_at as updated_date`,
            [key, JSON.stringify(value), is_public, req.user.id]
        );
        await logAudit(req.user.id, 'setting.create', 'setting', rows[0].id, { key, is_public }, req.ip);
        res.status(201).json(rows[0]);
    } catch (err) { next(err); }
});

router.patch('/settings/:id', auth, requireAdmin, async (req, res, next) => {
    try {
        // Do not use generic updateRow here.  It would let an admin PATCH an
        // arbitrary key/is_public field and bypass the settings allowlist.
        if (!Object.prototype.hasOwnProperty.call(req.body, 'value')) {
            return res.status(400).json({ error: 'value é obrigatório' });
        }
        const { rows: existing } = await pool.query('SELECT key FROM settings WHERE id = $1', [req.params.id]);
        if (existing.length === 0) return res.status(404).json({ error: 'Não encontrado' });
        const key = existing[0].key;
        if (!ALLOWED_SETTING_KEYS.has(key)) {
            return res.status(403).json({ error: 'Esta configuração não pode ser alterada por esta rota' });
        }
        validateSettingValue(key, req.body.value);
        const is_public = PUBLIC_SETTING_KEYS.has(key);
        const { rows } = await pool.query(
            `UPDATE settings SET value = $1, is_public = $2, updated_by = $3, updated_at = now()
             WHERE id = $4 RETURNING *, created_at as created_date, updated_at as updated_date`,
            [JSON.stringify(req.body.value), is_public, req.user.id, req.params.id]
        );
        const row = rows[0];
        await logAudit(req.user.id, 'setting.update', 'setting', req.params.id, { key, is_public }, req.ip);
        res.json(row);
    } catch (err) { next(err); }
});

router.put('/settings/:key', auth, requireAdmin, async (req, res, next) => {
    try {
        const { value } = req.body;
        const key = req.params.key;
        if (!ALLOWED_SETTING_KEYS.has(key)) {
            return res.status(403).json({ error: 'Esta configuração não pode ser alterada por esta rota' });
        }
        validateSettingValue(key, value);
        // is_public is determined server-side — never trust the client
        const is_public = PUBLIC_SETTING_KEYS.has(key);
        const { rows } = await pool.query(
            `UPDATE settings SET value = $1, is_public = $2, updated_by = $3, updated_at = now()
             WHERE key = $4 RETURNING *, created_at as created_date, updated_at as updated_date`,
            [JSON.stringify(value), is_public, req.user.id, key]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Setting não encontrado' });
        await logAudit(req.user.id, 'setting.update', 'setting', rows[0].id, { key, is_public }, req.ip);
        res.json(rows[0]);
    } catch (err) { next(err); }
});

export default router;
