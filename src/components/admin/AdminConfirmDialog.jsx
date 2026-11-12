import React, { useEffect, useId, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, Loader2 } from 'lucide-react';
export default function AdminConfirmDialog({ open, onClose, onConfirm, title = 'Confirmar exclusão', message = '', itemName = '', confirmLabel = 'Excluir', cancelLabel = 'Cancelar', danger = true, requireTyping = false, loading = false, note = 'Esta ação não poderá ser desfeita.' }) {
    const [typed, setTyped] = useState(''), [running, setRunning] = useState(false), [error, setError] = useState('');
    const cancel = useRef(null), flight = useRef(false), id = useId();
    const busy = loading || running;
    useEffect(() => { if (open) { setTyped(''); setError(''); } }, [open]);
    const confirm = async () => {
        if (flight.current || busy || (requireTyping && typed !== itemName)) return;
        flight.current = true; setRunning(true); setError('');
        try { await onConfirm(); } catch (e) { setError(e.message || 'Não foi possível concluir. Tente novamente.'); }
        finally { flight.current = false; setRunning(false); }
    };
    return <Dialog.Root open={open} onOpenChange={value => { if (!value && !busy) onClose(); }}><Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-charcoal/40 backdrop-blur-sm" />
        <Dialog.Content onOpenAutoFocus={e => { e.preventDefault(); cancel.current?.focus(); }} onPointerDownOutside={e => e.preventDefault()} onEscapeKeyDown={e => { if (busy) e.preventDefault(); }}
            className="fixed z-[61] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background w-[calc(100%_-_2rem)] max-w-md max-h-[90dvh] overflow-y-auto rounded-xl shadow-2xl p-6 space-y-5">
            <AlertTriangle className={danger ? 'text-error-ink' : 'text-gold-ink'} />
            <Dialog.Title className="font-heading text-xl">{title}</Dialog.Title>
            <Dialog.Description className="text-sm text-foreground/80">{message || 'Confirme para continuar.'}</Dialog.Description>
            {itemName && <p className="text-sm font-medium break-words">{itemName}</p>}
            {requireTyping && <div><label htmlFor={id} className="text-sm">Digite “{itemName}” para confirmar</label><input id={id} value={typed} onChange={e => setTyped(e.target.value)} disabled={busy} className="admin-field mt-2" /></div>}
            {note && <p className="text-xs text-muted-foreground">{note}</p>}
            {error && <p role="alert" className="text-sm text-error-ink">{error}</p>}
            <div className="flex flex-wrap justify-end gap-3"><button ref={cancel} type="button" disabled={busy} onClick={onClose} className="btn-outline min-h-11">{cancelLabel}</button>
                <button type="button" disabled={busy || (requireTyping && typed !== itemName)} onClick={confirm} className={`${danger ? 'btn-danger' : 'btn-gold'} min-h-11`}>{busy ? <Loader2 className="w-4 h-4 animate-spin" aria-label="Confirmando" /> : confirmLabel}</button></div>
        </Dialog.Content>
    </Dialog.Portal></Dialog.Root>;
}
