// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import FiscalDocumentPanel from './FiscalDocumentPanel';
import { base44 } from '@/api/base44Client';

vi.mock('@/api/base44Client', () => ({ base44: { functions: { invoke: vi.fn() } } }));

afterEach(cleanup);

test('a failed document lookup shows the error without offering an unsafe second import', () => {
    render(<FiscalDocumentPanel order={{ id: 'order-1' }} document={null}
        loadError="Não foi possível consultar a nota fiscal." onChanged={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível consultar');
    expect(screen.queryByText(/NF-e .* série/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Importar XML' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Preencher manualmente' })).toBeNull();
});

test('manual form records data for review without verification or issuing a document', async () => {
    const onChanged = vi.fn();
    base44.functions.invoke.mockResolvedValueOnce({ id: 'document-1', origin: 'manual', status: 'pending_official' });
    render(<FiscalDocumentPanel order={{ id: 'order-1' }} document={null} onChanged={onChanged} />);
    expect(screen.getByRole('button', { name: 'Importar XML' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Preencher manualmente' }));
    const values = [
        ['Chave de acesso (44 dígitos)', '1'.repeat(44)], ['Número da NF-e', '19'], ['Série', '1'],
        ['Data e hora de emissão', '2026-11-18T12:00'], ['Protocolo de autorização (15 dígitos)', '2'.repeat(15)],
        ['CNPJ do emitente', '12345678000199'], ['Nome do emitente', 'Emitente'],
        ['CPF ou CNPJ do destinatário', '12345678909'], ['Nome do destinatário', 'Cliente'],
        ['Descrição', 'Peça'], ['Valor total do item (R$)', '30.00'],
        ['Valor das mercadorias (R$)', '30.00'], ['Frete (R$)', '9.98'], ['Total da NF-e (R$)', '39.98'],
    ];
    for (const [label, value] of values) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar dados para conferência' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(base44.functions.invoke).toHaveBeenCalledWith('recordManualFiscalDocument', expect.objectContaining({ orderId: 'order-1' }));
    expect(base44.functions.invoke).toHaveBeenCalledTimes(1);
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

test('manual discrepancy blocks attestation and a verified manual record never offers XML download', () => {
    const data = { number: '19', series: '1', issuedAt: '2026-11-18T12:00:00Z', protocol: '2'.repeat(15),
        issuerName: 'Emitente', issuerCnpj: '12345678000199', recipientName: 'Cliente',
        recipientDocument: '12345678909', productCents: 3998, shippingCents: 0,
        totalCents: 3998, items: [{ name: 'Peça', quantity: 1, productCents: 3998 }] };
    const document = { origin: 'manual', access_key: '1'.repeat(44), data,
        differences: ['Frete', 'Subtotal das mercadorias'], status: 'needs_review' };
    const { rerender } = render(<FiscalDocumentPanel order={{ id: 'order-1' }} document={document} onChanged={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toContain('bloqueados');
    expect(screen.queryByRole('button', { name: 'Registrar conferência oficial' })).toBeNull();
    rerender(<FiscalDocumentPanel order={{ id: 'order-1' }} document={{ ...document, differences: [], status: 'verified',
        official_checked_at: '2026-11-18T12:10:00Z' }} onChanged={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Baixar XML autorizado' })).toBeNull();
});
