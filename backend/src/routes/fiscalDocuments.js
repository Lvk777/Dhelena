import { Router } from 'express';
import multer from 'multer';
import { createHash } from 'node:crypto';
import { pool } from '../config/db.js';
import { auth, requireSupabaseAdmin } from '../middleware.js';
import { uploadLimiter } from '../middleware/rateLimiters.js';
import { parseAuthorizedNfe, parseManualNfe, reconcileNfe } from '../lib/fiscalXml.js';

const router = Router();
const xmlUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 1 } });
const fail = (message, status = 422) => Object.assign(new Error(message), { status });
const fields = 'id,order_id,access_key,origin,parsed_data,differences,status,official_source,official_checked_at,imported_by,verified_by,created_at';
const publicDocument = row => row && ({ id: row.id, order_id: row.order_id, access_key: row.access_key.trim(),
    origin: row.origin, imported_by: row.imported_by, verified_by: row.verified_by,
    data: row.parsed_data, differences: row.differences, status: row.status,
    official_source: row.official_source, official_checked_at: row.official_checked_at,
    created_at: row.created_at });
const orderPath = '/orders/:id/fiscal';
export const fiscalXmlImportEnabled = (env = process.env) => env.FISCAL_XML_IMPORT_ENABLED === 'true';
export function validateFiscalVerification(input = {}) {
    const { access_key: key, protocol, confirmed_authorized: confirmed,
        confirmed_document_matches: matches, source } = input;
    if (confirmed !== true || matches !== true || !['national', 'svrs'].includes(source)) {
        throw fail('Confirme no portal oficial a autorização e a correspondência dos dados completos da NF-e.');
    }
    return { key, protocol, source };
}
export function requireFiscalXmlImport(req, res, next, env = process.env) {
    if (!fiscalXmlImportEnabled(env)) return res.status(503).json({ error: 'Importação de NF-e indisponível até a homologação fiscal.' });
    next();
}
router.use(orderPath, auth, requireSupabaseAdmin, requireFiscalXmlImport);

router.get(orderPath, async (req, res, next) => {
    try {
        const { rows } = await pool.query(`SELECT ${fields} FROM fiscal_documents WHERE order_id=$1`, [req.params.id]);
        res.json(publicDocument(rows[0]) || null);
    } catch (error) { next(error); }
});

async function storeDocument(req, data, origin, xmlBytes = null, sha = null) {
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const { rows: orders } = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [req.params.id]);
        if (!orders[0]) throw fail('Pedido não encontrado.', 404);
        const { rows: existing } = await client.query('SELECT id FROM fiscal_documents WHERE order_id=$1 OR access_key=$2 OR xml_sha256=$3', [req.params.id, data.key, sha]);
        if (existing.length) throw fail('Já existe uma NF-e para este pedido ou esta chave já foi utilizada. Solicite revisão antes de substituir.', 409);
        const { rows: items } = await client.query('SELECT * FROM order_items WHERE order_id=$1', [req.params.id]);
        const { rows: sender } = await client.query("SELECT value FROM settings WHERE key='shipping_sender'");
        const differences = reconcileNfe(data, orders[0], items, sender[0]?.value?.document);
        const status = differences.length ? 'needs_review' : 'pending_official';
        const { rows } = await client.query(`INSERT INTO fiscal_documents
            (order_id,access_key,origin,xml_bytes,xml_sha256,parsed_data,differences,status,imported_by)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${fields}`,
        [req.params.id, data.key, origin, xmlBytes, sha, JSON.stringify(data), JSON.stringify(differences), status, req.user.id]);
        await client.query(`INSERT INTO audit_logs(admin_id,action,entity_type,entity_id,changes) VALUES($1,$2,'order',$3,$4)`,
            [req.user.id, origin === 'xml' ? 'fiscal.xml_imported' : 'fiscal.manual_recorded', req.params.id,
                JSON.stringify({ document_id: rows[0].id, origin, key_last4: data.key.slice(-4), status, differences })]);
        await client.query('COMMIT');
        return publicDocument(rows[0]);
    } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        if (error.code === '23505') throw fail('Esta NF-e já foi cadastrada. Nenhum documento foi alterado.', 409);
        throw error;
    } finally { client?.release(); }
}

