import assert from 'node:assert/strict';
import test from 'node:test';
import { readableTextOnHex } from './colorContrast.js';

function luminance(hex) {
    const [r, g, b] = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
        .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

test('campaign palette keeps ordinary text at WCAG AA contrast', () => {
    for (const background of ['#A5925A', '#D9534F', '#9B6A8E', '#5B8C7B', '#3B3B3B', '#C77D5A']) {
        const text = readableTextOnHex(background);
        const a = luminance(background);
        const b = luminance(text);
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        assert.ok(ratio >= 4.5, `${background} has ${ratio.toFixed(2)}:1 contrast`);
    }
});
