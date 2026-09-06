import React, { useState, useEffect } from "react";
import { AlertTriangle, X, Loader2 } from "lucide-react";

export default function AdminConfirmDialog({
    open, onClose, onConfirm,
    title = "Confirmar exclusão",
    message,
    itemName,
    confirmLabel = "Excluir",
    cancelLabel = "Cancelar",
    danger = true,
    requireTyping = false,
    loading = false,
}) {
    const [typedText, setTypedText] = useState("");

    useEffect(() => { if (open) setTypedText(""); }, [open]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e) => e.key === "Escape" && !loading && onClose();
        document.addEventListener("keydown", onKey);
        document.body.style.overflow = "hidden";
        return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
    }, [open, onClose, loading]);

    if (!open) return null;

    const canConfirm = !requireTyping || typedText === itemName;

    return (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:px-4">
            <div className="absolute inset-0 bg-charcoal/40 backdrop-blur-sm animate-fade-in" onClick={() => !loading && onClose()} />
            <div className="relative bg-background w-full sm:max-w-md rounded-t-2xl sm:rounded-xl shadow-2xl flex flex-col animate-fade-rise overflow-hidden">
                <div className="flex items-start justify-between px-6 py-5 border-b border-border">
                    <div className="flex items-start gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${danger ? "bg-destructive/10" : "bg-accent/10"}`}>
                            <AlertTriangle className={`w-5 h-5 ${danger ? "text-destructive" : "text-accent"}`} strokeWidth={1.5} />
                        </div>
                        <h2 className="font-heading text-xl tracking-wide pt-1">{title}</h2>
                    </div>
                    <button onClick={() => !loading && onClose()} className="p-2 hover:bg-muted rounded-lg transition-colors shrink-0" aria-label="Fechar" disabled={loading}>
                        <X className="w-5 h-5" strokeWidth={1.5} />
                    </button>
                </div>
                <div className="px-6 py-5 space-y-4">
                    {message && <p className="text-sm text-muted-foreground leading-relaxed">{message}</p>}
                    {itemName && (
                        <div className="bg-muted/50 rounded-lg p-3 border border-border">
                            <p className="text-sm font-medium break-words">{itemName}</p>
                        </div>
                    )}
                    {requireTyping && (
                        <div>
                            <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
                                Digite <span className="text-foreground font-medium">"{itemName}"</span> para confirmar
                            </label>
                            <input
                                value={typedText}
                                onChange={(e) => setTypedText(e.target.value)}
                                placeholder={itemName}
                                className="admin-field"
                                autoFocus
                                disabled={loading}
                            />
                        </div>
                    )}
                    <p className="text-[11px] text-muted-foreground">Esta ação não poderá ser desfeita.</p>
                </div>
                <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-3 bg-background">
                    <button onClick={onClose} className="btn-ghost" disabled={loading}>{cancelLabel}</button>
                    <button
                        onClick={onConfirm}
                        disabled={!canConfirm || loading}
                        className="btn-danger"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}