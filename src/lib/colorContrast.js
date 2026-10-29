function luminance(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return null;
    const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const [r, g, b] = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function readableTextOnHex(background) {
    const value = luminance(background);
    if (value === null) return '#000000';
    return (value + 0.05) / 0.05 >= 4.5 ? '#000000' : '#FFFFFF';
}
