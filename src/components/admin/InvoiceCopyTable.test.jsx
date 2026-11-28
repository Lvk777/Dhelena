// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import InvoiceCopyTable, { invoiceCopyGroups } from './InvoiceCopyTable';

const order = {
    order_number: 'DH-2026-000019',
    shipping_address: { street: 'Rua Exemplo', number: '65', district: 'Centro', city: 'Cotia', state: 'SP', cep: '06708000' },
    snapshot: { customer: { name: 'Cliente de Exemplo', cpf: '12345678901', email: 'cliente@example.test', phone: '11912345678' } },
    items: [{ product_name: 'Shorts Angel', product_sku: '2026@', color_name: 'Bege', size: 'P', quantity: 1, unit_price: 30, subtotal: 30 }],
    subtotal: 30, discount: 0, shipping_cost: 9.98, total: 39.98,
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test('shows only known order data and copies each clicked fiscal value individually', async () => {
    const writeText = vi.fn().mockResolvedValue();
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<InvoiceCopyTable order={order} />);

    expect(screen.getByText('Dados para emissão da NF-e')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar Nome completo: Cliente de Exemplo' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Cliente de Exemplo'));
    fireEvent.click(screen.getByRole('button', { name: 'Copiar Descrição cadastrada: Shorts Angel' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Shorts Angel'));
    fireEvent.click(screen.getByRole('button', { name: 'Copiar Frete: R$ 9,98' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('9,98'));
    expect(writeText).toHaveBeenCalledTimes(3);
    expect(screen.getByText(/Valor copiado/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copiar SKU interno (referência): 2026@' })).toBeTruthy();
});

test('shows the fiscal table expanded by default and lets Juliane collapse and reopen it', async () => {
    render(<InvoiceCopyTable order={order} />);
    const section = screen.getByLabelText('Dados para emissão da nota fiscal');
    const header = screen.getByText('Dados para emissão da NF-e');
    expect(section.open).toBe(true);
    expect(screen.getByRole('button', { name: 'Copiar Nome completo: Cliente de Exemplo' })).toBeTruthy();

    fireEvent.click(header);
    await waitFor(() => expect(section.open).toBe(false));
    fireEvent.click(header);
    await waitFor(() => expect(section.open).toBe(true));
});

test('does not invent missing CPF, SKU, fiscal classification or amounts', () => {
    const groups = invoiceCopyGroups({ items: [{ product_name: 'Peça' }] });
    const flattened = groups.flatMap(group => group.rows);
    expect(flattened.find(([label]) => label === 'CPF')[1]).toBeUndefined();
    expect(flattened.find(([label]) => label === 'SKU interno (referência)')[1]).toBeUndefined();
    expect(flattened.find(([label]) => label === 'Valor unitário')[1]).toBe('');
    expect(flattened.find(([label]) => label === 'Subtotal do item')[1]).toBe('');
    expect(flattened.some(([label]) => ['NCM', 'CFOP'].includes(label))).toBe(false);
});

test('reports clipboard failures without claiming the value was copied', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Permission denied')) } });
    render(<InvoiceCopyTable order={order} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar CPF: 12345678901' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Não foi possível copiar CPF/));
    expect(screen.queryByText('Valor copiado. Agora você pode colá-lo no emissor da NF-e.')).toBeNull();
});

test('shows the selected carrier fiscal identity and lets Juliane copy its CNPJ for NFF', async () => {
    const writeText = vi.fn().mockResolvedValue();
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const shippingOrder = { ...order, shipping_method: 'melhor_envio', shipping_carrier: 'Jadlog', shipping_service_name: '.Package' };
    render(<InvoiceCopyTable order={shippingOrder} />);

    expect(screen.getByText('Transportadora selecionada no checkout')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copiar Serviço contratado: .Package' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copiar Razão social: JADLOG LOGISTICA S.A' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar CNPJ do transportador: 04.884.082/0001-35' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('04.884.082/0001-35'));
    expect(screen.getByRole('button', { name: 'Copiar Inscrição estadual do transportador: 149.744.148.111' })).toBeTruthy();
});

test('does not invent fiscal IDs for an unrecognized carrier or a non-Melhor Envio order', () => {
    const unknown = { ...order, shipping_method: 'melhor_envio', shipping_carrier: 'Transportadora ainda não cadastrada' };
    const groups = invoiceCopyGroups(unknown);
    const transport = groups.find(group => group.title === 'Transportadora selecionada no checkout');
    expect(transport.rows.find(([label]) => label === 'CNPJ do transportador')[1]).toBeUndefined();
    render(<InvoiceCopyTable order={unknown} />);
    expect(screen.getByRole('alert').textContent).toMatch(/Não foi possível identificar/);
    expect(screen.queryByRole('button', { name: /Copiar CNPJ do transportador/ })).toBeNull();
    expect(invoiceCopyGroups(order).some(group => group.title === 'Transportadora selecionada no checkout')).toBe(false);
});
