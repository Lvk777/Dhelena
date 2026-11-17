import { useRef, useState } from 'react';
import { FileText, Upload, Download, ExternalLink } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { formatBRL } from '@/data/products';

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

    const importFile = async event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (!/\.xml$/i.test(file.name) || file.size > 1024 * 1024) { setError('Selecione um XML de até 1 MB.'); return; }
        setBusy(true); setError('');
        try { onChanged(await base44.functions.invoke('importFiscalXml', { orderId: order.id, file })); }
        catch (cause) { setError(cause.message || 'Não foi possível importar a NF-e.'); }
        finally { setBusy(false); }
    };
    const verify = async () => {
        setBusy(true); setError('');
        try {
            onChanged(await base44.functions.invoke('verifyFiscalDocument', { orderId: order.id,
                verification: { access_key: key.trim(), protocol: protocol.trim(), source, confirmed_authorized: confirmed } }));
            setKey(''); setProtocol(''); setConfirmed(false);
        } catch (cause) { setError(cause.message || 'Não foi possível confirmar a consulta oficial.'); }
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
        } catch (cause) { setError(cause.message || 'Não foi possível baixar o XML.'); }
        finally { setBusy(false); }
    };

    return <section className="bg-background text-foreground p-5 space-y-3" aria-label="Nota fiscal do pedido">
        <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground flex items-center gap-2"><FileText className="w-4 h-4" /> Nota fiscal</h2>
        {loadError && <p role="alert" className="text-sm text-error-ink">{loadError}</p>}
        {error && <p role="alert" className="text-sm text-error-ink">{error}</p>}
        {!document && !loadError ? <>
            <p className="text-sm">Importe o XML autorizado da NF-e modelo 55 emitida no Nota Fiscal Fácil. A importação não emite outra nota nem altera o pedido.</p>
            <input ref={inputRef} type="file" accept=".xml,text/xml,application/xml" onChange={importFile} className="sr-only" aria-label="Arquivo XML da NF-e" />
            <button type="button" className="btn-outline text-xs inline-flex items-center gap-2 min-h-11" disabled={busy} onClick={() => inputRef.current?.click()}>
                <Upload className="w-4 h-4" /> {busy ? 'Importando...' : 'Importar nota fiscal'}
            </button>
        </> : <>
            <p className="text-sm font-medium">NF-e {document.data.number} · série {document.data.series} · modelo 55</p>
            <p className="text-xs break-all">Chave: {document.access_key}</p>
            <p className="text-xs">Protocolo: {document.data.protocol} · Emissão: {new Date(document.data.issuedAt).toLocaleString('pt-BR')}</p>
            <p className="text-xs">Emitente: {document.data.issuerName} · CNPJ {document.data.issuerCnpj}</p>
            <p className="text-xs">Destinatário: {document.data.recipientName} · documento {document.data.recipientDocument}</p>
            <p className="text-xs">Mercadorias: {formatBRL(document.data.productCents / 100)} · Frete: {formatBRL(document.data.shippingCents / 100)} · Total: {formatBRL(document.data.totalCents / 100)}</p>
            <ul className="text-xs list-disc pl-5">{document.data.items.map((item, index) => <li key={index}>{item.name} · {item.quantity} un. · {formatBRL(item.productCents / 100)}</li>)}</ul>
            {document.differences.length > 0 ? <div role="alert" className="border border-amber-500/50 p-3 text-sm">
                <p className="font-medium">Divergência com o pedido. Associação e uso no Melhor Envio bloqueados.</p>
                <p>Conferir com a administração e a contabilidade: {document.differences.join(', ')}.</p>
            </div> : document.status === 'verified' ? <p role="status" className="text-sm">Conferência manual em fonte oficial registrada em {new Date(document.official_checked_at).toLocaleString('pt-BR')}. Chave liberada para a preparação do envio, sujeita às demais proteções.</p>
                : <p role="status" className="text-sm">XML e pedido conferem. Falta confirmar a situação atual da NF-e no portal oficial.</p>}
            {document.status === 'pending_official' && <div className="border border-border p-3 space-y-3 text-sm">
                <p>Abra o portal oficial, consulte a chave e confirme autorização, protocolo e ausência de cancelamento. O XML por si só não comprova a situação fiscal atual.</p>
                <label className="block">Portal consultado
                    <select className="admin-field block w-full p-2 mt-1" value={source} onChange={event => setSource(event.target.value)}>
                        <option value="national">Portal Nacional da NF-e</option><option value="svrs">Portal SVRS</option>
                    </select>
                </label>
                <a href={OFFICIAL_PORTALS[source]} target="_blank" rel="noopener noreferrer" className="text-gold-ink underline inline-flex items-center gap-1">Abrir portal oficial <ExternalLink className="w-3 h-3" /></a>
                <label className="block">Chave vista no portal<input className="admin-field block w-full p-2 mt-1" value={key} onChange={event => setKey(event.target.value.replace(/\D/g, '').slice(0, 44))} inputMode="numeric" /></label>
                <label className="block">Protocolo visto no portal<input className="admin-field block w-full p-2 mt-1" value={protocol} onChange={event => setProtocol(event.target.value.replace(/\D/g, '').slice(0, 15))} inputMode="numeric" /></label>
                <label className="flex gap-2 items-start"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1" />Confirmo que a consulta oficial mostra esta NF-e autorizada, sem evento de cancelamento.</label>
                <button type="button" className="btn-outline min-h-11 text-xs" disabled={busy || !confirmed || key.length !== 44 || protocol.length !== 15} onClick={verify}>Registrar conferência oficial</button>
            </div>}
            {document.status === 'verified' && <button type="button" className="btn-outline text-xs inline-flex items-center gap-2 min-h-11" disabled={busy} onClick={download}><Download className="w-4 h-4" /> Baixar XML autorizado</button>}
        </>}
    </section>;
}
