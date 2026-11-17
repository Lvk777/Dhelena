// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import FiscalDocumentPanel from './FiscalDocumentPanel';

vi.mock('@/api/base44Client', () => ({ base44: { functions: { invoke: vi.fn() } } }));

afterEach(cleanup);

test('a failed document lookup shows the error without offering an unsafe second import', () => {
    render(<FiscalDocumentPanel order={{ id: 'order-1' }} document={null}
        loadError="Não foi possível consultar a nota fiscal." onChanged={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível consultar');
    expect(screen.queryByText(/NF-e .* série/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Importar nota fiscal' })).toBeNull();
});
