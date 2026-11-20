import { Router } from 'express';
import multer from 'multer';
import { createHash } from 'node:crypto';
import { pool } from '../config/db.js';
import { auth, requireSupabaseAdmin } from '../middleware.js';
import { uploadLimiter } from '../middleware/rateLimiters.js';
import { assessNfe, parseAuthorizedNfe, parseManualNfe, reconcileNfe, validNfeKey } from '../lib/fiscalXml.js';
import { fiscalMappingKey, loadReusableMappings, orderVariantIdentity,
    resolveReusableMappings, reusableMappingDecision } from '../lib/fiscalProductMappings.js';
import { assertFiscalUnlinkEligible, unlinkFiscalDocument, validateFiscalUnlink } from '../services/fiscalUnlink.js';

const router = Router();
const xmlUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 1 } });
const fail = (message, status = 422) => Object.assign(new Error(message), { status });
export const fiscalContextHash = (order, items, senderDocument) => createHash('sha256').update(JSON.stringify({
    customer: { name: order.snapshot?.customer?.name, cpf: order.snapshot?.customer?.cpf,
        cnpj: order.snapshot?.customer?.cnpj },
    amounts: [order.subtotal, order.shipping_cost, order.discount, order.total].map(String),
    senderDocument, items: items.map(item => ({ id: item.id, product_id: item.product_id,
        product_name: item.product_name, product_sku: item.product_sku, color_name: item.color_name,
        size: item.size, quantity: item.quantity, subtotal: String(item.subtotal) })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
})).digest('hex');
const reviewAuditSql = `SELECT a.changes,a.created_at,COALESCE(p.full_name,p.email) AS reviewed_by
    FROM audit_logs a LEFT JOIN profiles p ON p.id=a.admin_id
    WHERE a.action='fiscal.equivalence_confirmed' AND a.entity_id=$1 AND a.changes->>'document_id'=$2
    ORDER BY a.created_at,a.id`;
export function reviewFromAudit(rows, xmlHash, contextHash) {
    const review = { recipientConfirmed: false, productConfirmed: false, productMatches: [] };
    const records = [];
    let stale = false;
    for (const row of rows) {
        const entry = row.changes || {};
        if (entry.xml_sha256 !== xmlHash || entry.comparison_sha256 !== contextHash) { stale = true; continue; }
        const fields = Array.isArray(entry.fields_compared) ? entry.fields_compared : [];
        if (fields.includes('recipient_name')) review.recipientConfirmed = true;
        if (fields.includes('product_code')) {
            review.productConfirmed = true;
            review.orderItemId = entry.order_item_id;
            review.fiscalIndex = entry.fiscal_index;
            review.productMatches.push({ orderItemId: entry.order_item_id, fiscalIndex: entry.fiscal_index });
        }
        records.push({ created_at: row.created_at, reviewed_by: row.reviewed_by || 'administrador',
            fields_compared: fields, reason: entry.reason, evidence: entry.evidence,
            reusable_mapping_saved: entry.reusable_mapping_saved === true });
    }
    return { review, records, stale };
}
const combinedReview = (review, automatic) => ({ ...review,
    productMatches: [...(review.productMatches || []), ...automatic.productMatches] });
export function parseFiscalXmlUpload(buffer) {
    try { return parseAuthorizedNfe(buffer); }
    catch (error) { throw fail(error?.message || 'Arquivo XML fiscal inválido.'); }
}
const fields = 'id,order_id,access_key,origin,xml_sha256,parsed_data,differences,status,official_source,official_checked_at,imported_by,verified_by,created_at';
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
export function validateFiscalEquivalence(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw fail('Informe os dados da conferência de equivalência.');
    const productConfirmed = input.confirmed_product_match === true;
    if (!/^[0-9a-f-]{36}$/i.test(String(input.document_id || ''))
        || (input.confirmed_recipient === true) === productConfirmed
        || (input.save_for_future === true && !productConfirmed)
        || (productConfirmed && (!/^[0-9a-f-]{36}$/i.test(String(input.order_item_id || ''))
            || !Number.isInteger(input.fiscal_index) || input.fiscal_index < 0))) {
        throw fail('Selecione a variante do pedido e confirme somente após conferir que ela representa a mesma mercadoria da NF-e.');
    }
    return { documentId: input.document_id, orderItemId: input.order_item_id,
        fiscalIndex: input.fiscal_index, recipientConfirmed: input.confirmed_recipient === true,
        productConfirmed,
        saveForFuture: input.save_for_future === true };
}
export function requireFiscalXmlImport(req, res, next, env = process.env) {
    if (!fiscalXmlImportEnabled(env)) return res.status(503).json({ error: 'Importação de NF-e indisponível até a homologação fiscal.' });
    next();
}
router.use(orderPath, auth, requireSupabaseAdmin, requireFiscalXmlImport);
router.use('/products/:id/nff-mappings', auth, requireSupabaseAdmin, requireFiscalXmlImport);

export async function saveNffVariantMapping(productId, actorId, input, db = pool) {
    const code = String(input?.code ?? '').trim(), description = String(input?.description ?? '').trim();
    const colorId = String(input?.color_id ?? ''), size = String(input?.size ?? '');
    if (!code || code.length > 60 || !description || description.length > 255
        || !colorId || !size || input?.confirmed_match !== true)
        throw fail('Informe o código e a descrição usados no NFF e confirme a variante após conferir o cadastro fiscal.');
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout='2000ms'");
        const { rows: products } = await client.query('SELECT id,name,colors,sizes FROM products WHERE id=$1 FOR UPDATE', [productId]);
        const product = products[0];
        const color = product?.colors?.find(entry => entry.id === colorId);
        if (!product || !color || !product.sizes?.includes(size))
            throw fail('A variante mudou. Atualize o produto e selecione uma cor e tamanho cadastrados.', 409);
        if (input.expected_color_name !== undefined && color.name !== input.expected_color_name)
            throw fail('A cor tem alterações ainda não salvas. Salve o produto antes de registrar a correspondência NFF.', 409);
        if (input.expected_product_name !== undefined && product.name !== input.expected_product_name)
            throw fail('O nome do produto tem alterações ainda não salvas. Salve o produto antes de registrar a correspondência NFF.', 409);
        const { rows: sender } = await client.query("SELECT value FROM settings WHERE key='shipping_sender'");
        const key = fiscalMappingKey(sender[0]?.value?.document, { code, name: description });
        const variant = orderVariantIdentity({ product_id: productId, color_id: colorId, size });
        if (!key || !variant) throw fail('Confira o CNPJ da loja e os identificadores da variante antes de salvar.');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify(key)]);
        const existing = await loadReusableMappings(client, { issuerCnpj: key.issuer, items: [{ code }] });
        const decision = reusableMappingDecision(existing, key, variant);
        if (decision === 'conflict') throw fail('Este código e descrição do NFF já estão associados a outra variante. Solicite revisão fiscal.', 409);
        if (decision === 'new') await client.query(`INSERT INTO audit_logs(admin_id,action,entity_type,entity_id,changes)
            VALUES($1,'fiscal.product_mapping_saved','product',$2,$3)`, [actorId, productId,
            JSON.stringify({ issuer_cnpj: key.issuer, fiscal_code: key.code,
                fiscal_description: key.description, fiscal_description_original: description,
                product_id: variant.productId, color_id: variant.colorId, size: variant.size,
                order_color: color.name, order_product_name: product.name,
                confirmation: 'admin_checked_nff_catalog_and_variant', shipping_released: false })]);
        await client.query('COMMIT');
        return { saved: decision === 'new', code, description, color_id: colorId, size };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error.code === '55P03' ? fail('Outra operação está atualizando esta variante. Aguarde e tente novamente.', 409) : error;
    } finally { client.release(); }
}

