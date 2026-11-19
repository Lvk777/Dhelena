// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import FiscalDocumentPanel from './FiscalDocumentPanel';
import { base44 } from '@/api/base44Client';

vi.mock('@/api/base44Client', () => ({ base44: { functions: { invoke: vi.fn() } } }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

test('a failed document lookup shows the error without offering an unsafe second import', () => {
    render(<FiscalDocumentPanel order={{ id: 'order-1' }} document={null}
        loadError="Não foi possível consultar a nota fiscal." onChanged={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível consultar');
    expect(screen.queryByText(/NF-e .* série/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Importar XML' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Informar chave da NF-e' })).toBeNull();
});

test('new fiscal registration exposes only XML upload, not key or manual entry', async () => {
    const onChanged = vi.fn();
    const document = { id: 'document-1', origin: 'xml', status: 'pending_official' };
    base44.functions.invoke.mockResolvedValueOnce(document);
    render(<FiscalDocumentPanel order={{ id: 'order-1' }} document={null} onChanged={onChanged} />);
    expect(screen.getByRole('button', { name: 'Importar XML' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Informar chave da NF-e' })).toBeNull();
    expect(screen.queryByText('Cadastro manual avançado')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Preencher dados completos' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Arquivo XML da NF-e'), {
        target: { files: [new File(['<nfeProc/>'], 'nfe.xml', { type: 'text/xml' })] },
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(document));
    expect(base44.functions.invoke).toHaveBeenCalledWith('importFiscalXml', expect.objectContaining({ orderId: 'order-1' }));
    expect(base44.functions.invoke).toHaveBeenCalledTimes(1);
});

test('invalid converted PDF XML shows explanatory validation error without changing order', async () => {
    const onChanged = vi.fn();
    base44.functions.invoke.mockRejectedValueOnce(new Error('O arquivo não é o XML fiscal autorizado da NF-e.'));
    render(<FiscalDocumentPanel order={{ id: 'order-1' }} document={null} onChanged={onChanged} />);
    fireEvent.change(screen.getByLabelText('Arquivo XML da NF-e'), {
        target: { files: [new File(['<document><page/></document>'], 'danfe.xml', { type: 'text/xml' })] },
    });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('não é o XML fiscal autorizado'));
    expect(onChanged).not.toHaveBeenCalled();
});

test('historical pending key can be replaced by XML without exposing key registration', () => {
    const pending = { id: 'pending-1', origin: 'key_only', status: 'pending_key',
        access_key: '1'.repeat(44), created_at: '2026-11-19T12:00:00Z' };
    render(<FiscalDocumentPanel order={{ id: 'order-1' }} document={pending} onChanged={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('não pode ser usada no Melhor Envio');
    expect(screen.getByRole('button', { name: 'Importar XML' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remover chave pendente' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Informar chave da NF-e' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Registrar conferência oficial' })).toBeNull();
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
