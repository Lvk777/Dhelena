import React, { useEffect, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useBoutiqueDialogs } from '@/components/BoutiqueDialogs';
const SIZES = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' };
export default function AdminModal({ open, onClose, title, subtitle = '', size = 'md', children, footer = undefined, icon: Icon = undefined, busy = false }) {
    const dirty = useRef(false), closing = useRef(false);
    const dialogs = useBoutiqueDialogs();
    useEffect(() => { if (open) dirty.current = false; }, [open]);
    const close = async () => {
        if (busy || closing.current) return;
        closing.current = true;
        try {
            if (!dirty.current || await dialogs.confirm({ title: 'Descartar alterações?', message: 'As informações ainda não salvas serão descartadas.', confirmLabel: 'Descartar' })) onClose();
        } finally { closing.current = false; }
    };
    return <Dialog.Root open={open} onOpenChange={value => { if (!value) close(); }}><Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-charcoal/40 backdrop-blur-sm" />
        <Dialog.Content onChangeCapture={() => { dirty.current = true; }} onPointerDownOutside={e => e.preventDefault()} onEscapeKeyDown={e => { e.preventDefault(); close(); }}
            className={`fixed z-50 bottom-0 sm:bottom-auto sm:top-1/2 left-1/2 -translate-x-1/2 sm:-translate-y-1/2 bg-background w-full ${SIZES[size]} max-h-[100dvh] sm:max-h-[90vh] rounded-t-2xl sm:rounded-xl shadow-2xl flex flex-col overflow-hidden`}>
            <div className="flex items-start justify-between px-6 py-5 border-b border-border shrink-0">
                <div className="flex items-start gap-3 min-w-0">{Icon && <Icon className="w-6 h-6 text-gold-ink shrink-0" />}
                    <div><Dialog.Title className="font-heading text-xl tracking-wide">{title}</Dialog.Title>
                        <Dialog.Description className={subtitle ? 'text-sm text-muted-foreground mt-1' : 'sr-only'}>{subtitle || 'Preencha os campos e salve para confirmar suas alterações.'}</Dialog.Description></div>
                </div>
                <button type="button" onClick={close} disabled={busy} className="min-w-11 min-h-11 flex items-center justify-center hover:bg-muted rounded-lg" aria-label="Fechar"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto admin-scroll px-6 py-5">{children}</div>
            {footer && <div className="px-6 py-4 border-t border-border flex flex-wrap items-center justify-end gap-3 shrink-0" onClickCapture={e => {
                const button = e.target instanceof Element ? e.target.closest('button') : null;
                if (button && /^(cancelar|voltar|fechar)$/i.test(button.textContent.trim())) { e.preventDefault(); e.stopPropagation(); close(); }
            }}>{footer}</div>}
        </Dialog.Content>
    </Dialog.Portal></Dialog.Root>;
}