router.get('/products/:id/nff-mappings', async (req, res, next) => {
    try {
        const { rows } = await pool.query(`SELECT changes,created_at FROM audit_logs
            WHERE action='fiscal.product_mapping_saved' AND changes->>'product_id'=$1
            ORDER BY created_at DESC`, [req.params.id]);
        res.set('Cache-Control', 'no-store');
        res.json(rows.map(row => ({ code: row.changes.fiscal_code,
            description: row.changes.fiscal_description_original || row.changes.fiscal_description,
            color_id: row.changes.color_id, size: row.changes.size, created_at: row.created_at })));
    } catch (error) { next(error); }
});
router.post('/products/:id/nff-mappings', uploadLimiter, async (req, res, next) => {
    try { res.status(201).json(await saveNffVariantMapping(req.params.id, req.user.id, req.body)); }
    catch (error) { next(error); }
});

router.get(orderPath, async (req, res, next) => {
    try {
        res.set('Cache-Control', 'no-store');
        const { rows } = await pool.query(`SELECT ${fields} FROM fiscal_documents WHERE order_id=$1 AND unlinked_at IS NULL`, [req.params.id]);
        if (rows[0]) {
            const result = publicDocument(rows[0]);
            const { rows: orders } = await pool.query('SELECT * FROM orders WHERE id=$1', [req.params.id]);
            const { rows: items } = await pool.query('SELECT * FROM order_items WHERE order_id=$1', [req.params.id]);
            const { rows: sender } = await pool.query("SELECT value FROM settings WHERE key='shipping_sender'");
            const { rows: auditRows } = await pool.query(reviewAuditSql, [req.params.id, rows[0].id]);
            const reviewed = reviewFromAudit(auditRows, rows[0].xml_sha256,
                fiscalContextHash(orders[0], items, sender[0]?.value?.document));
            const automatic = resolveReusableMappings(rows[0].parsed_data, items,
                await loadReusableMappings(pool, rows[0].parsed_data));
            result.analysis = assessNfe(rows[0].parsed_data, orders[0], items,
                sender[0]?.value?.document, combinedReview(reviewed.review, automatic));
            result.differences = result.analysis.issues.map(issue => issue.message);
            if (rows[0].status === 'needs_review' && !result.differences.length) result.status = 'pending_official';
            result.equivalence_reviews = reviewed.records;
            result.automatic_product_matches = automatic.productMatches.length;
            if (reviewed.stale) result.review_stale = true;
            return res.json(result);
        }
        const pending = await pool.query('SELECT id,order_id,access_key,entered_by,created_at FROM pending_fiscal_keys WHERE order_id=$1', [req.params.id]);
        const key = pending.rows[0];
        res.json(key ? { id: key.id, order_id: key.order_id, access_key: key.access_key.trim(),
            origin: 'key_only', status: 'pending_key', imported_by: key.entered_by,
            created_at: key.created_at, data: null, differences: [] } : null);
    } catch (error) { next(error); }
});

