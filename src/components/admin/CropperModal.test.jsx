// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CropperModal from './CropperModal';

vi.mock('react-easy-crop', () => ({ default: function FakeCropper({ onCropComplete }) {
    React.useEffect(() => { onCropComplete(null, { x: 0, y: 0, width: 10, height: 10 }); }, [onCropComplete]);
    return <div data-testid="crop-area" />;
} }));
vi.mock('@/lib/imageProcessor', () => ({
    cropAndResize: vi.fn(async () => ({ blob: new Blob(['image'], { type: 'image/webp' }), ext: 'webp' })),
    computeCropArea: value => value, blobToFile: blob => new File([blob], 'crop.webp', { type: 'image/webp' }),
    formatAspectRatio: () => '3:4', checkImageQuality: () => ({ tooSmall: true, message: 'Imagem pequena' }),
}));

beforeEach(() => {
    vi.stubGlobal('Image', class { set src(value) { this._src = value; queueMicrotask(() => this.onload?.()); } get src() { return this._src; } });
    URL.createObjectURL = vi.fn(() => 'blob:crop-test');
    URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const preset = { aspect: 0.75, maxWidth: 1200, maxHeight: 1600 };
const file = new File(['image'], 'image.png', { type: 'image/png' });

test('places accessible actions in body even inside an overflow-hidden animated parent', async () => {
    const onCancel = vi.fn(), onConfirm = vi.fn();
    const result = render(<div className="overflow-hidden" style={{ transform: 'translateY(0)' }}><input aria-label="Nome do produto" defaultValue="Vestido" />
        <CropperModal imageFile={file} preset={preset} onCancel={onCancel} onConfirm={onConfirm} /></div>);
    const dialog = screen.getByRole('dialog');
    expect(dialog.parentElement.parentElement).toBe(document.body);
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Usar imagem' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fechar recorte' })).toBeTruthy();
    expect(dialog.className).toContain('max-h-[calc(100dvh-1rem)]');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Usar imagem' }).disabled).toBe(false));
    await waitFor(() => expect(screen.getByText('Imagem pequena')).toBeTruthy());
    fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '2' } });
    expect(screen.getByText('2.0x')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(result.getByRole('textbox', { name: 'Nome do produto' }).value).toBe('Vestido');
});

test('keeps confirmation single-flight and permits retry after upload failure', async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(new Error('upload')).mockResolvedValueOnce(undefined);
    render(<CropperModal imageFile={file} preset={preset} onCancel={vi.fn()} onConfirm={onConfirm} />);
    const button = await screen.findByRole('button', { name: 'Usar imagem' });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(screen.getByText(/Não foi possível processar ou enviar/)).toBeTruthy());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(button);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
});
