// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProductForm from './ProductForm';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@/api/base44Client', () => ({ base44: { entities: {
    Setting: { list: async () => [] }, Product: { create },
} } }));
vi.mock('@/context/CatalogContext', () => ({ useCatalog: () => ({ categories: [], collections: [], reload: vi.fn() }) }));
vi.mock('@/components/BoutiqueDialogs', () => ({ useBoutiqueDialogs: () => ({ prompt: vi.fn() }) }));
vi.mock('@/components/ImageUploader', () => ({ default: () => null }));
vi.mock('@/components/admin/ProductPreview', () => ({ default: () => null }));
vi.mock('@/lib/audit', () => ({ logAdminAction: vi.fn() }));

afterEach(() => { cleanup(); create.mockClear(); });

test('saving a nameless draft identifies the missing field and does not create a product', () => {
    render(<MemoryRouter initialEntries={['/admin/produtos/novo']}><Routes>
        <Route path="/admin/produtos/novo" element={<ProductForm />} />
    </Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    expect(screen.getByRole('alert').textContent).toContain('nome do produto');
    expect(create).not.toHaveBeenCalled();
});