export async function confirmFiscalEquivalence(orderId, actorId, input, db = pool) {
    let client;
    try {
        const review = validateFiscalEquivalence(input);
        client = await db.connect(); await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout='2000ms'");
        const { rows: orders } = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
        if (!orders[0]) throw fail('Pedido não encontrado.', 404);
        const { rows } = await client.query('SELECT * FROM fiscal_documents WHERE order_id=$1 AND unlinked_at IS NULL FOR UPDATE', [orderId]);
        const document = rows[0];
        if (!document || document.id !== review.documentId || document.status !== 'needs_review' || document.origin !== 'xml')
            throw fail('A nota fiscal ou sua situação mudou. Atualize o pedido antes de conferir novamente.', 409);
        const { rows: items } = await client.query('SELECT * FROM order_items WHERE order_id=$1', [orderId]);
        const { rows: sender } = await client.query("SELECT value FROM settings WHERE key='shipping_sender'");
        const contextHash = fiscalContextHash(orders[0], items, sender[0]?.value?.document);
        const { rows: auditRows } = await client.query(reviewAuditSql, [orderId, document.id]);
        const reviewed = reviewFromAudit(auditRows, document.xml_sha256, contextHash);
        if (reviewed.stale) throw fail('O pedido mudou desde a conferência anterior. Solicite uma nova análise fiscal.', 409);
        const automatic = resolveReusableMappings(document.parsed_data, items,
            await loadReusableMappings(client, document.parsed_data));
        const before = assessNfe(document.parsed_data, orders[0], items,
            sender[0]?.value?.document, combinedReview(reviewed.review, automatic));
        const selectedCandidate = before.manualCandidates.find(candidate =>
            candidate.orderItemId === review.orderItemId && candidate.fiscalIndex === review.fiscalIndex);
        const hasNameIssue = before.issues.some(issue => issue.code === 'recipient_name');
        const hasProductIssue = before.issues.some(issue => issue.code === 'product_identity');
        if ((review.recipientConfirmed && (!hasNameIssue || !before.abbreviatedName))
            || (review.productConfirmed && (!hasProductIssue || !selectedCandidate))) {
            throw fail('Há outras divergências ou a correspondência mudou. Confira o pedido e o XML; a expedição permanece bloqueada.', 409);
        }
        let mappingSaved = false;
        if (review.saveForFuture) {
            const candidate = selectedCandidate;
            const item = document.parsed_data.items[review.fiscalIndex];
            const row = items.find(entry => entry.id === review.orderItemId);
            const key = fiscalMappingKey(document.parsed_data.issuerCnpj, item);
            const variant = orderVariantIdentity(row);
            if (!key || !variant || candidate?.orderItemId !== row.id)
                throw fail('Esta variante não tem identificação estável para reutilizar a correspondência. Registre apenas a conferência desta nota.', 422);
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
                [JSON.stringify(key)]);
            const latest = await loadReusableMappings(client, document.parsed_data);
            const decision = reusableMappingDecision(latest, key, variant);
            if (decision === 'conflict') throw fail('O código fiscal já tem uma correspondência diferente. Solicite revisão antes de reutilizá-lo.', 409);
            if (decision === 'new') {
                await client.query(`INSERT INTO audit_logs(admin_id,action,entity_type,entity_id,changes)
                    VALUES($1,'fiscal.product_mapping_saved','order',$2,$3)`, [actorId, orderId,
                    JSON.stringify({ document_id: document.id, issuer_cnpj: key.issuer,
                        fiscal_code: key.code, fiscal_description: key.description,
                        product_id: variant.productId, color_id: variant.colorId, size: variant.size,
                        order_sku: row.product_sku, order_color: row.color_name,
                        confirmation: 'admin_checked_nff_catalog_and_variant',
                        xml_sha256: document.xml_sha256, shipping_released: false })]);
                mappingSaved = true;
            }
        }
        const after = assessNfe(document.parsed_data, orders[0], items, sender[0]?.value?.document,
            { ...reviewed.review, recipientConfirmed: reviewed.review.recipientConfirmed || review.recipientConfirmed,
                productConfirmed: reviewed.review.productConfirmed || review.productConfirmed,
                orderItemId: review.productConfirmed ? review.orderItemId : reviewed.review.orderItemId,
                fiscalIndex: review.productConfirmed ? review.fiscalIndex : reviewed.review.fiscalIndex,
                productMatches: [...combinedReview(reviewed.review, automatic).productMatches,
                    ...(review.productConfirmed ? [{ orderItemId: review.orderItemId,
                        fiscalIndex: review.fiscalIndex }] : [])] });
        const remaining = after.issues.map(issue => issue.message);
        const status = remaining.length ? 'needs_review' : 'pending_official';
        const updated = await client.query(`UPDATE fiscal_documents SET differences=$2::jsonb,
            status=$3,updated_at=now() WHERE id=$1 AND status='needs_review' RETURNING ${fields}`,
        [document.id, JSON.stringify(remaining), status]);
        if (updated.rowCount !== 1) throw fail('A nota fiscal mudou durante a conferência. Atualize o pedido.', 409);
        await client.query(`INSERT INTO audit_logs(admin_id,action,entity_type,entity_id,changes)
            VALUES($1,'fiscal.equivalence_confirmed','order',$2,$3)`, [actorId, orderId,
            JSON.stringify({ document_id: document.id, xml_sha256: document.xml_sha256,
                comparison_sha256: contextHash,
                fields_compared: [
                    ...(review.recipientConfirmed ? ['recipient_name','recipient_document'] : []),
                    ...(review.productConfirmed ? ['product_description','product_code','product_color','product_size','quantity','item_value'] : []),
                ],
                order_item_id: review.orderItemId, fiscal_index: review.fiscalIndex,
                fiscal_code: selectedCandidate?.fiscalCode, order_sku: selectedCandidate?.orderSku,
                order_color: selectedCandidate?.orderColor, fiscal_color: selectedCandidate?.fiscalColor,
                order_product_name: selectedCandidate?.productName,
                fiscal_product_name: selectedCandidate?.fiscalName,
                product_size: selectedCandidate?.size,
                product_quantity: selectedCandidate?.quantity,
                product_value_cents: selectedCandidate?.productCents,
                confirmation: 'admin_checked_nff_catalog_and_variant', reusable_mapping_saved: mappingSaved,
                official_status_verified: false,
                shipping_released: false })]);
        await client.query('COMMIT');
        return { ...publicDocument(updated.rows[0]), analysis: after, equivalence_reviewed: true };
    } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        throw error.code === '55P03' ? fail('Outra operação está atualizando este pedido. Aguarde e tente novamente.', 409) : error;
    } finally { client?.release(); }
}

