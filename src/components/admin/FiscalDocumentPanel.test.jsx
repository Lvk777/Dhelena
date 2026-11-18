// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import FiscalDocumentPanel from './FiscalDocumentPanel';

vi.mock('@/api/base44Client', () => ({ base44: { functions: { invoke: vi.fn() } } }));

afterEach(cleanup);

test('a failed document lookup shows the error without offering an unsafe second import', () => {
    render(<FiscalDocumentPanel order={{ id: 'order-1' }} document={null}
        loadError="Não foi possível consultar a nota fiscal." onChanged={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível consultar');
    expect(screen.queryByText(/NF-e .* série/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Importar nota fiscal' })).toBeNull();
});

test('manual official verification requires checking both status and complete fiscal content', () => {
    const document = { access_key: '1'.repeat(44), differences: [], status: 'pending_official',
        data: { number: '19', series: '1', issuedAt: '2026-11-18T12:00:00Z', protocol: '2'.repeat(15),
            issuerName: 'Emitente', issuerCnpj: '12345678000199', recipientName: 'Cliente',
            recipientDocument: '12345678909', productCents: 3000, shippingCents: 998,
            totalCents: 3998, items: [{ name: 'Peça', quantity: 1, productCents: 3000 }] } };
    render(<FiscalDocumentPanel order={{ id: 'order-1' }} document={document} onChanged={vi.fn()} />);
    const submit = screen.getByRole('button', { name: 'Registrar conferência oficial' });
    fireEvent.change(screen.getByLabelText('Chave vista no portal'), { target: { value: document.access_key } });
    fireEvent.change(screen.getByLabelText('Protocolo visto no portal'), { target: { value: document.data.protocol } });
    fireEvent.click(screen.getByLabelText(/consulta oficial mostra esta NF-e autorizada/));
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Comparei no documento oficial emitente/));
    expect(submit.disabled).toBe(false);
});