router.post(orderPath, uploadLimiter, (req, res, next) => xmlUpload.single('file')(req, res, error => {
    if (error) return next(fail('Selecione um XML de NF-e de até 1 MB.'));
    next();
}), async (req, res, next) => {
    if (!req.file || !/\.xml$/i.test(req.file.originalname)) return next(fail('Selecione um arquivo .xml da NF-e.'));
    try {
        const data = parseAuthorizedNfe(req.file.buffer);
        const sha = createHash('sha256').update(req.file.buffer).digest('hex');
        res.status(201).json(await storeDocument(req, data, 'xml', req.file.buffer, sha));
    } catch (error) { next(error); }
});

router.post(`${orderPath}/manual`, uploadLimiter, async (req, res, next) => {
    try { res.status(201).json(await storeDocument(req, parseManualNfe(req.body), 'manual')); }
    catch (error) { next(error); }
});

router.post(`${orderPath}/verify`, async (req, res, next) => {
    let client;
    try {
        const { key, protocol, source } = validateFiscalVerification(req.body);
        client = await pool.connect(); await client.query('BEGIN');
        const { rows } = await client.query('SELECT * FROM fiscal_documents WHERE order_id=$1 FOR UPDATE', [req.params.id]);
        const row = rows[0];
        if (!row) throw fail('Cadastre a NF-e antes da conferência.', 404);
        if (row.status === 'verified') throw fail('Esta NF-e já foi conferida. Nenhum dado foi alterado.', 409);
        if (row.differences.length) throw fail('Há divergências com o pedido. Consulte a administração e a contabilidade.', 409);
        if (key !== row.access_key.trim() || protocol !== row.parsed_data.protocol) throw fail('Chave ou protocolo não conferem com a NF-e cadastrada.');
        const officialSource = source === 'svrs' ? 'https://dfe-portal.svrs.rs.gov.br/Nfe/da' : 'https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx';
        const result = await client.query(`UPDATE fiscal_documents SET status='verified',official_source=$2,official_checked_at=now(),verified_by=$3,updated_at=now()
            WHERE id=$1 RETURNING ${fields}`, [row.id, officialSource, req.user.id]);
        await client.query(`INSERT INTO audit_logs(admin_id,action,entity_type,entity_id,changes) VALUES($1,'fiscal.official_check_attested','order',$2,$3)`,
            [req.user.id, req.params.id, JSON.stringify({ document_id: row.id, source: officialSource,
                key_last4: key.slice(-4), origin: row.origin,
                authorization_attested: true, full_content_match_attested: true })]);
        await client.query('COMMIT'); res.json(publicDocument(result.rows[0]));
    } catch (error) { if (client) await client.query('ROLLBACK').catch(() => {}); next(error); }
    finally { client?.release(); }
});

router.get(`${orderPath}/download`, async (req, res, next) => {
    try {
        const { rows } = await pool.query('SELECT access_key,origin,xml_bytes,status FROM fiscal_documents WHERE order_id=$1', [req.params.id]);
        if (!rows[0]) throw fail('Documento não encontrado.', 404);
        if (rows[0].origin !== 'xml' || !rows[0].xml_bytes) throw fail('Cadastro manual não possui XML para download.', 409);
        if (rows[0].status !== 'verified') throw fail('O documento ainda não foi conferido na fonte oficial.', 409);
        res.set('Cache-Control', 'no-store');
        res.json({ filename: `NFe-${rows[0].access_key.trim()}.xml`, xml_base64: rows[0].xml_bytes.toString('base64') });
    } catch (error) { next(error); }
});

export default router;
