import { Router } from 'express';
import { pool } from '../config/db.js';
import { auth } from '../middleware.js';

const router = Router();

// ─── FAVORITES ─────────────────────────────────────────────────────

router.get('/favorites', auth, async (req, res, next) => {
    try {
        const { product_id } = req.query;
        let query = 'SELECT *, created_at as created_date FROM favorites WHERE user_id = $1';
        const params = [req.user.id];
        if (product_id) { query += ' AND product_id = $2'; params.push(product_id); }
        query += ' ORDER BY created_at DESC';
        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (err) { next(err); }
});

router.post('/favorites', auth, async (req, res, next) => {
    try {
        const { product_id } = req.body;
        const { rows } = await pool.query(
            `INSERT INTO favorites (user_id, product_id) VALUES ($1, $2)
             ON CONFLICT (user_id, product_id) DO NOTHING RETURNING *`,
            [req.user.id, product_id]
        );
        res.status(201).json(rows[0] || { product_id });
    } catch (err) { next(err); }
});

router.post('/favorites/bulk', auth, async (req, res, next) => {
    try {
        const { items } = req.body;
        const results = [];
        for (const item of items) {
            const { rows } = await pool.query(
                `INSERT INTO favorites (user_id, product_id) VALUES ($1, $2)
                 ON CONFLICT (user_id, product_id) DO NOTHING RETURNING *`,
                [req.user.id, item.product_id]
            );
            if (rows[0]) results.push(rows[0]);
        }
        res.status(201).json(results);
    } catch (err) { next(err); }
});

router.delete('/favorites/:id', auth, async (req, res, next) => {
    try {
        // Try by favorite record ID (UUID) first, then by product_id (backward compat)
        const { rowCount } = await pool.query('DELETE FROM favorites WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        if (rowCount === 0) {
            await pool.query('DELETE FROM favorites WHERE product_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        }
        res.json({ id: req.params.id });
    } catch (err) { next(err); }
});

// ─── ADDRESSES ─────────────────────────────────────────────────────

router.get('/addresses', auth, async (req, res, next) => {
    try {
        const { rows } = await pool.query(
            'SELECT *, created_at as created_date FROM addresses WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );
        res.json(rows);
    } catch (err) { next(err); }
});

router.post('/addresses', auth, async (req, res, next) => {
    try {
        const { label, recipient, zip_code, street, number, complement, district, city, state, is_default } = req.body;
        if (is_default) {
            await pool.query('UPDATE addresses SET is_default = false WHERE user_id = $1', [req.user.id]);
        }
        const { rows } = await pool.query(
            `INSERT INTO addresses (user_id, label, recipient, zip_code, street, number, complement, district, city, state, is_default)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *, created_at as created_date`,
            [req.user.id, label, recipient, zip_code, street, number, complement, district, city, state, is_default || false]
        );
        res.status(201).json(rows[0]);
    } catch (err) { next(err); }
});

router.patch('/addresses/:id', auth, async (req, res, next) => {
    try {
        const { label, recipient, zip_code, street, number, complement, district, city, state, is_default } = req.body;
        if (is_default) {
            await pool.query('UPDATE addresses SET is_default = false WHERE user_id = $1', [req.user.id]);
        }
        const { rows } = await pool.query(
            `UPDATE addresses SET label = COALESCE($1, label), recipient = COALESCE($2, recipient),
             zip_code = COALESCE($3, zip_code), street = COALESCE($4, street), number = COALESCE($5, number),
             complement = COALESCE($6, complement), district = COALESCE($7, district), city = COALESCE($8, city),
             state = COALESCE($9, state), is_default = COALESCE($10, is_default), updated_at = now()
             WHERE id = $11 AND user_id = $12 RETURNING *, created_at as created_date`,
            [label, recipient, zip_code, street, number, complement, district, city, state, is_default, req.params.id, req.user.id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Endereço não encontrado' });
        res.json(rows[0]);
    } catch (err) { next(err); }
});

router.delete('/addresses/:id', auth, async (req, res, next) => {
    try {
        await pool.query('DELETE FROM addresses WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ id: req.params.id });
    } catch (err) { next(err); }
});

export default router;
