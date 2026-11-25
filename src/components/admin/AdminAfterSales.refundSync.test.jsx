// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import AdminAfterSales from './AdminAfterSales';
import { base44 } from '@/api/base44Client';

vi.mock('@/api/base44Client', () => ({ base44: { functions: { invoke: vi.fn() } } }));
vi.mock('@/components/BoutiqueDialogs', () => ({ useBoutiqueDialogs: () => ({ confirm: vi.fn() }) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const order = { id: 'order-19', order_number: 'DH-2026-000019', payment_status: 'approved', status: 'pagamento_aprovado', items: [] };
const data = { physical_schema_ready: true, refunds_enabled: false, pending_cancellation_enabled: false,
    refunds: [{ id: 'r-19', kind: 'full', amount: '39.98', status: 'processed', provider_refund_id: 'RF-19' }], returns: [] };

test('automatically syncs a confirmed refund without making a new refund', async () => {
    const onChanged = vi.fn(async () => {});
    base44.functions.invoke.mockImplementation(async name => {
        if (name === 'getAfterSales') return data;
        if (name === 'operationalRefundSyncStatus') return { payment_status: 'refunded' };
        throw new Error(`Unexpected financial operation: ${name}`);
    });
    render(<AdminAfterSales order={order} view="refunds" onChanged={onChanged} />);
    await waitFor(() => expect(base44.functions.invoke).toHaveBeenCalledWith('operationalRefundSyncStatus', { orderId: order.id }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(base44.functions.invoke.mock.calls.filter(([name]) => name === 'operationalRefund')).toHaveLength(0);
});

test('does not auto-sync a different order', async () => {
    base44.functions.invoke.mockResolvedValue(data);
    render(<AdminAfterSales order={{ ...order, order_number: 'DH-2026-000020' }} view="refunds" onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Total · R\$ 39,98/)).toBeTruthy());
    expect(base44.functions.invoke.mock.calls.filter(([name]) => name === 'operationalRefundSyncStatus')).toHaveLength(0);
});
