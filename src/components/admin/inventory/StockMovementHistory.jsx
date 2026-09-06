import React, { useState, useEffect } from "react";
import { History, Loader2, ArrowDown, ArrowUp, Equal } from "lucide-react";
import AdminModal from "@/components/admin/AdminModal";
import { base44 } from "@/api/base44Client";

const ORIGIN_LABELS = {
    venda: "Venda",
    cancelamento: "Cancelamento",
    ajuste_manual: "Ajuste manual",
    devolucao: "Devolução",
    outro: "Outro",
};

export default function StockMovementHistory({ open, onClose, productId }) {
    const [movements, setMovements] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!open) return;
        setLoading(true);
        const filter = productId ? { product_id: productId } : {};
        base44.entities.StockMovement.filter(filter, "-created_date", 200)
            .then(setMovements)
            .catch(() => setMovements([]))
            .finally(() => setLoading(false));
    }, [open, productId]);

    return (
        <AdminModal
            open={open}
            onClose={onClose}
            title="Histórico de movimentações"
            subtitle="Registro completo de entradas, saídas e ajustes"
            size="xl"
            icon={History}
            footer={<button onClick={onClose} className="btn-ghost">Fechar</button>}
        >
            {loading ? (
                <div className="h-40 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
            ) : movements.length === 0 ? (
                <div className="text-center py-12">
                    <History className="w-10 h-10 text-muted-foreground/30 mx-auto mb-4" strokeWidth={1} />
                    <p className="text-sm text-muted-foreground">Nenhuma movimentação registrada.</p>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                                <th className="py-3 px-3">Data/hora</th>
                                <th className="py-3 px-3">Produto</th>
                                <th className="py-3 px-3 hidden md:table-cell">SKU</th>
                                <th className="py-3 px-3 hidden lg:table-cell">Cor</th>
                                <th className="py-3 px-3">Tam</th>
                                <th className="py-3 px-3 text-right">Anterior</th>
                                <th className="py-3 px-3 text-center">Alteração</th>
                                <th className="py-3 px-3 text-right">Final</th>
                                <th className="py-3 px-3 hidden md:table-cell">Motivo</th>
                                <th className="py-3 px-3 hidden lg:table-cell">Origem</th>
                                <th className="py-3 px-3 hidden lg:table-cell">Admin</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {movements.map((m) => {
                                const isPositive = m.change > 0;
                                const isNeutral = m.change === 0;
                                return (
                                    <tr key={m.id} className="hover:bg-muted/30 transition-colors">
                                        <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap font-numeric text-xs">
                                            {new Date(m.created_date).toLocaleString("pt-BR")}
                                        </td>
                                        <td className="py-2.5 px-3 font-medium truncate max-w-[160px]">{m.product_name}</td>
                                        <td className="py-2.5 px-3 hidden md:table-cell text-muted-foreground font-numeric">{m.sku || "—"}</td>
                                        <td className="py-2.5 px-3 hidden lg:table-cell text-muted-foreground">{m.color_name || "—"}</td>
                                        <td className="py-2.5 px-3 text-muted-foreground">{m.size || "—"}</td>
                                        <td className="py-2.5 px-3 text-right font-numeric text-muted-foreground">{m.previous_qty ?? 0}</td>
                                        <td className="py-2.5 px-3 text-center">
                                            <span className={`inline-flex items-center gap-0.5 font-numeric text-xs px-1.5 py-0.5 rounded ${isNeutral ? "bg-muted text-muted-foreground" : isPositive ? "bg-accent/10 text-accent" : "bg-destructive/10 text-destructive"}`}>
                                                {isNeutral ? <Equal className="w-3 h-3" strokeWidth={2} /> : isPositive ? <ArrowUp className="w-3 h-3" strokeWidth={2} /> : <ArrowDown className="w-3 h-3" strokeWidth={2} />}
                                                {isPositive ? "+" : ""}{m.change}
                                            </span>
                                        </td>
                                        <td className="py-2.5 px-3 text-right font-numeric font-medium">{m.new_qty ?? 0}</td>
                                        <td className="py-2.5 px-3 hidden md:table-cell text-muted-foreground text-xs truncate max-w-[140px]">{m.reason || "—"}</td>
                                        <td className="py-2.5 px-3 hidden lg:table-cell">
                                            <span className="text-[10px] uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{ORIGIN_LABELS[m.origin] || m.origin}</span>
                                        </td>
                                        <td className="py-2.5 px-3 hidden lg:table-cell text-muted-foreground text-xs truncate max-w-[120px]">{m.admin_email || "—"}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </AdminModal>
    );
}