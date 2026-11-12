import { Router } from 'express';
import { pool, withTransaction } from '../config/db.js';
import { auth, requireSupabaseAdmin } from '../middleware.js';
import * as mp from '../services/mercadoPago.js';
import { readInstallmentSettings, publicInstallmentPolicy } from '../lib/installmentSettings.js';
import { installmentConfig, installmentDefaults, installmentVersion, effectiveInstallmentPolicy,
    installmentOffers, installmentError, makeInstallmentApproval, installmentApproved,
    assertCompleteInstallmentRange, installmentSettingsLock, strictCents } from '../lib/installmentPolicy.js';

const router = Router();
const fail = (res, e) => res.status(e.status && e.status < 500 ? e.status : 503).json({ error: e.status && e.status < 500 ? e.message : 'Consulta de parcelas indisponível. Tente novamente.' });
router.get('/payments/installment-policy', async (_req, res) => {
    try { res.json(publicInstallmentPolicy(await readInstallmentSettings())); } catch (e) { fail(res, e); }
});
router.get('/admin/payments/installments', auth, requireSupabaseAdmin, async (_req, res) => {
    try {
        const stored = await readInstallmentSettings();
        const config = stored || installmentDefaults;
        res.json({ config: installmentConfig(config), version: installmentVersion(config),
            exists: !!stored,
            approved: installmentApproved(config, mp.getMercadoPagoEnvironment()),
            effective: effectiveInstallmentPolicy(config, mp.getMercadoPagoEnvironment()), environment: mp.getMercadoPagoEnvironment() });
    } catch (e) { fail(res, e); }
});
router.post('/admin/payments/installments/simulate', auth, requireSupabaseAdmin, async (req, res) => {
    try {
        const config = installmentConfig(req.body.config);
        if (!strictCents(req.body.amount) || Number(req.body.amount) > 1000000) throw installmentError('Informe um valor de compra válido.', 400);
        const plans = await mp.getInstallmentPlans({ bin: req.body.bin, amount: req.body.amount });
        const offers = installmentOffers(plans, config, req.body.amount);
        const observed = installmentOffers(plans, { ...config, max_installments: 12, interest_free_installments: 1, allow_interest: true, interest_payer: 'buyer', min_installment_amount: 0 }, req.body.amount);
        res.json({ original_amount: Number(req.body.amount), offers, provider_options: observed,
            environment: mp.getMercadoPagoEnvironment(), estimate: true,
            unavailable_installments: Array.from({ length: config.max_installments }, (_, i) => i + 1).filter(n => !offers.some(o => o.installments === n)),
            note: 'Consulta sem cobrança. Custos da boutique e taxa de processamento dependem das condições da conta; não estão disponíveis nesta consulta.' });
    } catch (e) { fail(res, e); }
});
router.patch('/admin/payments/installments', auth, requireSupabaseAdmin, async (req, res) => {
    try {
        const config = installmentConfig(req.body.config);
        // A fresh provider read must prove any active range, never a client-supplied capability.
        if (config.enabled) assertCompleteInstallmentRange(installmentOffers(await mp.getInstallmentPlans({ bin: req.body.bin, amount: req.body.amount }), config, req.body.amount), config);
        const result = await withTransaction(async client => {
            await client.query(`SELECT pg_advisory_xact_lock(${installmentSettingsLock})`);
            const previous = await readInstallmentSettings(client) || installmentDefaults;
            if (req.body.expected_version !== installmentVersion(previous)) throw installmentError('Configuração alterada por outra administradora. Recarregue antes de salvar.');
            const next = { ...config, module_version: 1, approval: previous.approval || null };
            if (config.enabled && !installmentApproved(next, mp.getMercadoPagoEnvironment())) throw installmentError('Homologação e aprovação comercial explícita necessárias antes da ativação.');
            const { rows } = await client.query(`INSERT INTO settings (key,value,is_public,updated_by) VALUES ('credit_installments',$1,false,$2)
                ON CONFLICT (key) DO UPDATE SET value=$1,is_public=false,updated_by=$2,updated_at=now() RETURNING id`, [JSON.stringify(next), req.user.id]);
            await client.query(`INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, changes, ip_address)
                VALUES ($1,'installments.config','setting',$2,$3,$4)`, [req.user.id, rows[0].id, JSON.stringify({ before: installmentConfig(previous), after: config }), req.ip]);
            return { config, version: installmentVersion(next), approved: installmentApproved(next, mp.getMercadoPagoEnvironment()) };
        });
        res.json(result);
    } catch (e) { fail(res, e); }
});
// Explicit future commercial approval, separated from draft editing; does not activate the offer.
router.post('/admin/payments/installments/approve', auth, requireSupabaseAdmin, async (req, res) => {
    try {
        if (req.body.commercial_approved !== true || req.body.financial_homologated !== true) throw installmentError('Confirme aprovação dos custos e homologação financeira.');
        const config = installmentConfig(req.body.config);
        assertCompleteInstallmentRange(installmentOffers(await mp.getInstallmentPlans({ bin: req.body.bin, amount: req.body.amount }), config, req.body.amount), config);
        await withTransaction(async client => {
            await client.query(`SELECT pg_advisory_xact_lock(${installmentSettingsLock})`);
            const current = await readInstallmentSettings(client);
            if (!current) throw installmentError('Salve a proposta antes de aprovar.');
            if (req.body.expected_version !== installmentVersion(current) || installmentVersion(config) !== installmentVersion(current)) throw installmentError('Salve a proposta e recarregue antes de aprovar.');
            const next = { ...config, enabled: false, module_version: 1,
                approval: makeInstallmentApproval(config, mp.getMercadoPagoEnvironment(), req.user.id) };
            await client.query("UPDATE settings SET value=$1,updated_by=$2,updated_at=now() WHERE key='credit_installments'", [JSON.stringify(next), req.user.id]);
            await client.query(`INSERT INTO audit_logs (admin_id,action,entity_type,changes,ip_address)
                VALUES ($1,'installments.approve','setting',$2,$3)`, [req.user.id, JSON.stringify({ environment: next.approval.environment, scope: next.approval.scope }), req.ip]);
        });
        res.json({ approved: true, enabled: false });
    } catch (e) { fail(res, e); }
});
router.post('/orders/:id/payment/installments', auth, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Autenticação necessária' });
        const { rows } = await pool.query('SELECT * FROM orders WHERE id=$1', [req.params.id]);
        const order = rows[0];
        if (!order || (req.user.role !== 'admin' && order.user_id !== req.user.id)) return res.status(404).json({ error: 'Pedido não encontrado' });
        if (order.payment_method !== 'credito' || order.payment_status !== 'pending' || order.payment_attempt_started_at || order.mercado_pago_order_id || order.status === 'cancelado') throw installmentError('Este pedido não aceita uma nova oferta de parcelamento.');
        const config = await readInstallmentSettings() || installmentDefaults;
        const effective = effectiveInstallmentPolicy(config, mp.getMercadoPagoEnvironment());
        const plans = await mp.getInstallmentPlans({ bin: req.body.bin, amount: order.total });
        const offers = installmentOffers(plans, config, order.total).filter(o => o.installments <= effective.max_installments);
        res.json({ offers, policy_version: installmentVersion(config), max_installments: effective.max_installments });
    } catch (e) { fail(res, e); }
});
export default router;
