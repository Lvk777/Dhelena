// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Inventory from './Inventory';
import AdminProducts from './Products';
import { base44 } from '@/api/base44Client';

vi.mock('@/api/base44Client', () => ({ base44: { entities: {
    Product: { list: vi.fn() }, Category: { list: vi.fn() }, Collection: { list: vi.fn() }, Setting: { filter: vi.fn() },
} } }));
afterEach(cleanup);

const products = [
    { id: 'operational', name: 'Shorts Angel', sku: 'SHORTS', status: 'archived', historical_only: false,
        colors: [{ id: 'c1', name: 'Marfim', stock: { P: 0 } }], sizes: ['P'], images: [],
        stock_summary: { on_hand: 0, reserved: 0, available: 0, sold_confirmed_new: 1 } },
    { id: 'historical', name: 'Vestido Legado', sku: 'LEGADO', status: 'archived', historical_only: true,
        colors: [{ id: 'c2', name: 'Preto', stock: { P: 16 } }], sizes: ['P'], images: [],
        stock_summary: { on_hand: 16, reserved: 0, available: 16, sold_confirmed_new: 2 } },
];

function mockLists() {
    base44.entities.Product.list.mockResolvedValue(products);
    base44.entities.Category.list.mockResolvedValue([]);
    base44.entities.Collection.list.mockResolvedValue([]);
    base44.entities.Setting.filter.mockResolvedValue([]);
}

test('inventory starts with operational products and isolates historical quantities', async () => {
    mockLists();
    render(<MemoryRouter><Inventory /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Shorts Angel').length).toBeGreaterThan(0));
    expect(screen.queryByText('Vestido Legado')).toBeNull();
    expect(screen.getAllByText('0', { selector: 'p' }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Histórico preservado' }));
    expect(screen.getAllByText('Vestido Legado').length).toBeGreaterThan(0);
    expect(screen.queryByText('Shorts Angel')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('não fazem parte do estoque operacional');
    expect(screen.queryByTitle('Ajustar estoque')).toBeNull();
});

test('product administration exposes historical products only through its explicit filter', async () => {
    mockLists();
    render(<MemoryRouter><AdminProducts /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('combobox')).toBeTruthy());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'all' } });
    await waitFor(() => expect(screen.getByText('Shorts Angel')).toBeTruthy());
    expect(screen.queryByText('Vestido Legado')).toBeNull();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'historical' } });
    expect(screen.getByText('Vestido Legado')).toBeTruthy();
    expect(screen.queryByText('Shorts Angel')).toBeNull();
    expect(screen.queryByTitle('Editar')).toBeNull();
    expect(screen.queryByTitle('Excluir')).toBeNull();
});
