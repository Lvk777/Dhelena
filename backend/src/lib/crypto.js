import crypto from 'crypto';

/**
 * AES-256-GCM encryption for sensitive integration secrets.
 * The master key comes from INTEGRATION_ENCRYPTION_KEY env var.
 * Encrypted values are stored as: base64(iv):base64(authTag):base64(ciphertext)
 */

const ALGO = 'aes-256-gcm';

function getKey() {
    const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
    if (!raw) throw new Error('INTEGRATION_ENCRYPTION_KEY not set');
    // Use SHA-256 of the key to always get exactly 32 bytes for AES-256
    return crypto.createHash('sha256').update(raw).digest();
}

export function encrypt(value) {
    if (!value || typeof value !== 'string') return value;
    const key = getKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    const enc = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${enc.toString('base64')}`;
}

export function decrypt(encrypted) {
    if (!encrypted || typeof encrypted !== 'string') return encrypted;
    // If not in encrypted format, return as-is (legacy plain value)
    const parts = encrypted.split(':');
    if (parts.length !== 3) return encrypted;
    try {
        const key = getKey();
        const iv = Buffer.from(parts[0], 'base64');
        const authTag = Buffer.from(parts[1], 'base64');
        const enc = Buffer.from(parts[2], 'base64');
        const decipher = crypto.createDecipheriv(ALGO, key, iv);
        decipher.setAuthTag(authTag);
        const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
        return dec.toString('utf8');
    } catch {
        return null; // Decryption failed — treat as no value
    }
}

/**
 * Mask a sensitive value for frontend display.
 * Returns last 4 chars: ****8F2A
 */
export function maskSecret(value) {
    if (!value || typeof value !== 'string') return '';
    if (value.length <= 4) return '****';
    return '****' + value.slice(-4).toUpperCase();
}

/**
 * Determine if a config field is sensitive based on its key name.
 */
export function isSensitive(key) {
    return /token|key|secret|password|api_key|access_token|service_role|database_url/i.test(key);
}
