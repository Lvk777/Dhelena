import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';
import { auth } from '../middleware.js';

const router = Router();

function signToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
}

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
    try {
        const { email, password, full_name } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email e senha são obrigatórios' });

        const { rows: existing } = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
        if (existing.length > 0) return res.status(409).json({ error: 'Email já cadastrado' });

        const hash = await bcrypt.hash(password, 10);
        const { rows } = await pool.query(
            'INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, full_name, phone, role',
            [email.toLowerCase(), hash, full_name || null, 'customer']
        );
        const user = rows[0];
        const token = signToken(user);
        res.status(201).json({ user, token });
    } catch (err) { next(err); }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email e senha são obrigatórios' });

        const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
        if (rows.length === 0) return res.status(401).json({ error: 'Email ou senha inválidos' });

        const user = rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Email ou senha inválidos' });

        const safeUser = { id: user.id, email: user.email, full_name: user.full_name, phone: user.phone, role: user.role };
        const token = signToken(user);
        res.json({ user: safeUser, token });
    } catch (err) { next(err); }
});

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
    res.json(req.user);
});

// PATCH /api/auth/me
router.patch('/me', auth, async (req, res, next) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
        const { full_name, phone } = req.body;
        const { rows } = await pool.query(
            'UPDATE users SET full_name = COALESCE($1, full_name), phone = COALESCE($2, phone), updated_at = now() WHERE id = $3 RETURNING id, email, full_name, phone, role',
            [full_name || null, phone || null, req.user.id]
        );
        res.json(rows[0]);
    } catch (err) { next(err); }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res, next) => {
    try {
        const { email } = req.body;
        const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [(email || '').toLowerCase()]);
        if (rows.length === 0) return res.json({}); // Don't reveal if email exists

        const user = rows[0];
        const resetToken = jwt.sign({ id: user.id, purpose: 'reset' }, process.env.JWT_SECRET, { expiresIn: '1h' });

        // In production: send email with link containing resetToken
        // For dev: return the token so it can be tested
        res.json({ reset_token: resetToken });
    } catch (err) { next(err); }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res, next) => {
    try {
        const { resetToken, newPassword } = req.body;
        if (!resetToken || !newPassword) return res.status(400).json({ error: 'Token e nova senha são obrigatórios' });

        const decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
        if (decoded.purpose !== 'reset') return res.status(400).json({ error: 'Token inválido' });

        const hash = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [hash, decoded.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: 'Token inválido ou expirado' });
    }
});

export default router;
