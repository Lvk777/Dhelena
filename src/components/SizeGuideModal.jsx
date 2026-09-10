import React, { useState, useEffect } from "react";
import { X } from "lucide-react";

const DEFAULT_GUIDE = [
    { size: "PP", bust: "78-82", waist: "58-62", hip: "86-90" },
    { size: "P",  bust: "82-86", waist: "62-66", hip: "90-94" },
    { size: "M",  bust: "86-90", waist: "66-70", hip: "94-98" },
    { size: "G",  bust: "90-94", waist: "70-74", hip: "98-102" },
    { size: "GG", bust: "94-98", waist: "74-78", hip: "102-106" },
];

export default function SizeGuideModal({ open, onClose, guideId, customMeasurements }) {
    const [guide, setGuide] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;

        async function loadGuide() {
            // Priority: custom measurements on the product > specific guide > default
            if (customMeasurements && Array.isArray(customMeasurements) && customMeasurements.length > 0) {
                setGuide({ name: "Medidas do Produto", rows: customMeasurements });
                return;
            }
            if (guideId) {
                setLoading(true);
                try {
                    const token = localStorage.getItem("dhelena_access_token");
                    const res = await fetch(`/api/size-guides/${guideId}`, {
                        headers: token ? { Authorization: `Bearer ${token}` } : {},
                    });
                    if (res.ok) {
                        const g = await res.json();
                        if (!cancelled) setGuide(g);
                        return;
                    }
                } catch { /* fall through to default */ }
                finally { setLoading(false); }
            }
            // List all guides, pick first as default
            try {
                const res = await fetch("/api/size-guides");
                if (res.ok) {
                    const guides = await res.json();
                    if (guides.length > 0 && !cancelled) {
                        setGuide(guides[0]);
                        return;
                    }
                }
            } catch { /* fall through */ }
            if (!cancelled) setGuide(null);
        }

        loadGuide();
        return () => { cancelled = true; };
    }, [open, guideId, customMeasurements]);

    if (!open) return null;

    const rows = guide?.rows || DEFAULT_GUIDE;
    const title = guide?.name || "Guia de Medidas";
    const hasLowWaist = rows.some(r => r.low_waist);
    const hasLength = rows.some(r => r.length);

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-charcoal/40 backdrop-blur-sm animate-fade-in" onClick={onClose} />
            <div className="relative bg-background shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-fade-in">
                {/* header */}
                <div className="flex items-center justify-between px-6 py-5 border-b border-border">
                    <h2 className="font-heading text-2xl tracking-[0.04em]">{title}</h2>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Fechar">
                        <X className="w-5 h-5" strokeWidth={1.25} />
                    </button>
                </div>

                {/* table */}
                <div className="p-6">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-4">
                        Medidas em centímetros
                    </p>
                    {loading ? (
                        <div className="py-12 text-center">
                            <div className="w-6 h-6 border-2 border-[hsl(var(--bone))] border-t-[hsl(var(--gold))] rounded-full animate-spin mx-auto" />
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-border">
                                        <th className="text-left py-3 px-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Tamanho</th>
                                        <th className="text-center py-3 px-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Busto</th>
                                        <th className="text-center py-3 px-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Cintura</th>
                                        <th className="text-center py-3 px-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Quadril</th>
                                        {hasLowWaist && <th className="text-center py-3 px-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Cint. Baixa</th>}
                                        {hasLength && <th className="text-center py-3 px-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Compr.</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((r, i) => (
                                        <tr key={i} className="border-b border-border/50 hover:bg-[hsl(var(--bone))]/40 transition-colors">
                                            <td className="py-3 px-2 font-medium">{r.size}</td>
                                            <td className="text-center py-3 px-2 text-muted-foreground">{r.bust || "—"}</td>
                                            <td className="text-center py-3 px-2 text-muted-foreground">{r.waist || "—"}</td>
                                            <td className="text-center py-3 px-2 text-muted-foreground">{r.hip || "—"}</td>
                                            {hasLowWaist && <td className="text-center py-3 px-2 text-muted-foreground">{r.low_waist || "—"}</td>}
                                            {hasLength && <td className="text-center py-3 px-2 text-muted-foreground">{r.length || "—"}</td>}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <p className="text-[11px] text-muted-foreground mt-6 leading-relaxed">
                        As medidas são aproximadas e podem variar conforme o tecido e modelagem. Em caso de dúvida, escolha o tamanho maior ou entre em contato conosco.
                    </p>
                </div>
            </div>
        </div>
    );
}
