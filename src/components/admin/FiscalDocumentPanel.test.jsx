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
    base44.functions.invoke.mockImplementation(async name => name === 'importFiscalXml' ? document : []);
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
    expect(base44.functions.invoke.mock.calls.filter(([name]) => name === 'importFiscalXml')).toHaveLength(1);
});

test('invalid converted PDF XML shows explanatory validation error without changing order', async () => {
    const onChanged = vi.fn();
    base44.functions.invoke.mockImplementation(async name => {
        if (name === 'importFiscalXml') throw Object.assign(new Error('O arquivo não é o XML fiscal autorizado da NF-e.'), { status: 422 });
        return [];
    });
    render(<FiscalDocumentPanel order={{ id: 'order-1' }} document={null} onChanged={onChanged} />);
    fireEvent.change(screen.getByLabelText('Arquivo XML da NF-e'), {
        target: { files: [new File(['<document><page/></document>'], 'danfe.xml', { type: 'text/xml' })] },
    });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('não é o XML fiscal autorizado'));
    expect(onChanged).not.toHaveBeenCalled();
});

test('unlink confirmation can be cancelled without a request or changing the fiscal document', async () => {
    base44.functions.invoke.mockResolvedValue([]);
    const document = { id: '11111111-1111-4111-8111-111111111111', origin: 'xml',
        access_key: '1'.repeat(44), status: 'needs_review', differences: ['Frete'],
        data: { number: '19', series: '1', issuedAt: '2026-11-18T12:00:00Z', protocol: '2'.repeat(15),
            issuerName: 'Emitente', issuerCnpj: '12345678000199', recipientName: 'Cliente',
            recipientDocument: '12345678909', productCents: 3000, shippingCents: 0,
            totalCents: 3000, items: [] } };
    const onChanged = vi.fn();
    render(<FiscalDocumentPanel order={{ id: 'order-1', shipping_status: 'cart_inflight' }} document={document} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Desvincular XML' }));
    expect(screen.getByText(/O documento anterior será preservado no histórico/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('button', { name: 'Confirmar desvinculação' })).toBeNull();
    expect(base44.functions.invoke.mock.calls.filter(([name]) => name === 'unlinkFiscalDocument')).toHaveLength(0);
    expect(onChanged).not.toHaveBeenCalled();
});

test('reviewed unlink preserves the historical entry and offers XML import again', async () => {
    const document = { id: '11111111-1111-4111-8111-111111111111', origin: 'xml',
        access_key: '1'.repeat(44), status: 'needs_review', differences: ['Frete'],
        data: { number: '19', series: '1', issuedAt: '2026-11-18T12:00:00Z', protocol: '2'.repeat(15),
            issuerName: 'Emitente', issuerCnpj: '12345678000199', recipientName: 'Cliente',
            recipientDocument: '12345678909', productCents: 3000, shippingCents: 0,
            totalCents: 3000, items: [] } };
    let history = [];
    base44.functions.invoke.mockImplementation(async name => {
        if (name === 'unlinkFiscalDocument') { history = [{ id: document.id, number: '19', series: '1',
            access_key_last4: '1111', unlinked_at: '2026-11-19T12:00:00Z',
            prior_official_status: 'authorized', unlink_reason: 'Documento fiscal vinculado ao pedido incorreto' }]; return { unlinked: true }; }
        if (name === 'getFiscalDocumentHistory') return history;
        return null;
    });
    const onChanged = vi.fn();
    const order = { id: 'order-1', shipping_status: 'cart_inflight' };
    const { rerender } = render(<FiscalDocumentPanel order={order} document={document} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Desvincular XML' }));
    fireEvent.change(screen.getByLabelText(/Motivo da desvinculação/), { target: { value: 'Documento fiscal vinculado ao pedido incorreto' } });
    fireEvent.change(screen.getByLabelText('Portal oficial consultado'), { target: { value: 'national' } });
    fireEvent.change(screen.getByLabelText('Situação da nota anterior no portal'), { target: { value: 'authorized' } });
    fireEvent.click(screen.getByLabelText(/Conferi a situação da nota anterior/));
    fireEvent.click(screen.getByLabelText(/Entendo que desvincular o XML/));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar desvinculação' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(null));
    expect(base44.functions.invoke).toHaveBeenCalledWith('unlinkFiscalDocument', expect.objectContaining({
        orderId: 'order-1', review: expect.objectContaining({ prior_official_status: 'authorized' }),
    }));
    rerender(<FiscalDocumentPanel order={order} document={null} onChanged={onChanged} />);
    expect(screen.getByRole('button', { name: 'Importar XML' })).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText('Histórico de documentos fiscais').textContent).toContain('XML preservado'));
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

test('product correspondence is separate, shows both records and keeps name and shipping pending', async () => {
    const document = { id: '11111111-1111-4111-8111-111111111111', origin: 'xml',
        access_key: '1'.repeat(44), status: 'needs_review',
        differences: ['Nome do destinatário', 'Identificação dos produtos', 'Produtos do pedido'],
        analysis: { abbreviatedName: true, productCandidate: {
            orderItemId: '22222222-2222-4222-8222-222222222222', fiscalIndex: 0,
            fiscalCode: '127', orderSku: '2026@', orderColor: 'Bege', fiscalColor: 'marfim',
            productName: 'Shorts Angel', fiscalName: 'Shorts Angel Marfim P', size: 'P',
            quantity: 1, productCents: 3000, productId: '33333333-3333-4333-8333-333333333333', colorId: 'bege-id',
        }, issues: [{ code: 'recipient_name', message: 'Nome da cliente: pedido abreviado; confira a identidade.' },
            { code: 'product_identity', message: 'Produto: pedido Bege, nota Marfim, código 127; confira a variante.' }] },
        data: { number: '19', series: '1', issuedAt: '2026-11-18T12:00:00Z', protocol: '2'.repeat(15),
            issuerName: 'Emitente', issuerCnpj: '12345678000199', recipientName: 'Cliente',
            recipientDocument: '12345678909', productCents: 3000, shippingCents: 998,
            totalCents: 3998, items: [{ name: 'Shorts Angel Marfim P', quantity: 1, productCents: 3000 }] } };
    const onChanged = vi.fn();
    const partial = { ...document, differences: ['Nome da cliente'],
        analysis: { ...document.analysis, issues: [document.analysis.issues[0]] } };
    base44.functions.invoke.mockImplementation(async name => name === 'confirmFiscalEquivalence' || name === 'getFiscalDocument'
        ? partial : []);
    const order = { id: 'order-1', shipping_status: 'cart_inflight' };
    const { rerender } = render(<FiscalDocumentPanel order={order} document={document} onChanged={onChanged} />);
    expect(screen.getByText(/pedido Bege, nota Marfim/)).toBeTruthy();
    expect(screen.getByLabelText('Produto do pedido').textContent).toContain('SKU: 2026@');
    expect(screen.getByLabelText('Produto da NF-e').textContent).toContain('Código fiscal: 127');
    const button = screen.getByRole('button', { name: 'Confirmar correspondência do produto' });
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/dois registros representam a mesma mercadoria/));
    fireEvent.click(screen.getByLabelText(/descrição e a variante/));
    fireEvent.change(screen.getByLabelText('Justificativa da correspondência'), { target: { value: 'Variante comercial revisada no cadastro' } });
    fireEvent.change(screen.getByLabelText('Evidência da correspondência'), { target: { value: 'Ficha de cadastro da peça e variante' } });
    fireEvent.click(screen.getByLabelText(/Salvar esta relação entre código fiscal/));
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ status: 'needs_review', differences: ['Nome da cliente'] })));
    expect(base44.functions.invoke).toHaveBeenCalledWith('confirmFiscalEquivalence', expect.objectContaining({
        review: expect.objectContaining({ confirmed_recipient: false, confirmed_product_code: true,
            confirmed_product_variant: true, save_for_future: true,
            order_item_id: document.analysis.productCandidate.orderItemId }),
    }));
    rerender(<FiscalDocumentPanel order={order} document={partial} onChanged={onChanged} />);
    expect(screen.queryByRole('button', { name: 'Confirmar correspondência do produto' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirmar identidade da cliente' })).toBeNull();
    expect(base44.functions.invoke.mock.calls.every(([name]) => name !== 'generateShippingLabel')).toBe(true);
});

test('a rejected correspondence keeps the product discrepancy and entered evidence', async () => {
    const document = { id: '11111111-1111-4111-8111-111111111111', origin: 'xml',
        access_key: '1'.repeat(44), status: 'needs_review', differences: ['Produto'],
        analysis: { abbreviatedName: false, issues: [{ code: 'product_identity', message: 'Produto divergente.' }],
            productCandidate: { orderItemId: '22222222-2222-4222-8222-222222222222', fiscalIndex: 0,
                productName: 'Shorts Angel', fiscalName: 'Outra descrição P', orderColor: 'Bege',
                fiscalColor: '', orderSku: '2026@', fiscalCode: '127', size: 'P', quantity: 1, productCents: 3000 } },
        data: { number: '19', series: '1', issuedAt: '2026-11-18T12:00:00Z', protocol: '2'.repeat(15),
            issuerName: 'Emitente', issuerCnpj: '12345678000199', recipientName: 'Cliente',
            recipientDocument: '12345678909', productCents: 3000, shippingCents: 998,
            totalCents: 3998, items: [{ name: 'Outra descrição P', quantity: 1, productCents: 3000 }] } };
    const onChanged = vi.fn();
    base44.functions.invoke.mockImplementation(async name => {
        if (name === 'confirmFiscalEquivalence') throw Object.assign(new Error('Correspondência não comprovada.'), { status: 409 });
        return [];
    });
    render(<FiscalDocumentPanel order={{ id: 'order-1' }} document={document} onChanged={onChanged} />);
    fireEvent.click(screen.getByLabelText(/dois registros representam a mesma mercadoria/));
    fireEvent.click(screen.getByLabelText(/descrição e a variante/));
    fireEvent.change(screen.getByLabelText('Justificativa da correspondência'), { target: { value: 'Conferência sintética rejeitada pelo servidor' } });
    fireEvent.change(screen.getByLabelText('Evidência da correspondência'), { target: { value: 'Documento sintético da variante consultado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar correspondência do produto' }));
    await waitFor(() => expect(screen.getAllByRole('alert').some(node => node.textContent.includes('Correspondência não comprovada'))).toBe(true));
    expect(screen.getByLabelText('Justificativa da correspondência').value).toContain('Conferência sintética');
    expect(onChanged).not.toHaveBeenCalled();
});