router.post(`${orderPath}/equivalence`, uploadLimiter, async (req, res, next) => {
    try { res.json(await confirmFiscalEquivalence(req.params.id, req.user.id, req.body)); }
    catch (error) { next(error); }
});

router.get(`${orderPath}/history`, async (req, res, next) => {
    try {
        const { rows } = await pool.query(`SELECT fd.id,fd.access_key,fd.origin,fd.status,fd.created_at,fd.unlinked_at,
            fd.unlink_reason,fd.unlink_official_source,fd.prior_official_status,
            COALESCE(p.full_name,p.email) AS reviewed_by,fd.parsed_data->>'number' AS number,
            fd.parsed_data->>'series' AS series FROM fiscal_documents fd
            LEFT JOIN profiles p ON p.id=fd.unlinked_by
            WHERE fd.order_id=$1 AND fd.unlinked_at IS NOT NULL ORDER BY fd.unlinked_at DESC`, [req.params.id]);
        const { rows: priorLinks } = await pool.query(`SELECT fd.id,fd.access_key,fd.origin,fd.status,fd.created_at,
            a.created_at AS unlinked_at,a.changes->>'reason' AS unlink_reason,
            a.changes->>'official_source' AS unlink_official_source,
            a.changes->>'prior_official_status' AS prior_official_status,
            COALESCE(p.full_name,p.email) AS reviewed_by,fd.parsed_data->>'number' AS number,
            fd.parsed_data->>'series' AS series FROM audit_logs a
            JOIN fiscal_documents fd ON fd.id::text=a.changes->>'document_id'
            LEFT JOIN profiles p ON p.id=a.admin_id
            WHERE a.action='fiscal.xml_unlinked' AND a.entity_id=$1
            AND fd.order_id=$1::uuid AND fd.unlinked_at IS NULL ORDER BY a.created_at DESC`, [req.params.id]);
        res.set('Cache-Control', 'no-store');
        res.json([...rows, ...priorLinks].sort((a, b) => new Date(b.unlinked_at) - new Date(a.unlinked_at))
            .map(row => ({ ...row, access_key_last4: row.access_key.trim().slice(-4), access_key: undefined })));
    } catch (error) { next(error); }
});

