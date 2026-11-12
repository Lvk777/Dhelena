import { pool } from '../config/db.js';
import { installmentDefaults, effectiveInstallmentPolicy } from './installmentPolicy.js';
import { getMercadoPagoEnvironment } from '../services/mercadoPago.js';

export async function readInstallmentSettings(client = pool) {
    const { rows } = await client.query("SELECT value FROM settings WHERE key = 'credit_installments'");
    return rows[0]?.value?.module_version === 1 ? rows[0].value : null;
}
export function publicInstallmentPolicy(config) {
    const p = effectiveInstallmentPolicy(config || installmentDefaults, getMercadoPagoEnvironment());
    return { max_installments: p.max_installments, interest_free_approved: p.interest_free_approved,
        installment_policy_managed: true, policy_version: p.policy_version,
        commercial_message: p.enabled ? `${p.commercial_message || `Crédito em até ${p.max_installments}x.`} Condições e juros sujeitos às opções disponíveis para seu cartão.` : '' };
}
