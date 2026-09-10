import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import { auth, requireAdmin } from '../middleware.js';
import { uploadLimiter } from '../middleware/rateLimiters.js';
import { createClient } from '@supabase/supabase-js';
import { pool } from '../config/db.js';

const router = Router();

// ─── Upload security ────────────────────────────────────────────────
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_EXTENSIONS = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const BUCKET = process.env.STORE_ASSETS_BUCKET || 'store-assets';

// ─── Strict folder allowlist (no arbitrary folders accepted) ────────
const ALLOWED_FOLDERS = [
    'banners',
    'products',
    'collections',
    'categories',
    'promotions',
    'branding/logo',
    'branding/favicon',
    'branding/og',
];

// ─── Magic-byte signatures for real MIME validation ────────────────
const MAGIC_BYTES = {
    'image/jpeg': [{ offset: 0, bytes: [0xFF, 0xD8, 0xFF] }],
    'image/png':  [{ offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] }],
    'image/webp': [{ offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }], // RIFF....WEBP
};

function detectRealMime(buffer) {
    for (const [mime, sigs] of Object.entries(MAGIC_BYTES)) {
        for (const sig of sigs) {
            const slice = buffer.subarray(sig.offset, sig.offset + sig.bytes.length);
            if (slice.length === sig.bytes.length && sig.bytes.every((b, i) => slice[i] === b)) {
                // For WEBP, also check for WEBP at offset 8
                if (mime === 'image/webp') {
                    const webpTag = buffer.subarray(8, 12).toString('ascii');
                    if (webpTag !== 'WEBP') continue;
                }
                return mime;
            }
        }
    }
    return null;
}

// ─── Supabase Storage client (server-side, uses service role key) ──
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseStorage = (supabaseUrl && supabaseServiceKey)
    ? createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })
    : null;

// Memory storage (don't save to disk — upload straight to Supabase)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_SIZE },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_MIMES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Formato não permitido. Use JPEG, PNG ou WEBP.'));
        }
    },
});

// ─── Folder mapping per upload type (frontend sends short keys) ─────
const FOLDER_MAP = {
    banner: 'banners',
    product: 'products',
    collection: 'collections',
    category: 'categories',
    promotion: 'promotions',
    logo: 'branding/logo',
    favicon: 'branding/favicon',
    og: 'branding/og',
};

// ─── Tables that may reference image URLs (for shared-file check) ──
const IMAGE_COLUMNS = [
    { table: 'products', columns: ["images"] },
    { table: 'banners', columns: ['image', 'image_mobile'] },
    { table: 'collections', columns: ['image', 'banner_image'] },
    { table: 'categories', columns: ['image'] },
    { table: 'promotions', columns: ['banner_image'] },
    { table: 'settings', columns: ['value'] }, // settings store logo/favicon in JSON
];

/**
 * Check if a file URL is referenced by any DB record.
 * Returns true if the file is still in use somewhere.
 */
async function isFileReferenced(fileUrl) {
    if (!fileUrl) return false;
    try {
        for (const { table, columns } of IMAGE_COLUMNS) {
            for (const col of columns) {
                // For array columns (products.images), use ANY; for text columns, use LIKE
                if (col === 'images') {
                    const res = await pool.query(
                        `SELECT 1 FROM ${table} WHERE ${col}::text ILIKE '%' || $1 || '%' LIMIT 1`,
                        [fileUrl]
                    );
                    if (res.rows.length > 0) return true;
                } else {
                    const res = await pool.query(
                        `SELECT 1 FROM ${table} WHERE ${col}::text ILIKE '%' || $1 || '%' LIMIT 1`,
                        [fileUrl]
                    );
                    if (res.rows.length > 0) return true;
                }
            }
        }
        return false;
    } catch (err) {
        console.error('[Upload] Reference check error:', err.message);
        // On error, don't delete — safer to keep the file
        return true;
    }
}

/**
 * Extract the storage path from a public URL.
 * URL format: https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
 */
