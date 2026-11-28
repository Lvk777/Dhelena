// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ImageUploader from './ImageUploader';

const { upload } = vi.hoisted(() => ({ upload: vi.fn(async ({ file }) => ({ file_url: `https://example.test/${file.name}` })) }));
vi.mock('@/api/base44Client', () => ({ base44: { integrations: { Core: { UploadFile: upload } } } }));
vi.mock('@/lib/imageProcessor', () => ({
    validateImageFile: () => ({ valid: true }),
    IMAGE_PRESETS: { product_image: { aspect: 0.75 } }, PRESET_FOLDERS: { product_image: 'product' },
}));
vi.mock('@/components/admin/CropperModal', () => ({ default: function FakeCropper({ imageFile, onConfirm, onCancel }) {
    return <div role="dialog"><span>{imageFile.name}</span>
        <button onClick={() => onConfirm(imageFile, 'blob:preview')}>Usar imagem</button>
        <button onClick={onCancel}>Cancelar</button></div>;
} }));

beforeEach(() => { URL.revokeObjectURL = vi.fn(); });
afterEach(() => { cleanup(); upload.mockClear(); });
function Harness() {
    const [images, setImages] = React.useState(['https://example.test/existing.webp']);
    return <><ImageUploader images={images} onChange={setImages} /><output data-testid="images">{images.join('|')}</output></>;
}
function selectFiles(container) {
    const input = container.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [new File(['one'], 'first.png'), new File(['two'], 'second.png')] } });
}

test('retains existing and sequentially uploaded photos without duplicate requests', async () => {
    const { container } = render(<Harness />);
    selectFiles(container);
    fireEvent.click(screen.getByRole('button', { name: 'Usar imagem' }));
    await waitFor(() => expect(screen.getByText('second.png')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Usar imagem' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('images').textContent).toBe('https://example.test/existing.webp|https://example.test/first.png|https://example.test/second.png');
    expect(upload).toHaveBeenCalledTimes(2);
});

test('canceling a sequence preserves already confirmed and existing photos', async () => {
    const { container } = render(<Harness />);
    selectFiles(container);
    fireEvent.click(screen.getByRole('button', { name: 'Usar imagem' }));
    await waitFor(() => expect(screen.getByText('second.png')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('images').textContent).toBe('https://example.test/existing.webp|https://example.test/first.png');
    expect(upload).toHaveBeenCalledTimes(1);
});

test('photo controls stay visible and usable on touch layouts', () => {
    const { container } = render(<Harness />);
    const remove = screen.getByRole('button', { name: 'Remover foto 1' });
    const moveBefore = screen.getByRole('button', { name: 'Mover foto 1 para antes' });
    const moveAfter = screen.getByRole('button', { name: 'Mover foto 1 para depois' });
    expect(remove.className).toContain('w-11 h-11');
    expect(moveBefore.className).toContain('w-11 h-11');
    expect(moveAfter.className).toContain('w-11 h-11');
    expect(remove.parentElement.className).not.toContain('opacity-0');
    expect(moveAfter.parentElement.parentElement.className).not.toContain('opacity-0');
    expect(moveBefore.disabled).toBe(true);
    expect(moveAfter.disabled).toBe(true);

    selectFiles(container);
    fireEvent.click(screen.getByRole('button', { name: 'Usar imagem' }));
    return waitFor(() => {
        expect(screen.getByRole('button', { name: 'Mover foto 1 para depois' }).disabled).toBe(false);
    }).then(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Mover foto 1 para depois' }));
        expect(screen.getByTestId('images').textContent).toBe('https://example.test/first.png|https://example.test/existing.webp');
    });
});
