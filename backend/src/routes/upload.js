import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { auth, requireAdmin } from '../middleware.js';
import { uploadLimiter } from '../middleware/rateLimiters.js';
import { createClient } from '@supabase/supabase-js';

const router = Router();

// ─── Upload security ────────────────────────────────────────────────
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const BUCKET = process.env.STORE_ASSETS_BUCKET || 'store-assets';

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

// ─── Folder mapping per upload type ────────────────────────────────
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

// POST /api/upload — uploads to Supabase Storage store-assets bucket
router.post('/upload', auth, requireAdmin, uploadLimiter, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

    const folder = FOLDER_MAP[req.body.folder] || 'misc';
    const ext = path.extname(req.file.originalname).toLowerCase() || '.webp';
    const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;

    // Try Supabase Storage first
    if (supabaseStorage) {
        try {
            const { error: uploadError } = await supabaseStorage
                .storage
                .from(BUCKET)
                .upload(fileName, req.file.buffer, {
                    contentType: req.file.mimetype,
                    upsert: false,
                });

            if (uploadError) {
                console.error('[Upload] Supabase error:', uploadError.message);
                return res.status(500).json({ error: 'Não foi possível enviar a imagem.' });
            }

            const { data: { publicUrl } } = supabaseStorage
                .storage
                .from(BUCKET)
                .getPublicUrl(fileName);

            return res.json({ file_url: publicUrl });
        } catch (err) {
            console.error('[Upload] Unexpected error:', err.message);
            return res.status(500).json({ error: 'Não foi possível enviar a imagem.' });
        }
    }

    // Fallback: local storage (dev only)
    const fs = await import('fs');
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const localPath = path.join(uploadDir, fileName.replace(/\//g, '-'));
    fs.writeFileSync(localPath, req.file.buffer);
    return res.json({ file_url: `/api/uploads/${path.basename(localPath)}` });
});

export default router;
