import { Router } from 'express';
import { pool } from '../config/db.js';
import { auth, requireAdmin } from '../middleware.js';
import { logAudit } from '../services.js';
import { encrypt, decrypt, maskSecret, isSensitive } from '../lib/crypto.js';

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
// LOOK PROMOTIONS (extended with campaign fields)
// ═══════════════════════════════════════════════════════════

const PROMO_FIELDS = [
    'name', 'title', 'subtitle', 'type', 'promo_type', 'min_items',
    'discount_percent', 'discount_fixed', 'free_shipping', 'buy_quantity',
    'min_value', 'applicable_category', 'applicable_collection',
    'required_categories', 'eligible_products', 'eligible_collections',
    'valid_from', 'valid_until', 'active', 'stacks_with_coupon',
    'priority', 'campaign_color', 'banner_image', 'short_text'
];

const PROMO_JSONB = ['required_categories', 'eligible_products', 'eligible_collections'];

// Public: list active promotions (ordered by priority)
router.get('/look-promotions', async (req, res, next) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM look_promotions WHERE active = true AND (valid_until IS NULL OR valid_until > now()) AND (valid_from IS NULL OR valid_from <= now()) ORDER BY priority DESC, created_at DESC'
        );
        res.json(rows);
    } catch (e) { next(e); }
});

// Admin: list all promotions
router.get('/look-promotions/admin', auth, requireAdmin, async (req, res, next) => {
    try {
        const { rows } = await pool.query('SELECT * FROM look_promotions ORDER BY priority DESC, created_at DESC');
        res.json(rows);
    } catch (e) { next(e); }
});

// Admin: create
router.post('/look-promotions', auth, requireAdmin, async (req, res, next) => {
    try {
        const b = req.body;
        const cols = [], ph = [], vals = [];
        let idx = 1;
        for (const f of PROMO_FIELDS) {
            if (b[f] !== undefined) {
                cols.push(f);
                ph.push(`$${idx}`);
                vals.push(PROMO_JSONB.includes(f) ? JSON.stringify(b[f]) : b[f]);
                idx++;
            }
        }
        const { rows } = await pool.query(
            `INSERT INTO look_promotions (${cols.join(', ')}) VALUES (${ph.join(', ')}) RETURNING *`,
            vals
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
        for (const f of PROMO_FIELDS) {
            if (b[f] !== undefined) {
                fields.push(`${f} = $${idx}`);
                vals.push(PROMO_JSONB.includes(f) ? JSON.stringify(b[f]) : b[f]);
                idx++;
            }
        }
        if (fields.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar' });
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
// INTEGRATION CONFIGS (encrypted secrets, admin-only)
// ═══════════════════════════════════════════════════════════

/**
 * Build the frontend-safe response for an integration config.
 * Sensitive values are NEVER returned — only:
 *   - configured: true/false
 *   - masked_value: ****8F2A (last 4 chars of decrypted value)
 *   - For non-sensitive fields: the actual value
 */
function buildSafeConfig(row) {
    const safeConfig = {};
    for (const [k, v] of Object.entries(row.config_data || {})) {
        if (isSensitive(k)) {
            // Decrypt the stored value to check if it's real
            const decrypted = decrypt(v);
            safeConfig[k] = {
                configured: !!decrypted,
                masked_value: decrypted ? maskSecret(decrypted) : '',
            };
        } else {
            safeConfig[k] = v;
        }
    }
    return {
        id: row.id,
        service_key: row.service_key,
        service_name: row.service_name,
        description: row.description,
        config_data: safeConfig,
        is_active: row.is_active,
        updated_at: row.updated_at,
    };
}

// Admin: list all integration configs (masked, never real secrets)
router.get('/integrations/config', auth, requireAdmin, async (req, res, next) => {
    try {
        const { rows } = await pool.query('SELECT * FROM integration_configs ORDER BY service_name');
        res.json(rows.map(buildSafeConfig));
    } catch (e) { next(e); }
});

// Admin: upsert integration config (encrypts sensitive values)
router.put('/integrations/config/:serviceKey', auth, requireAdmin, async (req, res, next) => {
    try {
        const { serviceKey } = req.params;
        const { service_name, description, config_data, is_active } = req.body;

        // Fetch existing config to preserve secrets when field is left blank
        const { rows: existing } = await pool.query(
            'SELECT config_data, is_active FROM integration_configs WHERE service_key = $1', [serviceKey]
        );
        const wasActive = existing.length > 0 ? existing[0].is_active : false;

        let finalConfig = {};
        if (existing.length > 0) {
            finalConfig = { ...existing[0].config_data };
        }

        for (const [k, incomingVal] of Object.entries(config_data)) {
            if (isSensitive(k)) {
                // Sensitive field: only update if a non-empty string is provided
                if (typeof incomingVal === 'string' && incomingVal.trim() !== '' && !incomingVal.includes('****')) {
                    finalConfig[k] = encrypt(incomingVal.trim());
                }
                // If empty or masked → keep existing encrypted value (already in finalConfig)
            } else {
                // Non-sensitive: update directly
                if (incomingVal !== undefined) finalConfig[k] = incomingVal;
            }
        }

        const { rows } = await pool.query(
            `INSERT INTO integration_configs (service_key, service_name, description, config_data, is_active)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (service_key) DO UPDATE SET
                service_name = COALESCE($2, service_name),
                description = COALESCE($3, description),
                config_data = $4,
                is_active = COALESCE($5, is_active),
                updated_at = now()
             RETURNING *`,
            [serviceKey, service_name, description, JSON.stringify(finalConfig), is_active ?? false]
        );
        const result = rows[0];

        // Audit: created vs updated
        const isNew = existing.length === 0;
        await logAudit(req.user.id, isNew ? 'integration_created' : 'integration_updated', 'IntegrationConfig', serviceKey, { service_name });
        // If active status changed, log enable/disable
        if (result.is_active !== wasActive) {
            await logAudit(req.user.id, result.is_active ? 'integration_enabled' : 'integration_disabled', 'IntegrationConfig', serviceKey, { service_name });
        }

        res.json(buildSafeConfig(result));
    } catch (e) { next(e); }
});

// Admin: toggle integration active status
router.patch('/integrations/config/:serviceKey/toggle', auth, requireAdmin, async (req, res, next) => {
    try {
        const { serviceKey } = req.params;
        const { rows: existing } = await pool.query(
            'SELECT is_active, service_name FROM integration_configs WHERE service_key = $1', [serviceKey]
        );
        if (existing.length === 0) return res.status(404).json({ error: 'Integração não encontrada' });
        const wasActive = existing[0].is_active;

        const { rows } = await pool.query(
            'UPDATE integration_configs SET is_active = NOT is_active, updated_at = now() WHERE service_key = $1 RETURNING *',
            [serviceKey]
        );
        const result = rows[0];

        // Audit: enabled or disabled
        if (result.is_active !== wasActive) {
            await logAudit(req.user.id, result.is_active ? 'integration_enabled' : 'integration_disabled', 'IntegrationConfig', serviceKey, { service_name: result.service_name });
        }

        res.json(buildSafeConfig(result));
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
