// Máscaras
export const maskCPF = (v) =>
    (v || "").replace(/\D/g, "").slice(0, 11)
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d{1,2})$/, "$1-$2");

export const maskCEP = (v) =>
    (v || "").replace(/\D/g, "").slice(0, 8).replace(/(\d{5})(\d)/, "$1-$2");

export const maskPhone = (v) =>
    (v || "").replace(/\D/g, "").slice(0, 11)
        .replace(/(\d{2})(\d)/, "($1) $2")
        .replace(/(\d{5})(\d)/, "$1-$2");

// Validadores
export const validateCPF = (cpf) => {
    const clean = (cpf || "").replace(/\D/g, "");
    if (clean.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(clean)) return false;
    let sum = 0, rev;
    for (let i = 0; i < 9; i++) sum += parseInt(clean[i]) * (10 - i);
    rev = 11 - (sum % 11);
    if (rev >= 10) rev = 0;
    if (rev !== parseInt(clean[9])) return false;
    sum = 0;
    for (let i = 0; i < 10; i++) sum += parseInt(clean[i]) * (11 - i);
    rev = 11 - (sum % 11);
    if (rev >= 10) rev = 0;
    return rev === parseInt(clean[10]);
};

export const validateEmail = (email) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((email || "").trim());

export const validatePhone = (phone) => {
    const clean = (phone || "").replace(/\D/g, "");
    return clean.length === 10 || clean.length === 11;
};

export const validateCEP = (cep) => {
    const clean = (cep || "").replace(/\D/g, "");
    return clean.length === 8;
};