function extractStoragePath(publicUrl) {
    if (!publicUrl) return null;
    const marker = `/storage/v1/object/public/${BUCKET}/`;
    const idx = publicUrl.indexOf(marker);
    if (idx === -1) return null;
    return publicUrl.substring(idx + marker.length);
}

// POST /api/upload — uploads to Supabase Storage store-assets bucket
router.post('/upload', auth, requireAdmin, uploadLimiter, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

    // ─── 1. Validate folder (strict allowlist) ─────────────────────
    const requestedFolder = req.body.folder || '';
    const folder = FOLDER_MAP[requestedFolder];
    if (!folder || !ALLOWED_FOLDERS.includes(folder)) {
        return res.status(400).json({ error: 'Pasta de destino não permitida.' });
    }

    // ─── 2. Re-validate MIME via magic bytes (don't trust header) ─
    const realMime = detectRealMime(req.file.buffer);
    if (!realMime || !ALLOWED_MIMES.includes(realMime)) {
        return res.status(400).json({ error: 'O arquivo não é uma imagem válida (JPEG, PNG ou WEBP).' });
    }

    // ─── 3. Validate extension matches MIME ────────────────────────
    const ext = ALLOWED_EXTENSIONS[realMime];

    // ─── 4. Generate safe filename: UUID + timestamp + validated ext ─
    const uuid = crypto.randomUUID();
    const ts = Date.now();
    const safeFileName = `${folder}/${uuid}-${ts}${ext}`;

    // ─── 5. Upload to Supabase Storage ─────────────────────────────
    if (supabaseStorage) {
        try {
            const { error: uploadError } = await supabaseStorage
                .storage
                .from(BUCKET)
                .upload(safeFileName, req.file.buffer, {
                    contentType: realMime,
                    upsert: false,
                });

            if (uploadError) {
                console.error('[Upload] Supabase error:', uploadError.message);
                return res.status(500).json({ error: 'Não foi possível enviar a imagem.' });
            }

            const { data: { publicUrl } } = supabaseStorage
                .storage
                .from(BUCKET)
                .getPublicUrl(safeFileName);

            return res.json({ file_url: publicUrl, path: safeFileName });
        } catch (err) {
            console.error('[Upload] Unexpected error:', err.message);
            return res.status(500).json({ error: 'Não foi possível enviar a imagem.' });
        }
    }

    // Fallback: local storage (dev only)
    const fs = await import('fs');
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const localPath = path.join(uploadDir, safeFileName.replace(/\//g, '-'));
    fs.writeFileSync(localPath, req.file.buffer);
    return res.json({ file_url: `/api/uploads/${path.basename(localPath)}`, path: safeFileName });
});

// DELETE /api/upload — removes a file from storage (with shared-file protection)
router.delete('/upload', auth, requireAdmin, async (req, res) => {
    const { file_url } = req.body;
    if (!file_url) return res.status(400).json({ error: 'URL do arquivo é obrigatória.' });

    // ─── Check if file is referenced by any record ────────────────
    const inUse = await isFileReferenced(file_url);
    if (inUse) {
        return res.status(409).json({ error: 'Este arquivo ainda está em uso e não pode ser removido.' });
    }

    // ─── Extract storage path and delete ──────────────────────────
    const storagePath = extractStoragePath(file_url);
    if (!storagePath) {
        return res.status(400).json({ error: 'Não foi possível identificar o arquivo.' });
    }

    if (supabaseStorage) {
        try {
            const { error } = await supabaseStorage
                .storage
                .from(BUCKET)
                .remove([storagePath]);

            if (error) {
                console.error('[Upload] Delete error:', error.message);
                return res.status(500).json({ error: 'Não foi possível remover o arquivo.' });
            }
            return res.json({ success: true });
        } catch (err) {
            console.error('[Upload] Delete unexpected error:', err.message);
            return res.status(500).json({ error: 'Não foi possível remover o arquivo.' });
        }
    }

    // Fallback: local delete
    const fs = await import('fs');
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const localName = storagePath.replace(/\//g, '-');
    const localPath = path.join(uploadDir, localName);
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
    return res.json({ success: true });
});

export default router;
