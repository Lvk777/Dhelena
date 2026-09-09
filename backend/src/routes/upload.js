import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { auth, requireAdmin } from '../middleware.js';

const router = Router();
const uploadDir = process.env.UPLOAD_DIR || './uploads';

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext);
    },
});

const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/upload', auth, requireAdmin, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    res.json({ file_url: `/api/uploads/${req.file.filename}` });
});

export default router;
