import React, { useEffect } from "react";
import { X } from "lucide-react";

const SIZES = {
    sm: "sm:max-w-md",
    md: "sm:max-w-lg",
    lg: "sm:max-w-2xl",
    xl: "sm:max-w-4xl",
};

export default function AdminModal({ open, onClose, title, subtitle, size = "md", children, footer, icon: Icon }) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => e.key === "Escape" && onClose();
        document.addEventListener("keydown", onKey);
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = "";
        };
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:px-4">
            <div className="absolute inset-0 bg-charcoal/40 backdrop-blur-sm animate-fade-in" onClick={onClose} />
            <div className={`relative bg-background w-full ${SIZES[size]} max-h-[100vh] sm:max-h-[90vh] rounded-t-2xl sm:rounded-xl shadow-2xl flex flex-col animate-fade-rise overflow-hidden`}>
                <div className="flex items-start justify-between px-6 py-5 border-b border-border shrink-0">
                    <div className="flex items-start gap-3 min-w-0">
                        {Icon && (
                            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                                <Icon className="w-5 h-5 text-accent" strokeWidth={1.5} />
                            </div>
                        )}
                        <div className="min-w-0">
                            <h2 className="font-heading text-xl tracking-wide truncate">{title}</h2>
                            {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-colors shrink-0" aria-label="Fechar">
                        <X className="w-5 h-5" strokeWidth={1.5} />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto admin-scroll px-6 py-5">{children}</div>
                {footer && (
                    <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-3 shrink-0 bg-background">
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
}