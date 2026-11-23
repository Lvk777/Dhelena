// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminOrderDetail from './AdminOrderDetail';
import { base44 } from '@/api/base44Client';

vi.mock('@/api/base44Client', () => ({ base44: {
    entities: { Order: { get: vi.fn() } }, functions: { invoke: vi.fn() },
} }));
vi.mock('@/lib/fiscalFeature', () => ({ fiscalXmlImportEnabled: true }));
vi.mock('@/components/admin/AdminAfterSales', () => ({ default: ({ view }) => <p>Funções de {view}</p> }));
vi.mock('@/components/admin/OperationalRefund', () => ({ default: () => <p>Reembolso administrativo completo</p> }));
vi.mock('@/components/admin/ShippingOperations', () => ({ default: () => <p>Funções de expedição</p> }));
vi.mock('@/components/admin/FiscalDocumentPanel', () => ({ default: () => <p>Painel fiscal</p> }));
vi.mock('@/components/checkout/CardFinancingSummary', () => ({ default: () => null }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

test('operational sections start collapsed while critical payment, shipping and fiscal warnings stay visible', async () => {
    base44.entities.Order.get.mockResolvedValue({ id: 'fixture', order_number: 'TEST-ORDER',
        created_date: '2026-11-18T12:00:00Z', status: 'recebido', payment_status: 'pending',
        payment_attempt_started_at: '2026-11-18T12:01:00Z', shipping_status: 'cart_inflight',
        shipping_method: 'melhor_envio', subtotal: 30, shipping_cost: 9.98, total: 39.98,
        items: [{ product_name: 'Peça', quantity: 1, unit_price: 30 }],
        snapshot: { customer: { name: 'Cliente', email: 'fixture@example.test' }, shipping_address: {} } });
    base44.functions.invoke.mockImplementation(async name => name === 'getFiscalDocument'
        ? { differences: ['Frete'], status: 'needs_review' } : []);
    const { container } = render(<MemoryRouter initialEntries={['/admin/pedidos/fixture']}>
        <Routes><Route path="/admin/pedidos/:id" element={<AdminOrderDetail />} /></Routes>
    </MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'TEST-ORDER' })).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/Divergência fiscal\. Chave bloqueada/)).toBeTruthy());
    expect(screen.getAllByText('Frete').length).toBeGreaterThan(0);
    const panels = [...container.querySelectorAll('details')];
    expect(panels).toHaveLength(5);
    expect(panels.every(panel => !panel.open)).toBe(true);
    expect(screen.getByText(/Pagamento com tentativa inconclusiva/)).toBeTruthy();
    expect(screen.getByText(/Envio aguardando confirmação.*pode gerar duplicidade/)).toBeTruthy();
    expect(screen.queryByText(/cart_inflight/)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Cliente' })).toBeTruthy();
    expect(screen.getAllByText('Peça').length).toBeGreaterThan(0);
    expect(screen.getByText('Pagamento')).toBeTruthy();
    fireEvent.click(screen.getByText('Expedição e etiquetas'));
    expect(panels.find(panel => panel.textContent.includes('Expedição e etiquetas')).open).toBe(true);
    expect(screen.getByText('Funções de expedição')).toBeTruthy();
});
