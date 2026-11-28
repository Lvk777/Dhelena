import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCheckoutDetails } from '../src/lib/checkoutDetails.js';

const complete = () => ({
    customer: { name: 'Compradora de Teste', email: 'compradora@example.test',
        cpf: '123.456.789-09', phone: '(11) 91234-5678' },
    shipping_address: { cep: '01001-000', street: 'Rua de Teste', number: '10',
        complement: '', district: 'Centro', city: 'São Paulo', state: 'SP' },
});

test('conta autenticada ainda precisa de dados completos antes de criar um pedido', () => {
    assert.equal(assertCheckoutDetails(complete()), true);
    for (const field of ['name', 'email', 'cpf', 'phone']) {
        const body = complete();
        body.customer[field] = '';
        assert.throws(() => assertCheckoutDetails(body), { status: 400 });
    }
    for (const field of ['cep', 'street', 'number', 'district', 'city', 'state']) {
        const body = complete();
        body.shipping_address[field] = '';
        assert.throws(() => assertCheckoutDetails(body), { status: 400 });
    }
});

test('CPF, telefone, UF e dados malformados não chegam à criação do pedido', () => {
    for (const change of [
        body => { body.customer.cpf = '111.111.111-11'; },
        body => { body.customer.phone = '123'; },
        body => { body.customer.email = 'invalido'; },
        body => { body.shipping_address.state = 'XX'; },
        body => { body.shipping_address.cep = '12'; },
        body => { body.shipping_address.untrusted = 'valor'; },
    ]) {
        const body = complete();
        change(body);
        assert.throws(() => assertCheckoutDetails(body), { status: 400 });
    }
});
