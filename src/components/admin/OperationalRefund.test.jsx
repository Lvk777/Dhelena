// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import OperationalRefund from './OperationalRefund';

vi.mock('@/api/base44Client', () => ({ base44: { functions: { invoke: vi.fn() } } }));
import { base44 } from '@/api/base44Client';

const order = {
    id: 'id-19', order_number: 'DH-2026-000019', payment_status: 'approved',
    snapshot: { payment_context: { mode: 'test' } },
};

afterEach(() => { cleanup(); vi.resetAllMocks(); });

test('only the authorized order displays the financial refund action', () => {
    const { rerender } = render(<OperationalRefund order={{ ...order, order_number: 'DH-2026-000020' }} />);
    expect(screen.queryByText(/Estorno integral de homologação/)).toBeNull();
    rerender(<OperationalRefund order={order} />);
    expect(screen.getByText(/Estorno integral de homologação/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Confirmar estorno real/ })).toBeNull();
});

test('preview is read-only; actual refund requires checkbox and typed authorization', async () => {
    vi.mocked(base44.functions.invoke).mockResolvedValue({ mode: 'test', amount_cents: 3998,
        kind: 'full', enabled: true, confirmation: 'signed-preview' });
    render(<OperationalRefund order={order} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Motivo do reembolso' }),
        { target: { value: 'Devolver pagamento da homologação' } });
    fireEvent.click(screen.getByRole('button', { name: 'Consultar prévia sem reembolsar' }));
    await waitFor(() => expect(base44.functions.invoke).toHaveBeenCalledWith('operationalRefundPreview',
        { orderId: 'id-19', request: { kind: 'full', reason: 'Devolver pagamento da homologação', selected_items: [] } }));
    const submit = screen.getByRole('button', { name: /Confirmar estorno real/ });
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Autorização do estorno' }), { target: { value: 'estornar' } });
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(base44.functions.invoke).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole('textbox', { name: 'Autorização do estorno' }), { target: { value: 'ESTORNAR' } });
    expect(submit.disabled).toBe(false);
});
