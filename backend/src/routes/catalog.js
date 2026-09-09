import { Router } from 'express';
import { pool } from '../config/db.js';
import { auth, requireAdmin } from '../middleware.js';
import { logAudit } from '../services.js';

const router = Router();

// ─── Helper: build WHERE clause from query params ──────────────────
function buildFilter(req, extraConditions = []) {
    const conditions = [...extraConditions];
    const params = [];
    let idx = extraConditions.length + 1;

    for (const [key, value] of Object.entries(req.query)) {
        if (['sort', 'limit', 'page'].includes(key)) continue;

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

function buildSort(req, defaultField, defaultDir = 'ASC') {
    const sortField = req.query.sort || defaultField;
    const desc = sortField.startsWith('-');
    const field = desc ? sortField.slice(1) : sortField;
    // Whitelist field names to prevent SQL injection
    const safe = field.replace(/[^a-zA-Z_]/g, '');
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
router.get('/products', async (req, res, next) => {
    try {
        const isAdmin = req.user?.role === 'admin';
        const extra = isAdmin ? [] : ['status = $1'];
        const extraParams = isAdmin ? [] : ['published'];
        const { conditions, params } = buildFilter(req, extra);
        const allParams = [...extraParams, ...params];

        let query = 'SELECT * FROM products';
        if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ' + buildSort(req, 'created_date', 'DESC');
        if (req.query.limit) query += ` LIMIT ${parseInt(req.query.limit)}`;

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
        const { conditions, params } = buildFilter(req);
        let query = 'SELECT *, created_at as created_date, updated_at as updated_date FROM categories';
        if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ' + buildSort(req, 'sort_order', 'ASC');
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
        const { conditions, params } = buildFilter(req);
        let query = 'SELECT *, created_at as created_date, updated_at as updated_date FROM collections';
        if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ' + buildSort(req, 'sort_order', 'ASC');
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
        const { conditions, params } = buildFilter(req, extra);
        const allParams = [...extraParams, ...params];

        let query = 'SELECT *, created_at as created_date, updated_at as updated_date FROM banners';
        if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ' + buildSort(req, 'sort_order', 'ASC');
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

router.patch('/settings/:id', auth, requireAdmin, async (req, res, next) => {
    try {
        const row = await updateRow('settings', req.params.id, req.body);
        if (!row) return res.status(404).json({ error: 'Não encontrado' });
        await logAudit(req.user.id, 'setting.update', 'setting', req.params.id, req.body, req.ip);
        res.json(row);
    } catch (err) { next(err); }
});

router.put('/settings/:key', auth, requireAdmin, async (req, res, next) => {
    try {
        const { value, is_public } = req.body;
        const { rows } = await pool.query(
            `UPDATE settings SET value = $1, is_public = $2, updated_by = $3, updated_at = now()
             WHERE key = $4 RETURNING *, created_at as created_date, updated_at as updated_date`,
            [JSON.stringify(value), is_public ?? false, req.user.id, req.params.key]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Setting não encontrado' });
        res.json(rows[0]);
    } catch (err) { next(err); }
});

export default router;
