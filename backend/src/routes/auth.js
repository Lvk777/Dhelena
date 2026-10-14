import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';
import { auth } from '../middleware.js';
import { loginLimiter, registerLimiter, forgotPasswordLimiter } from '../middleware/rateLimiters.js';
import { logSecurityEvent } from '../middleware/securityLog.js';
import { recordLoginEvent } from './security.js';
import { normalizeBirthDate, normalizeProfileInput } from '../lib/validation.js';
import { authCapabilities } from '../lib/authCapabilities.js';

const router = Router();
const isProduction = process.env.NODE_ENV === 'production';
router.get('/capabilities', async (_req, res) => { res.json(await authCapabilities()); });

function signToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
}

// POST /api/auth/register
router.post('/register', registerLimiter, async (req, res, next) => {
    try {
        if (isProduction) return res.status(404).json({ error: 'Use o cadastro Supabase.' });
        const { email, password, full_name } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email e senha são obrigatórios' });

        // Validate email format
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'E-mail inválido' });
        }

        // Validate password strength
        if (password.length < 6) {
            return res.status(400).json({ error: 'A senha deve ter no mínimo 6 caracteres' });
        }

        const { rows: existing } = await pool.query('SELECT id FROM profiles WHERE email = $1', [email.toLowerCase()]);
        if (existing.length > 0) return res.status(409).json({ error: 'Email já cadastrado' });

        const hash = await bcrypt.hash(password, 10);
        const { rows } = await pool.query(
            'INSERT INTO profiles (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, full_name, phone, role',
            [email.toLowerCase(), hash, full_name || null, 'customer']
        );
        const user = rows[0];
        const token = signToken(user);
        res.status(201).json({ user, token });
    } catch (err) { next(err); }
});

// POST /api/auth/login (with brute force protection)
router.post('/login', loginLimiter, async (req, res, next) => {
    try {
        if (isProduction) return res.status(404).json({ error: 'Use o login Supabase.' });
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email e senha são obrigatórios' });

        const { rows } = await pool.query('SELECT * FROM profiles WHERE email = $1', [email.toLowerCase()]);

        // Generic error message — never reveal if email exists
        const genericError = 'E-mail ou senha inválidos.';

        if (rows.length === 0) {
            await logSecurityEvent(req, 'login_failed', { reason: 'email_not_found' });
            await recordLoginEvent(req, { email: (email || '').toLowerCase(), userType: 'customer', status: 'failed' });
            return res.status(401).json({ error: genericError });
        }

        const user = rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            await logSecurityEvent(req, 'login_failed', { reason: 'wrong_password', target_email: email.toLowerCase() });
            await recordLoginEvent(req, { userId: user.id, email: user.email, userType: user.role === 'admin' ? 'admin' : 'customer', status: 'failed' });
            return res.status(401).json({ error: genericError });
        }

        const safeUser = { id: user.id, email: user.email, full_name: user.full_name, phone: user.phone, role: user.role };
        const token = signToken(user);
        await recordLoginEvent(req, { userId: user.id, email: user.email, userType: user.role === 'admin' ? 'admin' : 'customer', status: 'success' });
        res.json({ user: safeUser, token });
    } catch (err) { next(err); }
});

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
    res.json({ ...req.user, email_change_supported: req.authProvider === 'supabase'
        && (req.supabaseUserId === req.user.id || req.user.identity_linked === true) });
});

// Preview uses only the authenticated immutable identity; never changes Auth or profiles.
router.post('/email-change/preview', auth, async (req, res, next) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Autenticação necessária' });
        if (req.authProvider !== 'supabase' || (req.supabaseUserId !== req.user.id && req.user.identity_linked !== true)) {
            return res.status(409).json({ error: 'O vínculo seguro desta conta precisa ser concluído antes de alterar seu e-mail.' });
        }
        if (Object.keys(req.body || {}).some(k => k !== 'email') || typeof req.body?.email !== 'string'
            || req.body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.body.email.trim())) return res.status(400).json({ error: 'Informe um e-mail válido.' });
        const email = req.body.email.trim().toLowerCase();
        const conflict = await pool.query('SELECT id FROM profiles WHERE lower(email) = $1 AND id <> $2 LIMIT 1', [email, req.user.id]);
        if (conflict.rows.length) return res.status(409).json({ error: 'Este e-mail não está disponível para alteração.' });
        res.json({ allowed: true });
    } catch (error) { next(error); }
});

// Development-only password change; production changes go to Supabase Auth.
router.post('/change-password', auth, loginLimiter, async (req, res, next) => {
    try {
        if (isProduction) return res.status(404).json({ error: 'Use Supabase Auth.' });
        if (!req.user) return res.status(401).json({ error: 'Autenticação necessária' });
        const { currentPassword, newPassword } = req.body || {};
        if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)
            || typeof currentPassword !== 'string') return res.status(400).json({ error: 'Confira as senhas informadas.' });
        const { rows } = await pool.query('SELECT password_hash FROM profiles WHERE id = $1', [req.user.id]);
        if (!rows[0] || !await bcrypt.compare(currentPassword, rows[0].password_hash)) return res.status(400).json({ error: 'Confira as senhas informadas.' });
        await pool.query('UPDATE profiles SET password_hash = $1, updated_at = now() WHERE id = $2', [await bcrypt.hash(newPassword, 10), req.user.id]);
        res.json({ success: true });
    } catch (error) { next(error); }
});

// PATCH /api/auth/me
router.patch('/me', auth, async (req, res, next) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
        const { full_name, phone, cpf, birth_date } = normalizeProfileInput(req.body);
        const normalizedBirthDate = normalizeBirthDate(birth_date);
        const { rows } = await pool.query(
            `UPDATE profiles SET full_name = COALESCE($1, full_name), phone = COALESCE($2, phone),
             cpf = COALESCE($3, cpf), birth_date = COALESCE($4, birth_date), updated_at = now()
             WHERE id = $5 RETURNING id, email, full_name, phone, cpf, birth_date, role`,
            [full_name || null, phone || null, cpf || null, normalizedBirthDate, req.user.id]
        );
        res.json(rows[0]);
    } catch (err) { next(err); }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', forgotPasswordLimiter, async (req, res, next) => {
    try {
        // Password reset is handled directly by Supabase Auth in production.
        // Never issue a legacy reset token from the production API.
        if (isProduction) return res.json({});
        const { email } = req.body;
        // Always return generic success — never reveal if email exists
        const { rows } = await pool.query('SELECT * FROM profiles WHERE email = $1', [(email || '').toLowerCase()]);
        if (rows.length === 0) return res.json({});

        const user = rows[0];
        const resetToken = jwt.sign({ id: user.id, purpose: 'reset' }, process.env.JWT_SECRET, { expiresIn: '1h' });

        // In production (Supabase): frontend uses supabase.auth.resetPasswordForEmail()
        // In dev: return the token so it can be tested
        res.json({ reset_token: resetToken });
    } catch (err) { next(err); }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res, next) => {
    try {
        if (isProduction) return res.status(404).json({ error: 'Use a recuperação de senha Supabase.' });
        const { resetToken, newPassword } = req.body;
        if (!resetToken || !newPassword) return res.status(400).json({ error: 'Token e nova senha são obrigatórios' });

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'A senha deve ter no mínimo 6 caracteres' });
        }

        const decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
        if (decoded.purpose !== 'reset') return res.status(400).json({ error: 'Token inválido' });

        const hash = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE profiles SET password_hash = $1, updated_at = now() WHERE id = $2', [hash, decoded.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: 'Token inválido ou expirado' });
    }
});

export default router;
