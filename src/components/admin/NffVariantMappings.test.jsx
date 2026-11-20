// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import NffVariantMappings from './NffVariantMappings';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/api/base44Client', () => ({ base44: { functions: { invoke } } }));
afterEach(() => { cleanup(); invoke.mockReset(); });

test('saves a reviewed NFF code for a selected variant without editing the product or order', async () => {
    invoke.mockImplementation(async name => name === 'getNffVariantMappings' ? [] : { saved: true });
    render(<NffVariantMappings productId="product-1" productName="Shorts Angel" colors={[{ id: 'bege', name: 'Bege' }]} sizes={['P']} />);
    const button = screen.getByRole('button', { name: 'Salvar correspondência NFF' });
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Cor da loja'), { target: { value: 'bege' } });
    fireEvent.change(screen.getByLabelText('Tamanho'), { target: { value: 'P' } });
    fireEvent.change(screen.getByLabelText('Código no NFF'), { target: { value: '127' } });
    fireEvent.change(screen.getByLabelText('Descrição no NFF'), { target: { value: 'Shorts Angel Marfim P' } });
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Conferi no NFF/));
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('saveNffVariantMapping', {
        productId: 'product-1', mapping: { color_id: 'bege', size: 'P', code: '127',
            description: 'Shorts Angel Marfim P', expected_color_name: 'Bege',
            expected_product_name: 'Shorts Angel', confirmed_match: true },
    }));
    expect(invoke.mock.calls.some(([name]) => name === 'generateShippingLabel' || name === 'importFiscalXml')).toBe(false);
});
