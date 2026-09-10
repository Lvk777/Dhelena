import { Router } from 'express';
import { pool } from '../config/db.js';
import { auth, requireAdmin } from '../middleware.js';
import { logAudit } from '../services.js';

const router = Router();

// ═══════════════════════════════════════════════════════════
// SIZE GUIDES
// ═══════════════════════════════════════════════════════════

// Public: list all guides with rows
router.get('/size-guides', async (req, res, next) => {
    try {
        const { rows: guides } = await pool.query('SELECT * FROM size_guides ORDER BY sort_order, name');
        const { rows: allRows } = await pool.query('SELECT * FROM size_guide_rows ORDER BY guide_id, sort_order');
        const result = guides.map(g => ({
            ...g,
            rows: allRows.filter(r => r.guide_id === g.id),
        }));
        res.json(result);
    } catch (e) { next(e); }
});

// Public: get one guide with rows
router.get('/size-guides/:id', async (req, res, next) => {
    try {
        const { rows } = await pool.query('SELECT * FROM size_guides WHERE id = $1', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Guia não encontrado' });
        const { rows: guideRows } = await pool.query('SELECT * FROM size_guide_rows WHERE guide_id = $1 ORDER BY sort_order', [req.params.id]);
        res.json({ ...rows[0], rows: guideRows });
    } catch (e) { next(e); }
});

// Admin: create guide
router.post('/size-guides', auth, requireAdmin, async (req, res, next) => {
    try {
        const { name, type, sort_order = 0, rows = [] } = req.body;
        const { rows: g } = await pool.query(
            'INSERT INTO size_guides (name, type, sort_order) VALUES ($1, $2, $3) RETURNING *',
            [name, type || 'Feminino padrão', sort_order]
        );
        const guide = g[0];
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            await pool.query(
                'INSERT INTO size_guide_rows (guide_id, size, bust, waist, hip, low_waist, length, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
                [guide.id, r.size, r.bust, r.waist, r.hip, r.low_waist, r.length, i]
            );
        }
        await logAudit(req.user.id, 'create', 'SizeGuide', guide.id, { name });
        res.status(201).json(guide);
    } catch (e) { next(e); }
});

// Admin: update guide (full replace including rows)
router.patch('/size-guides/:id', auth, requireAdmin, async (req, res, next) => {
    try {
        const { name, type, sort_order, rows } = req.body;
        const { rows: g } = await pool.query(
            'UPDATE size_guides SET name = COALESCE($1, name), type = COALESCE($2, type), sort_order = COALESCE($3, sort_order), updated_at = now() WHERE id = $4 RETURNING *',
            [name, type, sort_order, req.params.id]
        );
        if (g.length === 0) return res.status(404).json({ error: 'Guia não encontrado' });

        if (rows) {
            await pool.query('DELETE FROM size_guide_rows WHERE guide_id = $1', [req.params.id]);
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                await pool.query(
                    'INSERT INTO size_guide_rows (guide_id, size, bust, waist, hip, low_waist, length, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
                    [req.params.id, r.size, r.bust, r.waist, r.hip, r.low_waist, r.length, i]
                );
            }
        }
        await logAudit(req.user.id, 'update', 'SizeGuide', req.params.id, { name });
        res.json(g[0]);
    } catch (e) { next(e); }
});

// Admin: delete guide
router.delete('/size-guides/:id', auth, requireAdmin, async (req, res, next) => {
    try {
        await pool.query('DELETE FROM size_guides WHERE id = $1', [req.params.id]);
        await logAudit(req.user.id, 'delete', 'SizeGuide', req.params.id, {});
        res.json({ success: true });
    } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════
// LOOK PROMOTIONS
// ═══════════════════════════════════════════════════════════

// Public: list active promotions
router.get('/look-promotions', async (req, res, next) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM look_promotions WHERE active = true AND (valid_until IS NULL OR valid_until > now()) ORDER BY created_at DESC'
        );
        res.json(rows);
    } catch (e) { next(e); }
});

// Admin: list all promotions
router.get('/look-promotions/admin', auth, requireAdmin, async (req, res, next) => {
    try {
        const { rows } = await pool.query('SELECT * FROM look_promotions ORDER BY created_at DESC');
        res.json(rows);
    } catch (e) { next(e); }
});

