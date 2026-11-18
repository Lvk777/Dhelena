// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import Contact from './Contact';

vi.mock('@/context/StoreContext', () => ({ useStore: () => ({ showToast: vi.fn() }) }));
vi.mock('@/context/PublicSettingsContext', () => ({ usePublicSettings: () => ({ settings: {
    general: { whatsapp: '11927189069', phone: '11927189069', email: 'contato@dhelenas.com',
        business_hours: 'Segunda a sexta-feira, das 8h às 18h.',
        public_address: 'Loja exclusivamente on-line, somente com horário agendado.' },
    shipping: { pickup_enabled: false }, social: {},
} }) }));
vi.mock('@/api/base44Client', () => ({ base44: { custom: { submitContact: vi.fn() } } }));
vi.mock('@/lib/useSEO', () => ({ default: vi.fn() }));

afterEach(cleanup);

test('online-only contact keeps official channels without showing an unverified pickup address', () => {
    render(<Contact />);
    expect(screen.getByText(/Não oferecemos retirada presencial/)).toBeTruthy();
    expect(screen.getByText('contato@dhelenas.com')).toBeTruthy();
    expect(screen.getByText('Segunda a sexta-feira, das 8h às 18h.')).toBeTruthy();
    expect(screen.queryByText('Endereço do fornecedor')).toBeNull();
    expect(screen.queryByText(/somente com horário agendado/)).toBeNull();
});
