import { httpsOrigin, instagramLink, whatsappLink, validEmail, validCnpjFormat } from './navigation.js';

export const PUBLIC_SETTING_FIELDS = {
    general: ['store_name', 'trade_name', 'company_name', 'cnpj', 'email', 'phone', 'whatsapp', 'logo', 'logo_dark', 'public_address', 'business_hours', 'external_link_origins'],
    store: ['top_bar_text', 'free_shipping_threshold', 'max_installments', 'interest_free_installments'],
    shipping: ['free_shipping_enabled', 'free_shipping_threshold', 'pickup_enabled', 'pickup_name', 'pickup_time', 'pickup_address', 'pickup_instructions'],
    social: ['instagram', 'facebook', 'tiktok', 'whatsapp'],
    seo: ['default_title', 'default_description', 'sharing_image', 'ga_id', 'meta_pixel_id'],
    policies: ['return_policy', 'privacy_policy', 'terms_of_use', 'shipping_policy'],
    maintenance: ['maintenance_mode'],
};

export function publicSetting(row) {
    const fields = PUBLIC_SETTING_FIELDS[row.key];
    if (!fields || row.is_public !== true) return null;
    const value = {};
    for (const field of fields) if (Object.hasOwn(row.value || {}, field)) value[field] = row.value[field];
    return { id: row.id, key: row.key, value, is_public: true };
}

export function validateSettingValue(key, value) {
    const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Configuração inválida.');
    const textKeys = {
        general: ['store_name', 'trade_name', 'company_name', 'cnpj', 'phone', 'public_address', 'business_hours'],
        shipping: ['pickup_address', 'pickup_instructions', 'pickup_time', 'pickup_name'],
        emails: ['sender_name'],
        policies: ['return_policy', 'privacy_policy', 'terms_of_use', 'shipping_policy'],
    };
    for (const field of textKeys[key] || []) {
        if (value[field] !== undefined && (typeof value[field] !== 'string' || value[field].length > (key === 'policies' ? 50000 : 4000))) invalid(`Campo ${field} inválido.`);
    }
    for (const field of key === 'emails' ? ['sender_email', 'reply_to'] : key === 'general' ? ['email'] : []) {
        if (value[field] && !validEmail(value[field])) invalid(`Campo ${field} deve ser um e-mail válido.`);
    }
    if (key === 'general') {
        if (value.cnpj && !validCnpjFormat(value.cnpj)) invalid('Formato de CNPJ inválido.');
        if (value.whatsapp && !whatsappLink(value.whatsapp)) invalid('WhatsApp inválido.');
        if (value.external_link_origins !== undefined && (!Array.isArray(value.external_link_origins) || value.external_link_origins.length > 20 || value.external_link_origins.some(origin => !httpsOrigin(origin)))) invalid('Informe apenas origens HTTPS autorizadas, sem caminho ou credenciais.');
    }
    if (key === 'shipping' && value.melhor_envio_extra_days != null
        && (!Number.isInteger(value.melhor_envio_extra_days) || value.melhor_envio_extra_days < 0 || value.melhor_envio_extra_days > 365)) {
        invalid('Preparação deve ser um número inteiro de dias úteis entre 0 e 365.');
    }
    if (key === 'social') {
        if (value.instagram && !instagramLink(value.instagram)) invalid('Instagram inválido.');
        if (value.whatsapp && !whatsappLink(value.whatsapp)) invalid('WhatsApp inválido.');
        for (const field of ['facebook', 'tiktok']) {
            if (value[field]) {
                try {
                    const url = new URL(value[field]);
                    if (!httpsOrigin(url.origin) || url.username || url.password || /[\\\u0000-\u001f]/.test(value[field])) invalid(`Link ${field} inválido.`);
                } catch { invalid(`Link ${field} inválido.`); }
            }
        }
    }
}
