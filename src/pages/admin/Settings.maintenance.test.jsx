// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/api/base44Client', () => ({
    base44: { entities: { Setting: { list: vi.fn(), update: vi.fn(), create: vi.fn() } } },
}));
vi.mock('@/lib/audit', () => ({ logAdminAction: vi.fn().mockResolvedValue(null) }));

import { base44 } from '@/api/base44Client';
import Settings from './Settings';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

test('System tab reflects the real public maintenance setting and saves to that record', async () => {
    base44.entities.Setting.list.mockResolvedValue([{
        id: 'maintenance-record', key: 'maintenance', is_public: true,
        value: { maintenance_mode: true },
    }]);
    base44.entities.Setting.update.mockResolvedValue({});

    render(<Settings />);
    await waitFor(() => expect(base44.entities.Setting.list).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getAllByRole('button', { name: 'Sistema' })[0]);

    const toggle = screen.getByRole('button', { name: 'Ativar modo manutenção' });
    expect(toggle.className).toContain('bg-accent');
    fireEvent.click(toggle);
    expect(toggle.className).toContain('bg-muted');
    fireEvent.click(screen.getByRole('button', { name: /Salvar alterações/ }));

    await waitFor(() => expect(base44.entities.Setting.update).toHaveBeenCalledWith(
        'maintenance-record', { value: { maintenance_mode: false } },
    ));
    expect(base44.entities.Setting.create).not.toHaveBeenCalled();
});
