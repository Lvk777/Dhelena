/** Parse a user-entered birth date without relying on JavaScript's permissive Date parser. */
export function normalizeProfileInput(body) {
    const fail = () => Object.assign(new Error('Dados pessoais inválidos'), { status:400 });
    if (!body || Object.keys(body).some(k=>!['full_name','phone','cpf','birth_date'].includes(k))) throw fail();
    const output = {};
    for (const key of ['full_name','phone','cpf']) if (body[key] !== undefined && body[key] !== null && body[key] !== '') {
        if (typeof body[key] !== 'string' || body[key].length > 150 || /[\u0000-\u001f]/.test(body[key])) throw fail();
        output[key] = key === 'full_name' ? body[key].trim() : body[key].replace(/\D/g,'');
    }
    if (output.full_name === '' || (output.phone && !/^[1-9]\d{9,10}$/.test(output.phone))) throw fail();
    if (output.cpf) {
        const cpf=output.cpf;
        if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) throw fail();
        for (const length of [9,10]) {
            let sum=0; for(let i=0;i<length;i++) sum+=Number(cpf[i])*(length+1-i);
            const digit=(sum*10)%11; if (Number(cpf[length]) !== (digit===10?0:digit)) throw fail();
        }
    }
    output.birth_date=normalizeBirthDate(body.birth_date);
    return output;
}

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
