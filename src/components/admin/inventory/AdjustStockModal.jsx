import React, { useState, useMemo } from "react";
import { ArrowDown, ArrowUp, Equal, AlertTriangle, Loader2, ArrowUpDown } from "lucide-react";
import { base44 } from "@/api/base44Client";
import AdminModal from "@/components/admin/AdminModal";
import AdminInput from "@/components/admin/AdminInput";
import AdminSelect from "@/components/admin/AdminSelect";
import AdminTextarea from "@/components/admin/AdminTextarea";
import AdminFormSection from "@/components/admin/AdminFormSection";

const ADJUST_TYPES = [
    { value: "entrada", label: "Entrada", icon: ArrowUp, desc: "Adicionar unidades ao estoque" },
    { value: "saida", label: "Saída", icon: ArrowDown, desc: "Remover unidades do estoque" },
    { value: "set", label: "Definir quantidade", icon: Equal, desc: "Definir o valor absoluto do estoque" },
];

const REASONS = [
    { value: "Recebimento de mercadoria", label: "Recebimento de mercadoria" },
    { value: "Correção de inventário", label: "Correção de inventário" },
    { value: "Avaria", label: "Avaria" },
    { value: "Perda", label: "Perda" },
    { value: "Devolução", label: "Devolução" },
    { value: "Uso interno", label: "Uso interno" },
    { value: "Outro", label: "Outro" },
];

export default function AdjustStockModal({ product, color, size, currentStock, onClose, onAdjusted }) {
    const [adjustType, setAdjustType] = useState("entrada");
    const [qty, setQty] = useState("");
    const [reason, setReason] = useState("");
    const [note, setNote] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    const previewQty = useMemo(() => {
        const q = parseInt(qty) || 0;
        if (adjustType === "entrada") return currentStock + q;
        if (adjustType === "saida") return Math.max(0, currentStock - q);
        return Math.max(0, q);
    }, [adjustType, qty, currentStock]);

    const save = async () => {
        if (!qty && adjustType !== "set") return setError("Informe a quantidade");
        if (adjustType === "set" && !qty) return setError("Informe a quantidade");
        if (!reason) return setError("Selecione o motivo do ajuste");
        setSaving(true);
        setError("");
        try {
            await base44.functions.invoke("adjustStock", {
                productId: product.id,
                colorId: color.id,
                size,
                adjustType,
                qty: parseInt(qty) || 0,
                reason,
                note,
            });
            onAdjusted();
        } catch (e) {
            setError(e.response?.data?.error || e.message || "Erro ao ajustar estoque");
        } finally {
            setSaving(false);
        }
    };

    return (
        <AdminModal
            open
            onClose={onClose}
            title="Ajustar estoque"
            subtitle="Movimentação manual de inventário"
            size="md"
            icon={ArrowUpDown}
            footer={
                <>
                    <button onClick={onClose} className="btn-ghost">Cancelar</button>
                    <button onClick={save} disabled={saving} className="btn-gold">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirmar ajuste"}
                    </button>
                </>
            }
        >
            <div className="space-y-5">
                {/* Product info */}
                <div className="flex items-center gap-3 p-4 bg-muted/30 rounded-xl border border-border">
                    {product.images?.[0] && <img src={product.images[0]} alt="" className="w-12 h-14 object-cover rounded bg-bone shrink-0" />}
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{product.name}</p>
                        <p className="text-[11px] text-muted-foreground font-numeric">{product.sku || "—"}</p>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="w-3 h-3 rounded-full border border-border shrink-0" style={{ background: color.hex }} />
                            <span className="text-xs text-muted-foreground">{color.name || color.id} · Tam {size}</span>
                        </div>
                    </div>
                    <div className="text-right shrink-0">
                        <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Atual</p>
                        <p className="text-2xl font-numeric font-medium">{currentStock}</p>
                    </div>
                </div>

                {/* Adjust type */}
                <AdminFormSection title="Tipo de ajuste">
                    {ADJUST_TYPES.map((t) => (
                        <button
                            key={t.value}
                            onClick={() => setAdjustType(t.value)}
                            className={`flex items-start gap-3 p-3 border rounded-lg text-left transition-colors ${adjustType === t.value ? "border-accent bg-accent/5" : "border-border hover:border-foreground/30"}`}
                        >
                            <t.icon className={`w-4 h-4 mt-0.5 shrink-0 ${adjustType === t.value ? "text-accent" : "text-muted-foreground"}`} strokeWidth={1.5} />
                            <div>
                                <p className="text-sm font-medium">{t.label}</p>
                                <p className="text-[11px] text-muted-foreground">{t.desc}</p>
                            </div>
                        </button>
                    ))}
                </AdminFormSection>

                <AdminFormSection title="Detalhes">
                    <AdminInput label="Quantidade" type="number" value={qty} onChange={setQty} required placeholder="0" min="0" />
                    <AdminSelect label="Motivo" value={reason} onChange={setReason} required options={REASONS} placeholder="Selecione..." />
                    <AdminTextarea label="Observação (opcional)" value={note} onChange={setNote} rows={2} full placeholder="Notas adicionais sobre este ajuste" />
                </AdminFormSection>

                {/* Preview */}
                <div className="flex items-center justify-between p-4 bg-muted/30 rounded-xl border border-border">
                    <div>
                        <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Novo estoque</p>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-sm text-muted-foreground font-numeric">{currentStock}</span>
                            <span className="text-muted-foreground">→</span>
                            <span className="text-xl font-numeric font-medium">{previewQty}</span>
                        </div>
                    </div>
                    {adjustType === "saida" && parseInt(qty) > currentStock && (
                        <div className="flex items-center gap-1.5 text-[11px] text-destructive">
                            <AlertTriangle className="w-3.5 h-3.5" strokeWidth={1.5} />
                            Estoque será zerado
                        </div>
                    )}
                </div>

                {error && <p className="text-[11px] text-destructive text-center">{error}</p>}
            </div>
        </AdminModal>
    );
}