import { Router } from 'express';
import multer from 'multer';
import { createHash } from 'node:crypto';
import { pool } from '../config/db.js';
import { auth, requireSupabaseAdmin } from '../middleware.js';
import { uploadLimiter } from '../middleware/rateLimiters.js';
import { parseAuthorizedNfe, parseManualNfe, reconcileNfe, validNfeKey } from '../lib/fiscalXml.js';

const router = Router();
const xmlUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 1 } });
const fail = (message, status = 422) => Object.assign(new Error(message), { status });
export function parseFiscalXmlUpload(buffer) {
    try { return parseAuthorizedNfe(buffer); }
    catch (error) { throw fail(error?.message || 'Arquivo XML fiscal inválido.'); }
}
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
        if (rows[0]) return res.json(publicDocument(rows[0]));
        const pending = await pool.query('SELECT id,order_id,access_key,entered_by,created_at FROM pending_fiscal_keys WHERE order_id=$1', [req.params.id]);
        const key = pending.rows[0];
        res.json(key ? { id: key.id, order_id: key.order_id, access_key: key.access_key.trim(),
            origin: 'key_only', status: 'pending_key', imported_by: key.entered_by,
            created_at: key.created_at, data: null, differences: [] } : null);
    } catch (error) { next(error); }
});

router.post(`${orderPath}/key`, uploadLimiter, async (req, res, next) => {
    let client;
    try {
        const key = String(req.body?.access_key ?? '').trim();
        if (!validNfeKey(key)) throw fail('Informe uma chave válida de 44 dígitos da NF-e modelo 55.');
        client = await pool.connect(); await client.query('BEGIN');
        const order = await client.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE', [req.params.id]);
        if (!order.rowCount) throw fail('Pedido não encontrado.', 404);
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
        const exists = await client.query(`SELECT 1 FROM fiscal_documents WHERE order_id=$1 OR access_key=$2
            UNION ALL SELECT 1 FROM pending_fiscal_keys WHERE order_id=$1 OR access_key=$2`, [req.params.id, key]);
        if (exists.rowCount) throw fail('Este pedido ou esta chave já possui cadastro fiscal. Confira antes de alterar.', 409);
        const result = await client.query('INSERT INTO pending_fiscal_keys(order_id,access_key,entered_by) VALUES($1,$2,$3) RETURNING id,order_id,access_key,entered_by,created_at',
            [req.params.id, key, req.user.id]);
        await client.query(`INSERT INTO audit_logs(admin_id,action,entity_type,entity_id,changes)
            VALUES($1,'fiscal.key_recorded','order',$2,$3)`, [req.user.id, req.params.id,
            JSON.stringify({ pending_id: result.rows[0].id, key_last4: key.slice(-4), shipping_released: false })]);
        await client.query('COMMIT');
        res.status(201).json({ id: result.rows[0].id, order_id: req.params.id, access_key: key,
            origin: 'key_only', status: 'pending_key', imported_by: req.user.id,
            created_at: result.rows[0].created_at, data: null, differences: [] });
    } catch (error) { if (client) await client.query('ROLLBACK').catch(() => {});
        next(error.code === '23505' ? fail('Este pedido ou esta chave já possui cadastro fiscal.', 409) : error); }
    finally { client?.release(); }
});

router.delete(`${orderPath}/key`, async (req, res, next) => {
    let client;
    try {
        client = await pool.connect(); await client.query('BEGIN');
        const order = await client.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE', [req.params.id]);
        if (!order.rowCount) throw fail('Pedido não encontrado.', 404);
        const pending = await client.query('DELETE FROM pending_fiscal_keys WHERE order_id=$1 RETURNING id,access_key', [req.params.id]);
        if (!pending.rowCount) throw fail('Não há chave pendente para remover.', 404);
        await client.query(`INSERT INTO audit_logs(admin_id,action,entity_type,entity_id,changes)
            VALUES($1,'fiscal.pending_key_removed','order',$2,$3)`, [req.user.id, req.params.id,
            JSON.stringify({ pending_id: pending.rows[0].id, key_last4: pending.rows[0].access_key.trim().slice(-4) })]);
        await client.query('COMMIT'); res.json({ removed: true });
    } catch (error) { if (client) await client.query('ROLLBACK').catch(() => {}); next(error); }
    finally { client?.release(); }
});

async function storeDocument(req, data, origin, xmlBytes = null, sha = null) {
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const { rows: orders } = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [req.params.id]);
        if (!orders[0]) throw fail('Pedido não encontrado.', 404);
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [data.key]);
        const { rows: existing } = await client.query('SELECT id FROM fiscal_documents WHERE order_id=$1 OR access_key=$2 OR xml_sha256=$3', [req.params.id, data.key, sha]);
        if (existing.length) throw fail('Já existe uma NF-e para este pedido ou esta chave já foi utilizada. Solicite revisão antes de substituir.', 409);
        const pending = await client.query('SELECT id,access_key FROM pending_fiscal_keys WHERE order_id=$1 FOR UPDATE', [req.params.id]);
        if (pending.rowCount && pending.rows[0].access_key.trim() !== data.key) {
            throw fail('A chave do documento difere da chave pendente. Remova a pendência explicitamente antes de cadastrar outra nota.', 409);
        }
        const otherPending = await client.query('SELECT 1 FROM pending_fiscal_keys WHERE access_key=$1 AND order_id<>$2', [data.key, req.params.id]);
        if (otherPending.rowCount) throw fail('Esta chave já está vinculada a outro pedido.', 409);
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
                JSON.stringify({ document_id: rows[0].id, origin, key_last4: data.key.slice(-4), status, differences,
                    completed_pending_key_id: pending.rows[0]?.id || null })]);
        if (pending.rowCount) await client.query('DELETE FROM pending_fiscal_keys WHERE id=$1', [pending.rows[0].id]);
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
        const data = parseFiscalXmlUpload(req.file.buffer);
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