router.post(`${orderPath}/unlink`, uploadLimiter, async (req, res, next) => {
    try { res.json(await unlinkFiscalDocument(req.params.id, req.user.id, req.body)); }
    catch (error) { next(error); }
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

export async function storeDocument(req, data, origin, xmlBytes = null, sha = null, db = pool, replaceInput = null) {
    let client;
    try {
        client = await db.connect();
        await client.query('BEGIN');
        const { rows: orders } = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [req.params.id]);
        if (!orders[0]) throw fail('Pedido não encontrado.', 404);
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [data.key]);
        const { rows: activeRows } = await client.query(`SELECT * FROM fiscal_documents
            WHERE order_id=$1 AND unlinked_at IS NULL FOR UPDATE`, [req.params.id]);
        const active = activeRows[0];
        const { rows: duplicateRows } = await client.query(`SELECT * FROM fiscal_documents
            WHERE access_key=$1 OR ($2::text IS NOT NULL AND xml_sha256=$2) FOR UPDATE`, [data.key, sha]);
        const duplicate = duplicateRows.find(row => row.access_key.trim() === data.key) || duplicateRows[0];
        if (active && !replaceInput) throw fail('Já existe uma nota vinculada a este pedido. Use “Substituir XML” para trocar o documento.', 409);
        if (replaceInput && !active) throw fail('A nota ativa mudou. Atualize o pedido; nenhuma substituição foi feita.', 409);
        if (duplicateRows.some(row => row.order_id !== req.params.id))
            throw fail('Esta chave fiscal pertence a outro pedido. Confira o XML antes de continuar.', 409);
        if (duplicateRows.length > 1)
            throw fail('A chave e o arquivo já constam em registros fiscais diferentes. Solicite análise fiscal antes de continuar.', 409);
        if (duplicate && (duplicate.access_key.trim() !== data.key || duplicate.xml_sha256 !== sha))
            throw fail('A chave já foi registrada com um XML diferente. Solicite análise fiscal; o documento anterior permanece preservado.', 409);
        if (duplicate && !duplicate.unlinked_at)
            throw fail('Esta nota já está vinculada ao pedido. Nenhum documento foi duplicado.', 409);
        let replacementReview = null;
        if (replaceInput) {
            if (origin !== 'xml') throw fail('A substituição exige o XML original da NF-e.', 422);
            replacementReview = validateFiscalUnlink({ ...replaceInput,
                reason: 'Substituição administrativa por novo XML' });
            assertFiscalUnlinkEligible(orders[0]);
            if (replacementReview.documentId !== active.id || active.origin !== 'xml')
                throw fail('A nota ativa mudou. Atualize o pedido antes de substituir.', 409);
        }
        const pending = await client.query('SELECT id,access_key FROM pending_fiscal_keys WHERE order_id=$1 FOR UPDATE', [req.params.id]);
        if (pending.rowCount && pending.rows[0].access_key.trim() !== data.key) {
            throw fail('A chave do documento difere da chave pendente. Remova a pendência explicitamente antes de cadastrar outra nota.', 409);
        }
        const otherPending = await client.query('SELECT 1 FROM pending_fiscal_keys WHERE access_key=$1 AND order_id<>$2', [data.key, req.params.id]);
        if (otherPending.rowCount) throw fail('Esta chave já está vinculada a outro pedido.', 409);
        const { rows: items } = await client.query('SELECT * FROM order_items WHERE order_id=$1', [req.params.id]);
        const { rows: sender } = await client.query("SELECT value FROM settings WHERE key='shipping_sender'");
        const automatic = resolveReusableMappings(data, items, await loadReusableMappings(client, data));
        const differences = reconcileNfe(data, orders[0], items, sender[0]?.value?.document, automatic);
        const status = differences.length ? 'needs_review' : 'pending_official';
        if (replacementReview) {
            await client.query(`UPDATE fiscal_documents SET unlinked_at=now(),unlinked_by=$2,unlink_reason=$3,
                unlink_official_source=$4,prior_official_status=$5,updated_at=now()
                WHERE id=$1 AND unlinked_at IS NULL`, [active.id, req.user.id, replacementReview.reason,
                replacementReview.source, replacementReview.priorStatus]);
            await client.query(`INSERT INTO audit_logs(admin_id,action,entity_type,entity_id,changes)
                VALUES($1,'fiscal.xml_unlinked','order',$2,$3)`, [req.user.id, req.params.id,
                JSON.stringify({ document_id: active.id, key_last4: active.access_key.trim().slice(-4),
                    previous_status: active.status, prior_official_status: replacementReview.priorStatus,
                    official_source: replacementReview.source, reason: replacementReview.reason,
                    replaced_in_same_transaction: true, shipping_released: false })]);
        }
        const { rows } = duplicate ? await client.query(`UPDATE fiscal_documents SET unlinked_at=NULL,unlinked_by=NULL,
            unlink_reason=NULL,unlink_official_source=NULL,prior_official_status=NULL,
            status=$2,differences=$3::jsonb,official_source=NULL,official_checked_at=NULL,verified_by=NULL,
            updated_at=now() WHERE id=$1 AND unlinked_at IS NOT NULL RETURNING ${fields}`,
        [duplicate.id, status, JSON.stringify(differences)]) : await client.query(`INSERT INTO fiscal_documents
            (order_id,access_key,origin,xml_bytes,xml_sha256,parsed_data,differences,status,imported_by)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${fields}`,
        [req.params.id, data.key, origin, xmlBytes, sha, JSON.stringify(data), JSON.stringify(differences), status, req.user.id]);
        if (!rows[0]) throw fail('O vínculo fiscal mudou durante a operação. Atualize o pedido.', 409);
        await client.query(`INSERT INTO audit_logs(admin_id,action,entity_type,entity_id,changes) VALUES($1,$2,'order',$3,$4)`,
            [req.user.id, duplicate ? 'fiscal.xml_reactivated' : origin === 'xml' ? 'fiscal.xml_imported' : 'fiscal.manual_recorded', req.params.id,
                JSON.stringify({ document_id: rows[0].id, origin, key_last4: data.key.slice(-4), status, differences,
                    previous_unlinked_at: duplicate?.unlinked_at || null,
                    previous_status: duplicate?.status || null, previous_official_source: duplicate?.official_source || null,
                    previous_official_checked_at: duplicate?.official_checked_at || null,
                    previous_verified_by: duplicate?.verified_by || null,
                    automatic_mapping_audit_ids: automatic.mappingAuditIds,
                    recipient_name_abbreviation_accepted: assessNfe(data, orders[0], items,
                        sender[0]?.value?.document, automatic).abbreviatedName,
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

router.post(`${orderPath}/replace`, uploadLimiter, (req, res, next) => xmlUpload.single('file')(req, res, error => {
    if (error) return next(fail('Selecione um XML de NF-e de até 1 MB.'));
    next();
}), async (req, res, next) => {
    if (!req.file || !/\.xml$/i.test(req.file.originalname)) return next(fail('Selecione o XML original da NF-e.'));
    try {
        const data = parseFiscalXmlUpload(req.file.buffer);
        const sha = createHash('sha256').update(req.file.buffer).digest('hex');
        const review = { document_id: req.body.document_id, official_source: req.body.official_source,
            prior_official_status: req.body.prior_official_status,
            confirmed_official_check: req.body.confirmed_official_check === 'true',
            confirmed_not_cancellation: req.body.confirmed_not_cancellation === 'true' };
        res.status(201).json(await storeDocument(req, data, 'xml', req.file.buffer, sha, pool, review));
    } catch (error) { next(error); }
});

router.post(`${orderPath}/manual`, uploadLimiter, async (req, res, next) => {
    try { res.status(201).json(await storeDocument(req, parseManualNfe(req.body), 'manual')); }
    catch (error) { next(error); }
});

export async function verifyFiscalDocument(orderId, actorId, input, db = pool) {
    let client;
    try {
        const { key, protocol, source } = validateFiscalVerification(input);
        client = await db.connect(); await client.query('BEGIN');
        const order = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
        if (!order.rowCount) throw fail('Pedido não encontrado.', 404);
        const { rows } = await client.query('SELECT * FROM fiscal_documents WHERE order_id=$1 AND unlinked_at IS NULL FOR UPDATE', [orderId]);
        const row = rows[0];
        if (!row) throw fail('Cadastre a NF-e antes da conferência.', 404);
        if (row.status === 'verified') throw fail('Esta NF-e já foi conferida. Nenhum dado foi alterado.', 409);
        const { rows: items } = await client.query('SELECT * FROM order_items WHERE order_id=$1', [orderId]);
        const { rows: sender } = await client.query("SELECT value FROM settings WHERE key='shipping_sender'");
        const { rows: reviews } = await client.query(reviewAuditSql, [orderId, row.id]);
        const reviewed = reviewFromAudit(reviews, row.xml_sha256,
            fiscalContextHash(order.rows[0], items, sender[0]?.value?.document));
        if (reviewed.stale)
            throw fail('O XML ou o pedido mudou desde a conferência de equivalência. Solicite revisão.', 409);
        const automatic = resolveReusableMappings(row.parsed_data, items,
            await loadReusableMappings(client, row.parsed_data));
        if (reconcileNfe(row.parsed_data, order.rows[0], items,
            sender[0]?.value?.document, combinedReview(reviewed.review, automatic)).length)
            throw fail('O pedido ou a nota mudou desde a conciliação. Confira novamente antes de registrar a situação oficial.', 409);
        if (key !== row.access_key.trim() || protocol !== row.parsed_data.protocol) throw fail('Chave ou protocolo não conferem com a NF-e cadastrada.');
        const officialSource = source === 'svrs' ? 'https://dfe-portal.svrs.rs.gov.br/Nfe/da' : 'https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx';
        const result = await client.query(`UPDATE fiscal_documents SET status='verified',differences='[]'::jsonb,
            official_source=$2,official_checked_at=now(),verified_by=$3,updated_at=now()
            WHERE id=$1 RETURNING ${fields}`, [row.id, officialSource, actorId]);
        await client.query(`INSERT INTO audit_logs(admin_id,action,entity_type,entity_id,changes) VALUES($1,'fiscal.official_check_attested','order',$2,$3)`,
            [actorId, orderId, JSON.stringify({ document_id: row.id, source: officialSource,
                key_last4: key.slice(-4), origin: row.origin,
                authorization_attested: true, full_content_match_attested: true,
                automatic_mapping_audit_ids: automatic.mappingAuditIds })]);
        await client.query('COMMIT'); return publicDocument(result.rows[0]);
    } catch (error) { if (client) await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client?.release(); }
}

router.post(`${orderPath}/verify`, async (req, res, next) => {
    try { res.json(await verifyFiscalDocument(req.params.id, req.user.id, req.body)); }
    catch (error) { next(error); }
});

router.get(`${orderPath}/download`, async (req, res, next) => {
    try {
        const { rows } = await pool.query('SELECT access_key,origin,xml_bytes,status FROM fiscal_documents WHERE order_id=$1 AND unlinked_at IS NULL', [req.params.id]);
        if (!rows[0]) throw fail('Documento não encontrado.', 404);
        if (rows[0].origin !== 'xml' || !rows[0].xml_bytes) throw fail('Cadastro manual não possui XML para download.', 409);
        if (rows[0].status !== 'verified') throw fail('O documento ainda não foi conferido na fonte oficial.', 409);
        res.set('Cache-Control', 'no-store');
        res.json({ filename: `NFe-${rows[0].access_key.trim()}.xml`, xml_base64: rows[0].xml_bytes.toString('base64') });
    } catch (error) { next(error); }
});

export default router;
