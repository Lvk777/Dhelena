import { createHash } from 'node:crypto';

export const installmentDefaults = { enabled: false, max_installments: 12, interest_free_installments: 6,
    allow_interest: true, interest_payer: 'buyer', min_installment_amount: 0, commercial_message: '' };
export const installmentSettingsLock = "hashtextextended('credit-installment-settings', 0)";
const fields = Object.keys(installmentDefaults);
export function installmentError(message, status = 409) { return Object.assign(new Error(message), { status }); }
export function installmentConfig(input = {}) {
    const c = Object.fromEntries(fields.map(key => [key, input[key] ?? installmentDefaults[key]]));
    if (typeof c.enabled !== 'boolean' || typeof c.allow_interest !== 'boolean'
        || !Number.isInteger(c.max_installments) || c.max_installments < 1 || c.max_installments > 12
        || !Number.isInteger(c.interest_free_installments) || c.interest_free_installments < 1 || c.interest_free_installments > c.max_installments
        || !['seller', 'buyer'].includes(c.interest_payer)
        || typeof c.min_installment_amount !== 'number' || !Number.isFinite(c.min_installment_amount)
        || c.min_installment_amount < 0 || c.min_installment_amount > 1000000
        || Math.abs(c.min_installment_amount * 100 - Math.round(c.min_installment_amount * 100)) > 0.00001
        || typeof c.commercial_message !== 'string' || c.commercial_message.length > 240
        || /[<>\u0000-\u001f]/.test(c.commercial_message)) throw installmentError('Condições de parcelamento inválidas.', 400);
    for (const claim of c.commercial_message.matchAll(/(\d+)\s*(?:x|parcelas?)(?:\s+sem\s+juros)?/gi)) {
        if (Number(claim[1]) > (/sem\s+juros/i.test(claim[0]) ? c.interest_free_installments : c.max_installments)) throw installmentError('A mensagem anuncia parcelas acima da condição configurada.', 400);
    }
    if (/garantid|qualquer cartão|todos os cartões|sempre sem juros/i.test(c.commercial_message)) throw installmentError('A mensagem deve respeitar a disponibilidade do cartão.', 400);
    return c;
}
export function installmentVersion(input) {
    return createHash('sha256').update(JSON.stringify(installmentConfig(input))).digest('hex');
}
function approvalScope(c) {
    return JSON.stringify([c.max_installments, c.interest_free_installments, c.allow_interest, c.interest_payer]);
}
export function installmentApproved(input, environment) {
    const c = installmentConfig(input);
    return input?.approval?.homologated === true && input.approval.environment === environment
        && input.approval.scope === approvalScope(c);
}
export function makeInstallmentApproval(config, environment, adminId) {
    return { homologated: true, environment, scope: approvalScope(installmentConfig(config)),
        approved_by: adminId, approved_at: new Date().toISOString() };
}
export function effectiveInstallmentPolicy(input, environment) {
    const c = installmentConfig(input);
    const approved = installmentApproved(input, environment);
    return { ...c, enabled: c.enabled && approved, max_installments: c.enabled && approved ? c.max_installments : 1,
        interest_free_approved: c.enabled && approved && c.interest_free_installments > 1,
        policy_version: installmentVersion(c), approval_required: !approved };
}
export function strictCents(value) {
    if (!['number', 'string'].includes(typeof value) || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) return null;
    const cents = Math.round(Number(value) * 100);
    return Number.isSafeInteger(cents) ? cents : null;
}
export function installmentOffers(plans, input, original, { paymentMethodId, issuerId } = {}) {
    const c = installmentConfig(input), base = strictCents(original);
    if (!base || !Array.isArray(plans)) throw installmentError('Valor ou oferta de parcelamento indisponível.');
    const offers = [];
    for (const plan of plans) {
        if (!plan.payment_method_id || !plan.issuer?.id || (plan.payment_type_id && plan.payment_type_id !== 'credit_card')
            || (paymentMethodId && plan.payment_method_id !== paymentMethodId)
            || (issuerId && String(plan.issuer.id) !== String(issuerId))) continue;
        for (const cost of plan.payer_costs || []) {
            const n = cost.installments, total = strictCents(cost.total_amount), part = strictCents(cost.installment_amount);
            const rate = typeof cost.installment_rate === 'number' ? cost.installment_rate
                : typeof cost.installment_rate === 'string' && /^\d+(?:\.\d+)?$/.test(cost.installment_rate) ? Number(cost.installment_rate) : NaN;
            if (!Number.isInteger(n) || n < 1 || n > c.max_installments || total === null || total < base
                || part === null || part < Math.round(c.min_installment_amount * 100)
                || !Number.isFinite(rate) || rate < 0 || (rate === 0) !== (total === base)
                || Math.abs(part * n - total) > n - 1) continue;
            const zeroRequired = n <= c.interest_free_installments || !c.allow_interest || c.interest_payer === 'seller';
            if (zeroRequired && rate !== 0) continue;
            if (n === 1 && rate !== 0) continue;
            offers.push({ policy_version: installmentVersion(c), original_amount: base / 100,
                payment_method_id: plan.payment_method_id, issuer_id: String(plan.issuer.id), installments: n,
                installment_amount: part / 100, buyer_interest_rate: rate, buyer_interest_amount: (total - base) / 100,
                buyer_total: total / 100, merchant_financing_cost: null, processing_fee: null, merchant_net: null });
        }
    }
    return offers;
}
export function assertCompleteInstallmentRange(offers, config) {
    for (let n = 1; n <= config.max_installments; n++) {
        if (!offers.some(offer => offer.installments === n)) throw installmentError(`O provedor não confirmou ${n}x nas condições propostas. Ajuste a conta ou reduza a faixa.`);
    }
    const groups = new Map();
    for (const offer of offers) {
        const key = `${offer.payment_method_id}:${offer.issuer_id}`;
        if (!groups.has(key)) groups.set(key, new Set());
        groups.get(key).add(offer.installments);
    }
    if (![...groups.values()].some(counts => Array.from({ length: config.max_installments }, (_, i) => i + 1).every(n => counts.has(n)))) {
        throw installmentError('O provedor não confirmou a faixa completa para a mesma bandeira e emissor.');
    }
}
export function confirmInstallmentOffer(offers, expected, method, issuer, n) {
    const offer = offers.find(o => o.payment_method_id === method && o.issuer_id === String(issuer) && o.installments === n);
    if (!offer || !expected || Object.keys(offer).some(key => offer[key] !== expected[key])) {
        throw installmentError('As condições ou o total das parcelas mudaram. Consulte novamente antes de confirmar.');
    }
    return offer;
}
