/** Parse a user-entered birth date without relying on JavaScript's permissive Date parser. */
export function normalizeBirthDate(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') throw Object.assign(new Error('Data de nascimento inválida'), { status: 400 });

    const match = value.match(/^(?:(\d{2})\/(\d{2})\/(\d{4})|(\d{4})-(\d{2})-(\d{2}))$/);
    if (!match) throw Object.assign(new Error('Use a data de nascimento no formato DD/MM/AAAA'), { status: 400 });

    const day = Number(match[1] || match[6]);
    const month = Number(match[2] || match[5]);
    const year = Number(match[3] || match[4]);
    const today = new Date();
    const currentYear = today.getUTCFullYear();
    if (year < 1900 || year > currentYear) {
        throw Object.assign(new Error('Ano de nascimento inválido'), { status: 400 });
    }

    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day || parsed > today) {
        throw Object.assign(new Error('Data de nascimento inválida'), { status: 400 });
    }
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
