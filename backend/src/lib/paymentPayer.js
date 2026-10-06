function nonEmpty(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

// Remove absent optional values at every level without changing required payment fields.
export function omitEmptyOptional(value) {
    if (Array.isArray(value)) return value.map(omitEmptyOptional);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value)
            .map(([key, item]) => [key, omitEmptyOptional(item)])
            .filter(([, item]) => item !== undefined
                && !(item && !Array.isArray(item) && typeof item === 'object' && !Object.keys(item).length)));
    }
    if (value === null || value === undefined) return undefined;
    return typeof value === 'string' ? nonEmpty(value) : value;
}

function validCpf(number) {
    if (!/^\d{11}$/.test(number) || /^(\d)\1{10}$/.test(number)) return false;
    const check = (length) => {
        const sum = [...number.slice(0, length)].reduce((total, digit, index) => total + Number(digit) * (length + 1 - index), 0);
        return (sum * 10 % 11) % 10;
    };
    return check(9) === Number(number[9]) && check(10) === Number(number[10]);
}

export function normalizePayer(payer = {}) {
    const email = nonEmpty(payer.email);
    const firstName = nonEmpty(payer.first_name);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !firstName) {
        throw Object.assign(new Error('Dados do pagador incompletos'), { status: 400, code: 'INVALID_PAYER' });
    }
    const identification = payer.identification;
    const type = nonEmpty(identification?.type);
    const number = typeof identification?.number === 'string' ? identification.number.replace(/\D/g, '') : '';
    return omitEmptyOptional({
        email,
        first_name: firstName,
        last_name: nonEmpty(payer.last_name),
        identification: type === 'CPF' && validCpf(number) ? { type, number } : undefined,
    });
}

export function payerFromOrder(order, user) {
    const customer = order.snapshot?.customer || {};
    const parts = (nonEmpty(customer.name) || nonEmpty(user.full_name) || '').split(/\s+/).filter(Boolean);
    return normalizePayer({
        email: nonEmpty(customer.email) || nonEmpty(user.email),
        first_name: parts[0],
        last_name: parts.slice(1).join(' '),
        identification: { type: 'CPF', number: customer.cpf },
    });
}
