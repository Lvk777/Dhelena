import { Router } from 'express';
import { pool } from '../config/db.js';
import { auth, requireAdmin } from '../middleware.js';
import { logAudit } from '../services.js';
import { searchLimiter } from '../middleware/rateLimiters.js';

const router = Router();

// ─── Query-field allowlists ─────────────────────────────────────────
// Values are parameterized below, but identifiers cannot be parameterized by
// PostgreSQL.  Never interpolate a client-provided field name into SQL.
export const CATALOG_FILTER_FIELDS = {
    products: new Set(['category', 'subcategory', 'collection', 'status']),
    categories: new Set(['slug', 'parent_id']),
    collections: new Set(['slug']),
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
    const sortField = req.query.sort || defaultField;
    const desc = sortField.startsWith('-');
    const field = desc ? sortField.slice(1) : sortField;
    const safe = allowedFields.has(field) ? field : defaultField;
    return `ORDER BY ${safe} ${desc ? 'DESC' : defaultDir === 'DESC' && !desc ? 'DESC' : 'ASC'}`;
}

// ─── Helper: generic INSERT ─────────────────────────────────────────
async function insertRow(table, data, dateField = 'updated_at') {
    const reserved = ['id', 'created_date', 'updated_date', 'created_at', 'updated_at', 'created_by_id', 'is_sample'];
    const keys = Object.keys(data).filter(k => !reserved.includes(k));
    if (keys.length === 0) return null;

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
async function updateRow(table, id, data, dateField = 'updated_at') {
    const reserved = ['id', 'created_date', 'updated_date', 'created_at', 'updated_at', 'created_by_id', 'is_sample'];
    const keys = Object.keys(data).filter(k => !reserved.includes(k));
    if (keys.length === 0) return null;

    const setParts = keys.map((k, i) => {
        const v = data[k];
        if (v !== null && typeof v === 'object') return `${k} = $${i + 1}`;
        return `${k} = $${i + 1}`;
    });
    const values = keys.map(k => {
        const v = data[k];
        if (v !== null && typeof v === 'object') return JSON.stringify(v);
        if (v === undefined) return null;
        return v;
    });
    values.push(id);
    const { rows } = await pool.query(
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
        // Cap page size to prevent unlimited queries
        const maxLimit = isAdmin ? 200 : 60;
        const limit = Math.min(parseInt(req.query.limit) || maxLimit, maxLimit);
        query += ` LIMIT ${limit}`;

        const { rows } = await pool.query(query, allParams);
        res.json(rows);
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
        res.json(rows[0]);
    } catch (err) { next(err); }
});

router.post('/products', auth, requireAdmin, async (req, res, next) => {
    try {
        const product = await insertRow('products', req.body, 'updated_date');
        await logAudit(req.user.id, 'product.create', 'product', product.id, { name: req.body.name }, req.ip);
        res.status(201).json(product);
    } catch (err) { next(err); }
});

router.patch('/products/:id', auth, requireAdmin, async (req, res, next) => {
    try {
        const product = await updateRow('products', req.params.id, req.body, 'updated_date');
        if (!product) return res.status(404).json({ error: 'Produto não encontrado' });
        await logAudit(req.user.id, 'product.update', 'product', req.params.id, req.body, req.ip);
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
        const { conditions, params } = buildFilter(req, CATALOG_FILTER_FIELDS.categories);
        let query = 'SELECT *, created_at as created_date, updated_at as updated_date FROM categories';
        if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ' + buildSort(req, CATALOG_SORT_FIELDS.categories, 'sort_order', 'ASC');
        if (req.query.limit) query += ` LIMIT ${parseInt(req.query.limit)}`;
        const { rows } = await pool.query(query, params);
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
        const { conditions, params } = buildFilter(req, CATALOG_FILTER_FIELDS.collections);
        let query = 'SELECT *, created_at as created_date, updated_at as updated_date FROM collections';
        if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ' + buildSort(req, CATALOG_SORT_FIELDS.collections, 'sort_order', 'ASC');
        if (req.query.limit) query += ` LIMIT ${parseInt(req.query.limit)}`;
        const { rows } = await pool.query(query, params);
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
        if (req.query.limit) query += ` LIMIT ${parseInt(req.query.limit)}`;
        const { rows } = await pool.query(query, allParams);
        res.json(rows);
    } catch (err) { next(err); }
});

router.post('/banners', auth, requireAdmin, async (req, res, next) => {
    try { res.status(201).json(await insertRow('banners', req.body)); }
    catch (err) { next(err); }
});

router.patch('/banners/:id', auth, requireAdmin, async (req, res, next) => {
    try {
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
    'emails', 'social', 'seo', 'policies', 'maintenance',
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
        res.json(rows);
    } catch (err) { next(err); }
});

router.post('/settings', auth, requireAdmin, async (req, res, next) => {
    try {
        const { key, value } = req.body;
        if (!key) return res.status(400).json({ error: 'key é obrigatório' });
        if (!ALLOWED_SETTING_KEYS.has(key)) {
            return res.status(403).json({ error: 'Esta configuração não pode ser alterada por esta rota' });
        }
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
