import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogKeyboard(open, onClose) {
    const dialogRef = useRef(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        if (!open) return undefined;
        const previousFocus = document.activeElement;
        const dialog = dialogRef.current;
        const focusable = () => Array.from(dialog?.querySelectorAll(FOCUSABLE) || [])
            .filter(element => element.getClientRects().length > 0);

        (focusable()[0] || dialog)?.focus();

        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onCloseRef.current();
            } else if (event.key === 'Tab') {
                const elements = focusable();
                if (!elements.length) {
                    event.preventDefault();
                    dialog?.focus();
                    return;
                }
                const first = elements[0];
                const last = elements[elements.length - 1];
                if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) {
                    event.preventDefault();
                    first.focus();
                }
            }
        };

        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
        };
    }, [open]);

    return dialogRef;
}
