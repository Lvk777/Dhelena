// Known legacy test fixtures must not be represented as customer policies.
// Draft policies live only in docs/policies until explicitly approved.
export function publishedPolicyText(value) {
    if (typeof value !== 'string') return '';
    const text = value.trim();
    if (text === 'Política de troca via API'
        || text.startsWith('Esta é uma política de privacidade de teste.')) return '';
    return text;
}
