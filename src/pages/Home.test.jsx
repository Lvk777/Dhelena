// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Home from './Home';

vi.mock('@/context/CatalogContext', () => ({ useCatalog: () => ({
    products: [], categories: [{ id: 'category-1', name: 'Vestidos', slug: 'vestidos',
        image: 'https://example.test/category.jpg' }],
    banners: [
        { id: 'hero', position: 'home_hero', image: 'https://example.test/hero.jpg', title: 'D’Helenas' },
        { id: 'concept', position: 'home', image: 'https://example.test/concept.jpg', title: 'Muito além da moda' },
    ], loading: false, error: false, reload: vi.fn(),
}) }));
vi.mock('@/context/PublicSettingsContext', () => ({ usePublicSettings: () => ({ settings: { social: {} } }) }));
vi.mock('@/hooks/useReveal', () => ({ useReveal: () => ({ ref: () => {}, visible: true }) }));
vi.mock('@/components/Newsletter', () => ({ default: () => null }));
afterEach(cleanup);

test('empty operational catalog still shows original brand and category images without archived products', () => {
    render(<MemoryRouter><Home /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Uma nova coleção está sendo preparada' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Vestidos' }).getAttribute('src')).toBe('https://example.test/category.jpg');
    expect(screen.getByRole('img', { name: 'Muito além da moda' }).getAttribute('src')).toBe('https://example.test/concept.jpg');
    expect(document.querySelector('img[src="https://example.test/hero.jpg"]')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Acabaram de chegar' })).toBeNull();
});
