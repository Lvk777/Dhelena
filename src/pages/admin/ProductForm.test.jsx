// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProductForm from './ProductForm';

const { create, update, get } = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), get: vi.fn() }));
vi.mock('@/api/base44Client', () => ({ base44: { entities: {
    Setting: { list: async () => [] }, Product: { create, update, get },
} } }));
vi.mock('@/context/CatalogContext', () => ({ useCatalog: () => ({ categories: [], collections: [], reload: vi.fn() }) }));
vi.mock('@/components/BoutiqueDialogs', () => ({ useBoutiqueDialogs: () => ({ prompt: vi.fn() }) }));
vi.mock('@/components/ImageUploader', () => ({ default: () => null }));
vi.mock('@/components/admin/ProductPreview', () => ({ default: () => null }));
vi.mock('@/lib/audit', () => ({ logAdminAction: vi.fn() }));

afterEach(() => { cleanup(); create.mockReset(); update.mockReset(); get.mockReset(); });

test('saving a nameless draft identifies the missing field and does not create a product', () => {
    render(<MemoryRouter initialEntries={['/admin/produtos/novo']}><Routes>
        <Route path="/admin/produtos/novo" element={<ProductForm />} />
    </Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    expect(screen.getByRole('alert').textContent).toContain('nome do produto');
    expect(create).not.toHaveBeenCalled();
});

test('publishes a filled synthetic product with the optional editable clothing package', async () => {
    create.mockResolvedValue({ id: 'synthetic-product' });
    render(<MemoryRouter initialEntries={['/admin/produtos/novo']}><Routes>
        <Route path="/admin/produtos/novo" element={<ProductForm />} />
        <Route path="/admin/produtos" element={<p>Lista de produtos</p>} />
    </Routes></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Nome do produto'), { target: { value: 'Peça fictícia' } });
    fireEvent.click(screen.getByRole('button', { name: /Próximo/ }));
    fireEvent.click(screen.getByRole('button', { name: /Próximo/ }));
    fireEvent.click(screen.getByRole('button', { name: /Cor personalizada/ }));
    fireEvent.change(screen.getByPlaceholderText('Nome da cor'), { target: { value: 'Azul' } });
    fireEvent.click(screen.getByRole('button', { name: /Próximo/ }));
    fireEvent.change(screen.getByLabelText('Preço de venda (R$)'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: /Próximo/ }));
    fireEvent.click(screen.getByRole('button', { name: /Próximo/ }));
    fireEvent.change(screen.getByLabelText('Tipo de embalagem'), { target: { value: 'light-clothing' } });
    fireEvent.click(screen.getByRole('button', { name: /Próximo/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Publicar produto' }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0][0]).toMatchObject({ name: 'Peça fictícia', status: 'published', price: 100,
        package_height: 5, package_width: 25, package_length: 30, weight: 0.4 });
    expect(await screen.findByText('Lista de produtos')).toBeTruthy();
});

test('editing a synthetic product saves a draft without changing its existing images', async () => {
    get.mockResolvedValue({ id: 'synthetic-product', name: 'Peça antiga', images: ['https://example.test/existing.webp'],
        updated_date: '2026-11-17T12:00:00Z', status: 'draft' });
    update.mockResolvedValue({});
    render(<MemoryRouter initialEntries={['/admin/produtos/synthetic-product']}><Routes>
        <Route path="/admin/produtos/:id" element={<ProductForm />} />
        <Route path="/admin/produtos" element={<p>Lista de produtos</p>} />
    </Routes></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText('Nome do produto').value).toBe('Peça antiga'));
    fireEvent.change(screen.getByLabelText('Nome do produto'), { target: { value: 'Peça editada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0][1]).toMatchObject({ name: 'Peça editada', status: 'draft',
        images: ['https://example.test/existing.webp'], expected_updated_date: '2026-11-17T12:00:00Z' });
    expect(create).not.toHaveBeenCalled();
});
