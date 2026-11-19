import { useEffect, useRef, useState } from 'react';
import { FileText, Upload, Download, ExternalLink } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { formatBRL } from '@/data/products';
import { userFacingError } from '@/lib/userFacingError';
import FiscalUnlinkDialog from './FiscalUnlinkDialog';

const OFFICIAL_PORTALS = {
    national: 'https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx',
    svrs: 'https://dfe-portal.svrs.rs.gov.br/Nfe/da',
};

export default function FiscalDocumentPanel({ order, document, loadError = '', onChanged }) {
    const inputRef = useRef(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [key, setKey] = useState('');
    const [protocol, setProtocol] = useState('');
    const [source, setSource] = useState('national');
    const [confirmed, setConfirmed] = useState(false);
    const [contentMatched, setContentMatched] = useState(false);
    const [history, setHistory] = useState([]);
    const [historyError, setHistoryError] = useState('');
    const [unlinkOpen, setUnlinkOpen] = useState(false);
    const [nameReason, setNameReason] = useState('');
    const [nameEvidence, setNameEvidence] = useState('');
    const [productReason, setProductReason] = useState('');
    const [productEvidence, setProductEvidence] = useState('');
    const [recipientChecked, setRecipientChecked] = useState(false);
    const [codeChecked, setCodeChecked] = useState(false);
    const [variantChecked, setVariantChecked] = useState(false);
    const reviewIssues = document?.analysis?.issues || [];
    const nameReviewNeeded = reviewIssues.some(issue => issue.code === 'recipient_name') && document?.analysis?.abbreviatedName;
    const productReviewNeeded = reviewIssues.some(issue => issue.code === 'product_identity') && !!document?.analysis?.productCandidate;
    const canReview = document?.status === 'needs_review' && (nameReviewNeeded || productReviewNeeded);
    const refreshHistory = async () => {
        try {
            const result = await base44.functions.invoke('getFiscalDocumentHistory', { orderId: order.id });
            setHistory(Array.isArray(result) ? result : []); setHistoryError('');
        } catch { setHistoryError('Não foi possível consultar o histórico fiscal. Atualize a página antes de trocar a nota.'); }
    };
    useEffect(() => { refreshHistory(); }, [order.id]);
    const unlinkBlocked = !!order.melhor_envio_shipment_id || ['cart_created', 'purchase_inflight', 'purchase_uncertain',
        'purchased', 'generating', 'generated', 'posted', 'in_transit', 'out_for_delivery', 'delivered'].includes(order.shipping_status);
    const unlink = async review => {
        await base44.functions.invoke('unlinkFiscalDocument', { orderId: order.id, review });
        onChanged(null);
        await refreshHistory();
    };

    const importFile = async event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (!/\.xml$/i.test(file.name) || file.size > 1024 * 1024) { setError('Selecione um XML de até 1 MB.'); return; }
        setBusy(true); setError('');
        try { onChanged(await base44.functions.invoke('importFiscalXml', { orderId: order.id, file })); await refreshHistory(); }
        catch (cause) { setError(userFacingError(cause, '/fiscal/import')); }
        finally { setBusy(false); }
    };
    const verify = async () => {
        setBusy(true); setError('');
        try {
            onChanged(await base44.functions.invoke('verifyFiscalDocument', { orderId: order.id,
                verification: { access_key: key.trim(), protocol: protocol.trim(), source,
                    confirmed_authorized: confirmed, confirmed_document_matches: contentMatched } }));
            setKey(''); setProtocol(''); setConfirmed(false); setContentMatched(false);
        } catch (cause) { setError(userFacingError(cause, '/fiscal/verify')); }
        finally { setBusy(false); }
    };
    const confirmEquivalence = async kind => {
        const candidate = document?.analysis?.productCandidate;
        if (!canReview || busy || (kind === 'product' && !productReviewNeeded)
            || (kind === 'name' && !nameReviewNeeded)) return;
        setBusy(true); setError('');
        try {
            const result = await base44.functions.invoke('confirmFiscalEquivalence', { orderId: order.id, review: {
                document_id: document.id, order_item_id: kind === 'product' ? candidate.orderItemId : undefined,
                fiscal_index: kind === 'product' ? candidate.fiscalIndex : undefined,
                confirmed_recipient: kind === 'name' && recipientChecked,
                confirmed_product_code: kind === 'product' && codeChecked,
                confirmed_product_variant: kind === 'product' && variantChecked,
                reason: (kind === 'product' ? productReason : nameReason).trim(),
                evidence: (kind === 'product' ? productEvidence : nameEvidence).trim(),
            } });
            onChanged(result);
            try { onChanged(await base44.functions.invoke('getFiscalDocument', { orderId: order.id })); }
            catch { /* The confirmed response remains visible if refreshing the audit view fails. */ }
            if (kind === 'product') { setProductReason(''); setProductEvidence(''); }
            else { setNameReason(''); setNameEvidence(''); }
            setRecipientChecked(false); setCodeChecked(false); setVariantChecked(false);
        } catch (cause) { setError(userFacingError(cause, '/fiscal/equivalence')); }
        finally { setBusy(false); }
    };
    const removeKey = async () => {
        if (busy) return;
        setBusy(true); setError('');
        try {
            await base44.functions.invoke('removePendingFiscalKey', { orderId: order.id });
            onChanged(null);
        } catch (cause) { setError(userFacingError(cause, '/fiscal/key')); }
        finally { setBusy(false); }
    };
    const download = async () => {
        setBusy(true); setError('');
        try {
            const result = await base44.functions.invoke('downloadFiscalXml', { orderId: order.id });
            const bytes = Uint8Array.from(atob(result.xml_base64), char => char.charCodeAt(0));
            const url = URL.createObjectURL(new Blob([bytes], { type: 'application/xml' }));
            const link = window.document.createElement('a');
            link.href = url; link.download = result.filename; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (cause) { setError(userFacingError(cause, '/fiscal/download')); }
        finally { setBusy(false); }
    };

    return <section className="bg-background text-foreground p-5 space-y-3" aria-label="Nota fiscal do pedido">
        <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground flex items-center gap-2"><FileText className="w-4 h-4" /> Nota fiscal</h2>
        {loadError && <p role="alert" className="text-sm text-error-ink">{loadError}</p>}
        {error && <p role="alert" className="text-sm text-error-ink">{error}</p>}
        {!loadError && <input ref={inputRef} type="file" accept=".xml,text/xml,application/xml" onChange={importFile} className="sr-only" aria-label="Arquivo XML da NF-e" />}
        {!document ? !loadError && <>
            <p className="text-sm">Importe o arquivo XML original da NF-e modelo 55 já emitida. A importação não emite uma nova nota nem altera o pedido.</p>
            <p className="text-xs text-muted-foreground">Use o XML fiscal autorizado, obtido no emissor ou com a contabilidade. Converter o DANFE em PDF para .xml não funciona.</p>
            <button type="button" className="btn-outline text-xs inline-flex items-center gap-2 min-h-11" disabled={busy} onClick={() => inputRef.current?.click()}>
                <Upload className="w-4 h-4" /> {busy ? 'Importando...' : 'Importar XML'}
            </button>
        </> : document.origin === 'key_only' ? <>
            <p className="text-xs font-medium">Chave registrada em {new Date(document.created_at).toLocaleString('pt-BR')} · pendente</p>
            <p className="text-xs break-all">Chave: {document.access_key}</p>
            <p role="status" className="text-sm border border-amber-500/50 p-3">Falta importar o XML fiscal original. A chave isolada não foi conferida com o pedido e não pode ser usada no Melhor Envio.</p>
            <a href={OFFICIAL_PORTALS.national} target="_blank" rel="noopener noreferrer" className="text-gold-ink underline inline-flex items-center gap-1">Consultar no portal oficial <ExternalLink className="w-3 h-3" /></a>
            <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-outline text-xs min-h-11" disabled={busy} onClick={() => inputRef.current?.click()}><Upload className="w-4 h-4" /> Importar XML</button>
                <button type="button" className="btn-outline text-xs min-h-11" disabled={busy} onClick={removeKey}>Remover chave pendente</button>
            </div>
        </> : <>
            <p className="text-xs font-medium">Origem: {document.origin === 'manual' ? 'Preenchimento manual' : 'XML importado'}{document.created_at && ` · cadastrado em ${new Date(document.created_at).toLocaleString('pt-BR')}`}</p>
            <p className="text-sm font-medium">NF-e {document.data.number} · série {document.data.series} · modelo 55</p>
            <p className="text-xs break-all">Chave: {document.access_key}</p>
            <p className="text-xs">Protocolo: {document.data.protocol} · Emissão: {new Date(document.data.issuedAt).toLocaleString('pt-BR')}</p>
            <p className="text-xs">Emitente: {document.data.issuerName} · CNPJ {document.data.issuerCnpj}</p>
            <p className="text-xs">Destinatário: {document.data.recipientName} · documento {document.data.recipientDocument}</p>
            <p className="text-xs">Mercadorias: {formatBRL(document.data.productCents / 100)} · Frete: {formatBRL(document.data.shippingCents / 100)} · Total: {formatBRL(document.data.totalCents / 100)}</p>
            <ul className="text-xs list-disc pl-5">{document.data.items.map((item, index) => <li key={index}>{item.name} · {item.quantity} un. · {formatBRL(item.productCents / 100)}</li>)}</ul>
            {document.differences.length > 0 ? <div role="alert" className="border border-amber-500/50 p-3 text-sm">
                <p className="font-medium">Divergência com o pedido. Associação e uso no Melhor Envio bloqueados.</p>
                <ul className="list-disc pl-5 space-y-1">{(document.analysis?.issues?.length
                    ? document.analysis.issues.map(issue => issue.message) : document.differences)
                    .map((message, index) => <li key={index}>{message}</li>)}</ul>
            </div> : document.status === 'verified' ? <p role="status" className="text-sm">Conferência manual em fonte oficial registrada em {new Date(document.official_checked_at).toLocaleString('pt-BR')}. Chave liberada para a preparação do envio, sujeita às demais proteções.</p>
                : <p role="status" className="text-sm">Dados cadastrados e pedido conferem. Falta confirmar a situação atual da NF-e no portal oficial.</p>}
            {Array.isArray(document.equivalence_reviews) && document.equivalence_reviews.length > 0 &&
                <div className="border border-border p-3 space-y-2 text-sm" aria-label="Conferências de equivalência registradas">
                    <h3 className="font-medium">Correspondências registradas</h3>
                    {document.equivalence_reviews.map((review, index) => <div key={index} className="border-t border-border pt-2">
                        <p>{review.fields_compared?.includes('product_code') ? 'Produto' : 'Nome da cliente'} · {new Date(review.created_at).toLocaleString('pt-BR')} · {review.reviewed_by}</p>
                        <p>Motivo: {review.reason}</p><p>Evidência: {review.evidence}</p>
                    </div>)}
                    <p className="text-xs text-muted-foreground">O XML original permanece intacto. A autorização fiscal requer consulta separada em fonte oficial.</p>
                </div>}
            {document.review_stale && <p role="alert" className="border border-amber-500/50 p-3 text-sm">O pedido mudou desde uma conferência anterior. Solicite nova análise fiscal; a expedição permanece bloqueada.</p>}
            {canReview && <div className="space-y-3 text-sm" aria-label="Conferência de equivalência fiscal">
                {productReviewNeeded && <div className="border border-border p-3 space-y-3" aria-label="Correspondência do produto">
                    <h3 className="font-medium">Conferir correspondência do produto</h3>
                    <div className="grid gap-3 sm:grid-cols-2 min-w-0">
                        <div className="border border-border p-3 min-w-0 break-words" aria-label="Produto do pedido">
                            <p className="text-xs uppercase tracking-widest mb-2">No pedido</p>
                            <p>{document.analysis.productCandidate.productName}</p>
                            <p>Cor: {document.analysis.productCandidate.orderColor}</p>
                            <p>Tamanho: {document.analysis.productCandidate.size}</p>
                            <p>SKU: {document.analysis.productCandidate.orderSku || 'não informado'}</p>
                            <p>Quantidade: {document.analysis.productCandidate.quantity}</p>
                            <p>Valor: {formatBRL(document.analysis.productCandidate.productCents / 100)}</p>
                        </div>
                        <div className="border border-border p-3 min-w-0 break-words" aria-label="Produto da NF-e">
                            <p className="text-xs uppercase tracking-widest mb-2">Na NF-e</p>
                            <p>{document.analysis.productCandidate.fiscalName}</p>
                            <p>Cor na descrição: {document.analysis.productCandidate.fiscalColor || 'conferir descrição completa'}</p>
                            <p>Tamanho: {document.analysis.productCandidate.size}</p>
                            <p>Código fiscal: {document.analysis.productCandidate.fiscalCode || 'não informado'}</p>
                            <p>Quantidade: {document.analysis.productCandidate.quantity}</p>
                            <p>Valor: {formatBRL(document.analysis.productCandidate.productCents / 100)}</p>
                        </div>
                    </div>
                    <p>Confirme somente se a documentação comprovar que são a mesma mercadoria e variante. Códigos internos diferentes podem ser relacionados mediante conferência; o XML não será alterado.</p>
                    <label className="flex gap-2 items-start"><input type="checkbox" checked={codeChecked} onChange={event => setCodeChecked(event.target.checked)} />Confirmo que os dois registros representam a mesma mercadoria e que o código fiscal corresponde ao produto vendido.</label>
                    <label className="flex gap-2 items-start"><input type="checkbox" checked={variantChecked} onChange={event => setVariantChecked(event.target.checked)} />Conferi documentalmente a descrição e a variante, inclusive a diferença de cor quando existir.</label>
                    <label className="block">Justificativa da correspondência<input className="admin-field block w-full p-2 mt-1" value={productReason} onChange={event => setProductReason(event.target.value)} maxLength={1000} /></label>
                    <label className="block">Evidência da correspondência<input className="admin-field block w-full p-2 mt-1" value={productEvidence} onChange={event => setProductEvidence(event.target.value)} maxLength={1000} /></label>
                    <button type="button" className="btn-outline min-h-11 text-xs" disabled={busy || !codeChecked || !variantChecked
                        || productReason.trim().length < 20 || productEvidence.trim().length < 20}
                        onClick={() => confirmEquivalence('product')}>Confirmar correspondência do produto</button>
                </div>}
                {nameReviewNeeded && <div className="border border-border p-3 space-y-3" aria-label="Correspondência da cliente">
                    <h3 className="font-medium">Conferir nome da cliente</h3>
                    <p>O documento coincide, mas o nome do pedido está abreviado. Confira a identidade antes de confirmar.</p>
                    <label className="flex gap-2 items-start"><input type="checkbox" checked={recipientChecked} onChange={event => setRecipientChecked(event.target.checked)} />Conferi que o nome abreviado e o nome completo pertencem à mesma cliente.</label>
                    <label className="block">Justificativa do nome<input className="admin-field block w-full p-2 mt-1" value={nameReason} onChange={event => setNameReason(event.target.value)} maxLength={1000} /></label>
                    <label className="block">Evidência da identidade<input className="admin-field block w-full p-2 mt-1" value={nameEvidence} onChange={event => setNameEvidence(event.target.value)} maxLength={1000} /></label>
                    <button type="button" className="btn-outline min-h-11 text-xs" disabled={busy || !recipientChecked
                        || nameReason.trim().length < 20 || nameEvidence.trim().length < 20}
                        onClick={() => confirmEquivalence('name')}>Confirmar identidade da cliente</button>
                </div>}
                <p className="text-xs text-muted-foreground">Cada confirmação resolve somente o campo indicado. Outras pendências e o envio aguardando confirmação continuam bloqueados.</p>
            </div>}
            {document.status === 'pending_official' && <div className="border border-border p-3 space-y-3 text-sm">
                <p>Abra o portal oficial e compare a chave, o protocolo, o emitente, o destinatário, os produtos, as quantidades, os valores e o frete com esta nota. Confirme a autorização atual e a ausência de cancelamento. Importar XML não comprova autenticidade ou situação fiscal.</p>
                <label className="block">Portal consultado
                    <select className="admin-field block w-full p-2 mt-1" value={source} onChange={event => setSource(event.target.value)}>
                        <option value="national">Portal Nacional da NF-e</option><option value="svrs">Portal SVRS</option>
                    </select>
                </label>
                <a href={OFFICIAL_PORTALS[source]} target="_blank" rel="noopener noreferrer" className="text-gold-ink underline inline-flex items-center gap-1">Abrir portal oficial <ExternalLink className="w-3 h-3" /></a>
                <label className="block">Chave vista no portal<input className="admin-field block w-full p-2 mt-1" value={key} onChange={event => setKey(event.target.value.replace(/\D/g, '').slice(0, 44))} inputMode="numeric" /></label>
                <label className="block">Protocolo visto no portal<input className="admin-field block w-full p-2 mt-1" value={protocol} onChange={event => setProtocol(event.target.value.replace(/\D/g, '').slice(0, 15))} inputMode="numeric" /></label>
                <label className="flex gap-2 items-start"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1" />Confirmo que a consulta oficial mostra esta NF-e autorizada, sem evento de cancelamento.</label>
                <label className="flex gap-2 items-start"><input type="checkbox" checked={contentMatched} onChange={event => setContentMatched(event.target.checked)} className="mt-1" />Comparei no documento oficial emitente, destinatário, produtos, quantidades, mercadorias, frete e total; todos correspondem aos dados exibidos e ao pedido.</label>
                <button type="button" className="btn-outline min-h-11 text-xs" disabled={busy || !confirmed || !contentMatched || key.length !== 44 || protocol.length !== 15} onClick={verify}>Registrar conferência oficial</button>
            </div>}
            {document.status === 'verified' && document.origin !== 'manual' && <button type="button" className="btn-outline text-xs inline-flex items-center gap-2 min-h-11" disabled={busy} onClick={download}><Download className="w-4 h-4" /> Baixar XML autorizado</button>}
            {document.origin === 'xml' && <div className="space-y-2">
                <button type="button" className="btn-outline text-xs min-h-11" disabled={busy || unlinkBlocked || !!historyError} onClick={() => setUnlinkOpen(true)}>Desvincular XML</button>
                {unlinkBlocked && <p role="status" className="text-xs text-muted-foreground">Este envio já foi identificado ou avançou no Melhor Envio. Solicite análise administrativa específica antes de substituir a nota.</p>}
            </div>}
        </>}
        {historyError && <p role="alert" className="text-sm text-error-ink">{historyError}</p>}
        {history.length > 0 && <div className="border-t border-border pt-4 space-y-2" aria-label="Histórico de documentos fiscais">
            <h3 className="text-xs uppercase tracking-widest">Histórico de documentos anteriores</h3>
            <ul className="space-y-3">{history.map(item => <li key={item.id} className="border border-border p-3 text-xs break-words">
                <p className="font-medium">NF-e {item.number || '—'} · série {item.series || '—'} · chave terminada em {item.access_key_last4}</p>
                <p>Desvinculada em {new Date(item.unlinked_at).toLocaleString('pt-BR')} · situação anterior: {item.prior_official_status === 'authorized' ? 'autorizada' : 'cancelada'}</p>
                <p>Conferência registrada por {item.reviewed_by || 'administrador'} · {item.unlink_official_source === 'svrs' ? 'Portal SVRS' : 'Portal Nacional da NF-e'}</p>
                <p>Motivo: {item.unlink_reason}</p>
                <p>XML preservado em armazenamento privado. A desvinculação não altera a situação fiscal oficial.</p>
            </li>)}</ul>
        </div>}
        <FiscalUnlinkDialog open={unlinkOpen} onClose={() => setUnlinkOpen(false)} onConfirm={unlink} documentId={document?.id} />
    </section>;
}
