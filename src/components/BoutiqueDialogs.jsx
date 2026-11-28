import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { createDialogRequests } from '@/lib/dialogRequest';
const Context = createContext(null);
export const useBoutiqueDialogs = () => useContext(Context);
export function BoutiqueDialogsProvider({ children }) {
    const [current, setCurrent] = useState(null);
    const [value, setValue] = useState('');
    const cancel = useRef(null), previousFocus = useRef(null), requests = useRef(null);
    if (!requests.current) requests.current = createDialogRequests(options => {
        if (options) previousFocus.current = document.activeElement;
        setValue(''); setCurrent(options);
    });
    useEffect(() => () => requests.current.cancel(), []);
    const context = { confirm: options => requests.current.request({ ...options, mode: 'confirm' }),
        prompt: options => requests.current.request({ ...options, mode: 'prompt' }),
        notify: options => requests.current.request({ ...options, mode: 'notice' }) };
    return <Context.Provider value={context}>{children}
        <Dialog.Root open={!!current} onOpenChange={open => { if (!open) requests.current.cancel(); }}>
            <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[90] bg-charcoal/40 backdrop-blur-sm" />
                <Dialog.Content className="fixed z-[91] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background border border-border rounded-xl p-6 w-[calc(100%_-_2rem)] max-w-md shadow-2xl"
                    onOpenAutoFocus={event => { event.preventDefault(); cancel.current?.focus(); }}
                    onCloseAutoFocus={event => { event.preventDefault(); previousFocus.current?.focus?.(); }}
                    onPointerDownOutside={event => event.preventDefault()}>
                    <Dialog.Title className="font-heading text-2xl text-foreground">{current?.title || 'Confirmação'}</Dialog.Title>
                    <Dialog.Description className="text-sm text-foreground/80 leading-relaxed mt-4">{current?.message || 'Deseja continuar?'}</Dialog.Description>
                    {current?.mode === 'prompt' && <label className="block mt-5 text-sm">{current.label || 'Informe o valor'}<input className="admin-field mt-2 w-full" value={value} maxLength={current.maxLength || 100} onChange={event => setValue(event.target.value)} /></label>}
                    <div className="flex flex-wrap justify-end gap-3 mt-6">
                        {current?.mode !== 'notice' && <button ref={cancel} type="button" className="btn-outline min-h-11" onClick={() => requests.current.cancel()}>Voltar</button>}
                        <button ref={current?.mode === 'notice' ? cancel : undefined} type="button" className="btn-gold min-h-11" disabled={current?.mode === 'prompt' && !value.trim()} onClick={() => requests.current.settle(true, value)}>{current?.confirmLabel || (current?.mode === 'notice' ? 'Entendi' : 'Confirmar')}</button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    </Context.Provider>;
}
