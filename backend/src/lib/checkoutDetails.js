import { addressInput } from './customerAddress.js';
import { validCpf } from './paymentPayer.js';

const invalid = message => Object.assign(new Error(message), { status: 400 });
const clean = value => typeof value === 'string' ? value.trim() : '';
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The browser form is for usability, never the source of truth. Orders must
 * also be complete when created directly against the authenticated API.
 * This is intentionally read-only: a validation failure cannot reserve stock.
 */
export function assertCheckoutDetails(body) {
    const customer = body?.customer;
    if (!customer || typeof customer !== 'object' || Array.isArray(customer)) {
        throw invalid('Preencha seus dados antes de concluir a compra.');
    }
    const name = clean(customer.name);
    const email = clean(customer.email);
    const cpf = clean(customer.cpf).replace(/\D/g, '');
    const phone = clean(customer.phone).replace(/\D/g, '');
    if (!name || name.length > 150 || /[\u0000-\u001f]/.test(name)) {
        throw invalid('Informe seu nome completo.');
    }
    if (!email || email.length > 254 || !emailPattern.test(email)) {
        throw invalid('Informe um e-mail válido.');
    }
    if (!validCpf(cpf)) throw invalid('Informe um CPF válido.');
    if (!/^[1-9][0-9][0-9]{8,9}$/.test(phone)) {
        throw invalid('Informe um telefone com DDD válido.');
    }

    // Reuse the address-book validator, so saved addresses and checkout obey
    // the same CEP/UF/required-field rules. Complements remain optional.
    addressInput(body?.shipping_address, false);
    return true;
}
