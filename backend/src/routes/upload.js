import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { auth, requireAdmin } from '../middleware.js';

const router = Router();
const uploadDir = process.env.UPLOAD_DIR || './uploads';

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ─── Upload security ────────────────────────────────────────────────
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        // Generate safe filename — no user input in path
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: MAX_SIZE },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_MIMES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Formato não permitido. Use JPEG, PNG ou WEBP.'));
        }
    },
});

// POST /api/upload — local dev fallback (Supabase Storage used in production via frontend)
router.post('/upload', auth, requireAdmin, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    res.json({ file_url: `/api/uploads/${req.file.filename}` });
});

export default router;
