// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import SystemTab from './SystemTab';

afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

test('Railway API is online only after a live health and database check succeeds', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.test/api');
    const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ok', database: 'connected' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SystemTab data={{ maintenance_mode: false }} onChange={vi.fn()} />);
    expect(screen.getByText('Verificando')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Online')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/health',
        expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }));
    expect(screen.getByText('Conectado')).toBeTruthy();
    expect(screen.getByText('Não verificado')).toBeTruthy();
    expect(screen.getAllByText('Opcional')).toHaveLength(2);
    expect(screen.getByText('A avaliar')).toBeTruthy();
    expect(screen.queryByText('Pendente')).toBeNull();
});

test('failed health check is not reported as a successful Railway deployment', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.test');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'error', database: 'disconnected' }),
    }));

    render(<SystemTab data={{ maintenance_mode: false }} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Sem conexão')).toBeTruthy());
    expect(screen.getByText('Não confirmado')).toBeTruthy();
});
