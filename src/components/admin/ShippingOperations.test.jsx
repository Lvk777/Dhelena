// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import ShippingOperations from './ShippingOperations';
import { base44 } from '@/api/base44Client';

vi.mock('@/api/base44Client', () => ({ base44: { functions: { invoke: vi.fn() } } }));
vi.mock('@/lib/fiscalFeature', () => ({ fiscalXmlImportEnabled: true }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const order = { id: 'order-new', payment_status: 'approved', status: 'pagamento_aprovado',
    shipping_method: 'melhor_envio', shipping_quote_id: '2', shipping_status: null };
const document = { status: 'verified', differences: [], access_key: '3'.repeat(44) };

test('Juliane sees automatic preparation pending and cannot start a duplicate manual request', async () => {
    base44.functions.invoke.mockResolvedValue({ environment: 'production', status: null,
        automatic_prepare_enabled: true, automatic_prepare_state: 'pending',
        packages: [{ height: 5, width: 25, length: 30, weight: 0.3 }] });
    render(<ShippingOperations order={order} fiscalDocument={document} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('preparando automaticamente'));
    expect(screen.getByRole('button', { name: 'Preparar envio (sem compra)' }).disabled).toBe(true);
    expect(base44.functions.invoke.mock.calls.filter(([operation]) => operation === 'generateShippingLabel')).toHaveLength(0);
});

test('a completed automatic cart hides duplicate preparation and leaves purchase manual', async () => {
    base44.functions.invoke.mockResolvedValue({ environment: 'production', status: 'cart_created',
        automatic_prepare_enabled: true, automatic_prepare_state: 'prepared',
        shipment_id: 'fixture-shipment', price: '18.90', purchase_enabled: false,
        packages: [{ height: 5, width: 25, length: 30, weight: 0.3 }] });
    render(<ShippingOperations order={order} fiscalDocument={document} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Envio no carrinho; etiqueta ainda não comprada/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Preparar envio (sem compra)' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Comprar etiqueta' }).disabled).toBe(true);
    expect(base44.functions.invoke.mock.calls.filter(([operation]) => operation === 'generateShippingLabel')).toHaveLength(0);
});