// Admin: create
router.post('/look-promotions', auth, requireAdmin, async (req, res, next) => {
    try {
        const b = req.body;
        const { rows } = await pool.query(
            `INSERT INTO look_promotions (name, type, min_items, discount_percent, discount_fixed, required_categories, eligible_products, eligible_collections, valid_from, valid_until, active, stacks_with_coupon)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
            [b.name, b.type || 'look_discount', b.min_items || 3, b.discount_percent || 0, b.discount_fixed || 0,
             JSON.stringify(b.required_categories || []), JSON.stringify(b.eligible_products || []),
             JSON.stringify(b.eligible_collections || []), b.valid_from, b.valid_until,
             b.active ?? false, b.stacks_with_coupon ?? false]
        );
        await logAudit(req.user.id, 'create', 'LookPromotion', rows[0].id, { name: b.name });
        res.status(201).json(rows[0]);
    } catch (e) { next(e); }
});

// Admin: update
router.patch('/look-promotions/:id', auth, requireAdmin, async (req, res, next) => {
    try {
        const b = req.body;
        const fields = [];
        const vals = [];
        let idx = 1;
        const map = {
            name: 'name', type: 'type', min_items: 'min_items',
            discount_percent: 'discount_percent', discount_fixed: 'discount_fixed',
            active: 'active', stacks_with_coupon: 'stacks_with_coupon',
            valid_from: 'valid_from', valid_until: 'valid_until',
        };
        for (const [k, col] of Object.entries(map)) {
            if (b[k] !== undefined) { fields.push(`${col} = $${idx}`); vals.push(b[k]); idx++; }
        }
        if (b.required_categories !== undefined) { fields.push(`required_categories = $${idx}`); vals.push(JSON.stringify(b.required_categories)); idx++; }
        if (b.eligible_products !== undefined) { fields.push(`eligible_products = $${idx}`); vals.push(JSON.stringify(b.eligible_products)); idx++; }
        if (b.eligible_collections !== undefined) { fields.push(`eligible_collections = $${idx}`); vals.push(JSON.stringify(b.eligible_collections)); idx++; }

        vals.push(req.params.id);
        const { rows } = await pool.query(
            `UPDATE look_promotions SET ${fields.join(', ')}, updated_at = now() WHERE id = $${idx} RETURNING *`,
            vals
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Promoção não encontrada' });
        await logAudit(req.user.id, 'update', 'LookPromotion', req.params.id, { name: b.name });
        res.json(rows[0]);
    } catch (e) { next(e); }
});

// Admin: delete
router.delete('/look-promotions/:id', auth, requireAdmin, async (req, res, next) => {
    try {
        await pool.query('DELETE FROM look_promotions WHERE id = $1', [req.params.id]);
        await logAudit(req.user.id, 'delete', 'LookPromotion', req.params.id, {});
        res.json({ success: true });
    } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════
// INTEGRATIONS STATUS
// ═══════════════════════════════════════════════════════════

router.get('/integrations/status', auth, requireAdmin, (req, res) => {
    const check = (val) => val ? 'Configurado' : 'Não configurado';
    res.json([
        {
            key: 'supabase',
            name: 'Supabase (Banco + Auth + Storage)',
            status: check(process.env.SUPABASE_URL),
            environment: process.env.SUPABASE_URL ? 'Produção' : '—',
            hint: 'Dashboard → Project Settings → API. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.',
        },
        {
            key: 'database',
            name: 'Banco de Dados (PostgreSQL)',
            status: process.env.DATABASE_URL?.includes('supabase') ? 'Configurado (Supabase)' : 'Local (Docker)',
            environment: process.env.DATABASE_URL?.includes('supabase') ? 'Produção' : 'Desenvolvimento',
            hint: 'Use o formato pooler: aws-0-sa-east-1.pooler.supabase.com:6543',
        },
        {
            key: 'mercadoPago',
            name: 'Mercado Pago',
            status: check(process.env.MERCADO_PAGO_ACCESS_TOKEN),
            environment: process.env.MERCADO_PAGO_ACCESS_TOKEN ? 'Produção' : '—',
            hint: 'Mercado Pago Developers → Suas aplicações → Credenciais.',
        },
        {
            key: 'melhorEnvio',
            name: 'Melhor Envio',
            status: check(process.env.MELHOR_ENVIO_TOKEN),
            environment: process.env.MELHOR_ENVIO_TOKEN ? 'Produção' : '—',
            hint: 'Melhor Envio → Configurações → API Tokens.',
        },
        {
            key: 'whatsapp',
            name: 'WhatsApp Business',
            status: check(process.env.WHATSAPP_ACCESS_TOKEN),
            environment: process.env.WHATSAPP_ACCESS_TOKEN ? 'Produção' : '—',
            hint: 'Meta Business → WhatsApp → API Setup. Requer WHATSAPP_ACCESS_TOKEN e WHATSAPP_PHONE_NUMBER_ID.',
        },
        {
            key: 'email',
            name: 'E-mail Transacional (Resend)',
            status: check(process.env.RESEND_API_KEY),
            environment: process.env.RESEND_API_KEY ? 'Produção' : '—',
            hint: 'Resend → API Keys. Defina RESEND_API_KEY e EMAIL_FROM.',
        },
    ]);
});

export default router;
