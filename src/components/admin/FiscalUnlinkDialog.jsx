import { useEffect, useId, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { userFacingError } from '@/lib/userFacingError';

export default function FiscalUnlinkDialog({ open, onClose, onConfirm, documentId, mode = 'unlink' }) {
    const [reason, setReason] = useState('');
    const [source, setSource] = useState('');
    const [priorStatus, setPriorStatus] = useState('');
    const [checked, setChecked] = useState(false);
    const [acknowledged, setAcknowledged] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [file, setFile] = useState(null);
    const id = useId();
    useEffect(() => { if (open) { setReason(''); setSource(''); setPriorStatus(''); setChecked(false); setAcknowledged(false); setFile(null); setError(''); } }, [open]);
    const valid = mode === 'replace' ? !!file && source && priorStatus && checked
        : reason.trim().length >= 10 && reason.trim().length <= 1000 && source && priorStatus && checked && acknowledged;
    const submit = async event => {
        event.preventDefault();
        if (!valid || busy) return;
        setBusy(true); setError('');
        try {
            await onConfirm({ document_id: documentId, reason: reason.trim(), official_source: source,
                prior_official_status: priorStatus, confirmed_official_check: checked,
                confirmed_not_cancellation: mode === 'replace' ? checked : acknowledged }, file);
            onClose();
        } catch (cause) { setError(userFacingError(cause, '/fiscal/unlink')); }
        finally { setBusy(false); }
    };
    return <Dialog.Root open={open} onOpenChange={value => { if (!value && !busy) onClose(); }}><Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-charcoal/50" />
        <Dialog.Content onPointerDownOutside={event => event.preventDefault()}
            className="fixed z-[61] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background text-foreground w-[calc(100%_-_2rem)] max-w-lg max-h-[90dvh] overflow-y-auto rounded-xl shadow-2xl p-5 sm:p-6">
            <form onSubmit={submit} className="space-y-4">
                <Dialog.Title className="font-heading text-xl">{mode === 'replace' ? 'Substituir XML' : 'Desvincular XML'}</Dialog.Title>
                <Dialog.Description className="text-sm space-y-2">
                    <span className="block">{mode === 'replace' ? 'O XML atual será preservado no histórico. A nova nota só ficará vinculada se todo o processamento terminar com sucesso.' : 'Deseja desvincular esta nota fiscal do pedido?'}</span>
                    <span className="block">O documento anterior será preservado no histórico para fins de segurança e auditoria.</span>
                    <span className="block">A expedição permanecerá bloqueada até que uma nota válida seja importada e conferida.</span>
                </Dialog.Description>
                {mode === 'replace' && <label htmlFor={`${id}-file`} className="block text-sm">Novo XML da NF-e
                    <input id={`${id}-file`} type="file" accept=".xml,text/xml,application/xml" className="admin-field block w-full mt-1" onChange={event => setFile(event.target.files?.[0] || null)} />
                </label>}
                {mode === 'unlink' && <label htmlFor={`${id}-reason`} className="block text-sm">Motivo da desvinculação
                    <textarea id={`${id}-reason`} value={reason} onChange={event => setReason(event.target.value)}
                        aria-invalid={reason.length > 0 && reason.trim().length < 10} aria-describedby={`${id}-reason-help`}
                        maxLength={1000} required rows={3} className="admin-field w-full mt-1" />
                    <span id={`${id}-reason-help`} className="block text-xs text-muted-foreground mt-1">Descreva por que a nota precisa ser substituída (mínimo de 10 caracteres).</span>
                </label>}
                <p className="text-xs">Consulte a situação da nota atual em fonte oficial antes de continuar. Uma nota ainda autorizada não é cancelada por esta ação.</p>
                <label htmlFor={`${id}-source`} className="block text-sm">Portal oficial consultado
                    <select id={`${id}-source`} required value={source} onChange={event => setSource(event.target.value)} className="admin-field w-full mt-1">
                        <option value="">Selecione o portal</option><option value="national">Portal Nacional da NF-e</option><option value="svrs">Portal SVRS</option>
                    </select>
                </label>
                <a className="text-sm text-gold-ink underline inline-block" target="_blank" rel="noopener noreferrer"
                    href={source === 'svrs' ? 'https://dfe-portal.svrs.rs.gov.br/Nfe/da' : 'https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx'}>Abrir portal oficial</a>
                <label htmlFor={`${id}-status`} className="block text-sm">Situação da nota anterior no portal
                    <select id={`${id}-status`} required value={priorStatus} onChange={event => setPriorStatus(event.target.value)} className="admin-field w-full mt-1">
                        <option value="">Selecione a situação conferida</option><option value="authorized">Continua autorizada</option><option value="cancelled">Consta cancelada</option>
                    </select>
                </label>
                <label className="flex gap-2 items-start text-sm"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} className="mt-1" />Conferi a situação da nota anterior no portal oficial selecionado. Entendo que esta operação não cancela a NF-e nem libera a expedição.</label>
                {mode === 'unlink' && <label className="flex gap-2 items-start text-sm"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} className="mt-1" />Entendo que desvincular o XML não cancela a NF-e nem libera a expedição.</label>}
                {error && <p role="alert" className="text-sm text-error-ink">{error}</p>}
                <div className="flex flex-wrap justify-end gap-2 pt-2">
                    <button type="button" className="btn-outline min-h-11" disabled={busy} onClick={onClose}>Cancelar</button>
                    <button type="submit" className="btn-danger min-h-11" disabled={!valid || busy}>{busy ? 'Processando...' : mode === 'replace' ? 'Confirmar substituição' : 'Confirmar desvinculação'}</button>
                </div>
            </form>
        </Dialog.Content>
    </Dialog.Portal></Dialog.Root>;
}
