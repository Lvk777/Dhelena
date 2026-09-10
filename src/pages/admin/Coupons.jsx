import React, { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, Ticket, Loader2, Check, Tag, Percent, Settings, Calendar } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { formatBRL } from "@/data/products";
import AdminWizard from "@/components/admin/AdminWizard";
import AdminInput from "@/components/admin/AdminInput";
import AdminSelect from "@/components/admin/AdminSelect";
import AdminTextarea from "@/components/admin/AdminTextarea";
import AdminToggle from "@/components/admin/AdminToggle";
import AdminConfirmDialog from "@/components/admin/AdminConfirmDialog";
import { logAdminAction } from "@/lib/audit";

const WIZARD_STEPS = [
    { id: "code", label: "Código e nome", icon: Tag },
    { id: "discount", label: "Desconto", icon: Percent },
    { id: "rules", label: "Regras de uso", icon: Settings },
    { id: "period", label: "Período", icon: Calendar },
    { id: "review", label: "Revisão", icon: Check },
];

export default function Coupons() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleting, setDeleting] = useState(false);

    const load = () => { setLoading(true); base44.entities.Coupon.list("-created_date", 100).then(setItems).catch(() => { }).finally(() => setLoading(false)); };
    useEffect(() => { load(); }, []);

    const confirmDelete = async () => {
        setDeleting(true);
        try {
            await base44.entities.Coupon.delete(deleteTarget.id);
            await logAdminAction("coupon_delete", "Coupon", deleteTarget.id, deleteTarget.code, "Cupom excluído");
            setDeleteTarget(null); load();
        }
        catch { } finally { setDeleting(false); }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="font-heading text-2xl tracking-[0.03em]">Cupons</h1>
                <button onClick={() => setEditing({})} className="btn-gold"><Plus className="w-4 h-4" strokeWidth={1.5} /> Novo cupom</button>
            </div>
            {loading ? <div className="h-40 bg-background animate-pulse rounded-lg" /> : items.length === 0 ? (
                <div className="bg-background p-12 text-center rounded-lg border border-border">
                    <Ticket className="w-10 h-10 text-muted-foreground/40 mx-auto mb-4" strokeWidth={1} />
                    <p className="text-sm text-muted-foreground">Nenhum cupom cadastrado.</p>
                </div>
            ) : (
                <div className="bg-background rounded-lg border border-border overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                <th className="py-3 px-4">Código</th><th className="py-3 px-4">Tipo</th><th className="py-3 px-4">Valor</th>
                                <th className="py-3 px-4 hidden sm:table-cell">Usos</th><th className="py-3 px-4 hidden md:table-cell">Validade</th><th className="py-3 px-4">Status</th><th className="py-3 px-4"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {items.map((c) => (
                                <tr key={c.id} className="hover:bg-muted/50 transition-colors">
                                    <td className="py-3 px-4 font-medium font-mono">{c.code}</td>
                                    <td className="py-3 px-4 text-muted-foreground">{c.type === "percent" ? "Percentual" : c.type === "fixed" ? "Fixo" : "Frete grátis"}</td>
                                    <td className="py-3 px-4 font-numeric">{c.type === "percent" ? `${c.value}%` : c.type === "fixed" ? formatBRL(c.value) : "—"}</td>
                                    <td className="py-3 px-4 hidden sm:table-cell text-muted-foreground font-numeric">{c.uses || 0}{c.max_uses ? `/${c.max_uses}` : " ∞"}</td>
                                    <td className="py-3 px-4 hidden md:table-cell text-muted-foreground font-numeric">{c.end_date ? new Date(c.end_date).toLocaleDateString("pt-BR") : "—"}</td>
                                    <td className="py-3 px-4"><span className={`text-[10px] uppercase tracking-[0.12em] px-2 py-1 rounded ${c.active ? "bg-accent/10 text-accent" : "bg-muted text-muted-foreground"}`}>{c.active ? "Ativo" : "Inativo"}</span></td>
                                    <td className="py-3 px-4"><div className="flex gap-1"><button onClick={() => setEditing(c)} className="p-1.5 hover:bg-muted rounded transition-colors"><Pencil className="w-4 h-4" strokeWidth={1.25} /></button><button onClick={() => setDeleteTarget(c)} className="p-1.5 hover:bg-muted rounded transition-colors text-rose"><Trash2 className="w-4 h-4" strokeWidth={1.25} /></button></div></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {editing && <CouponWizard item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}

            <AdminConfirmDialog
                open={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={confirmDelete}
                title="Excluir cupom"
                message="Você está prestes a excluir:"
                itemName={deleteTarget?.code}
                confirmLabel="Excluir"
                loading={deleting}
            />
        </div>
    );
}

function CouponWizard({ item, onClose, onSaved }) {
    const [form, setForm] = useState({
        code: item.code || "", description: item.description || "", type: item.type || "percent", value: item.value ?? "",
        max_discount: item.max_discount ?? "", active: item.active !== false, max_uses: item.max_uses ?? "",
        max_uses_per_client: item.max_uses_per_client ?? "", min_value: item.min_value ?? 0,
        start_date: item.start_date ? item.start_date.slice(0, 10) : "", end_date: item.end_date ? item.end_date.slice(0, 10) : "",
        first_purchase_only: item.first_purchase_only || false,
    });
    const [saving, setSaving] = useState(false);
    const [stepErrors, setStepErrors] = useState(null);
    const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setStepErrors(null); };

    const validateStep = (stepIndex) => {
        const errors = {};
        if (stepIndex === 0 && !form.code.trim()) errors.code = "Informe o código do cupom";
        if (stepIndex === 1) {
            if (form.type === "percent" && (parseFloat(form.value) > 100 || parseFloat(form.value) <= 0)) errors.value = "Percentual deve ser entre 0 e 100";
            if ((form.type === "percent" || form.type === "fixed") && !form.value) errors.value = "Informe o valor do desconto";
            if (form.type === "fixed" && parseFloat(form.value) <= 0) errors.value = "Valor deve ser maior que zero";
        }
        if (stepIndex === 3 && form.start_date && form.end_date && form.start_date > form.end_date) errors.end_date = "Data final anterior à data de início";
        return Object.keys(errors).length > 0 ? errors : null;
    };

    const save = async () => {
        // Final validation
        const allErrors = {};
        if (!form.code.trim()) allErrors.code = "Informe o código do cupom";
        if (form.type === "percent" && (parseFloat(form.value) > 100 || parseFloat(form.value) <= 0)) allErrors.value = "Percentual deve ser entre 0 e 100";
        if ((form.type === "percent" || form.type === "fixed") && !form.value) allErrors.value = "Informe o valor do desconto";
        if (form.type === "fixed" && parseFloat(form.value) <= 0) allErrors.value = "Valor deve ser maior que zero";
        if (form.start_date && form.end_date && form.start_date > form.end_date) allErrors.end_date = "Data final anterior à data de início";
        if (Object.keys(allErrors).length > 0) { setStepErrors(allErrors); return; }

        setSaving(true);
        try {
            const payload = {
                ...form,
                code: form.code.toUpperCase().trim(),
                value: form.type === "free_shipping" ? 0 : parseFloat(form.value) || 0,
                max_discount: form.max_discount ? parseFloat(form.max_discount) : null,
                max_uses: form.max_uses ? parseInt(form.max_uses) : null,
                max_uses_per_client: form.max_uses_per_client ? parseInt(form.max_uses_per_client) : null,
                min_value: parseFloat(form.min_value) || 0,
            };
            if (item.id) {
                await base44.entities.Coupon.update(item.id, payload);
                await logAdminAction("coupon_update", "Coupon", item.id, payload.code, "Cupom atualizado");
            } else {
                const newCoupon = await base44.entities.Coupon.create(payload);
                await logAdminAction("coupon_create", "Coupon", newCoupon.id, payload.code, "Cupom criado");
            }
            onSaved();
        } catch { console.error("Erro ao salvar cupom"); } finally { setSaving(false); }
    };

    const renderStep = (step, wizProps) => {
        const errors = wizProps?.stepErrors || stepErrors;

        switch (step.id) {
            case "code":
                return (
                    <div className="max-w-xl mx-auto space-y-4">
                        <AdminInput label="Código" value={form.code} onChange={(v) => set("code", v.toUpperCase())} required error={errors?.code} placeholder="DHELENAS10" mono description="Código que o cliente digita no checkout" full />
                        <AdminSelect label="Tipo de desconto" value={form.type} onChange={(v) => set("type", v)} required options={[{ value: "percent", label: "Percentual (%)" }, { value: "fixed", label: "Valor fixo (R$)" }, { value: "free_shipping", label: "Frete grátis" }]} />
                        <AdminTextarea label="Descrição interna" value={form.description} onChange={(v) => set("description", v)} rows={2} placeholder="Descrição para uso interno (não visível ao cliente)" full />
                    </div>
                );
            case "discount":
                return form.type === "free_shipping" ? (
                    <div className="max-w-xl mx-auto text-center py-8">
                        <p className="text-sm text-muted-foreground">Frete grátis — nenhum valor de desconto adicional necessário.</p>
                    </div>
                ) : (
                    <div className="max-w-xl mx-auto space-y-4">
                        <AdminInput label={form.type === "percent" ? "Percentual (%)" : "Valor (R$)"} type="number" value={form.value} onChange={(v) => set("value", v)} required error={errors?.value} placeholder={form.type === "percent" ? "10" : "50.00"} full />
                        <AdminInput label="Desconto máximo (R$)" type="number" value={form.max_discount} onChange={(v) => set("max_discount", v)} description="Opcional — limite máximo do desconto para cupons percentuais" placeholder="Sem limite" full />
                    </div>
                );
            case "rules":
                return (
                    <div className="max-w-xl mx-auto space-y-4">
                        <AdminInput label="Valor mínimo do pedido (R$)" type="number" value={form.min_value} onChange={(v) => set("min_value", v)} placeholder="0.00" full />
                        <div className="grid grid-cols-2 gap-4">
                            <AdminInput label="Quantidade máxima de usos" type="number" value={form.max_uses} onChange={(v) => set("max_uses", v)} placeholder="Ilimitado" />
                            <AdminInput label="Máximo por cliente" type="number" value={form.max_uses_per_client} onChange={(v) => set("max_uses_per_client", v)} placeholder="Ilimitado" />
                        </div>
                        <div className="space-y-2 pt-2">
                            <AdminToggle label="Cupom ativo" checked={form.active} onChange={(v) => set("active", v)} description="Quando ativo, o cupom pode ser utilizado no checkout" />
                            <AdminToggle label="Primeira compra somente" checked={form.first_purchase_only} onChange={(v) => set("first_purchase_only", v)} description="Disponível apenas para clientes que nunca fizeram um pedido" />
                        </div>
                    </div>
                );
            case "period":
                return (
                    <div className="max-w-xl mx-auto space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <AdminInput label="Data de início" type="date" value={form.start_date} onChange={(v) => set("start_date", v)} />
                            <AdminInput label="Data de término" type="date" value={form.end_date} onChange={(v) => set("end_date", v)} error={errors?.end_date} />
                        </div>
                    </div>
                );
            case "review":
                return (
                    <div className="max-w-2xl mx-auto">
                        <div className="bg-muted/30 rounded-lg border border-border p-6 space-y-2">
                            <h3 className="text-[11px] uppercase tracking-[0.18em] font-medium text-accent mb-3">Resumo do Cupom</h3>
                            <SummaryRow label="Código" value={form.code || "—"} />
                            <SummaryRow label="Tipo" value={form.type === "percent" ? "Percentual" : form.type === "fixed" ? "Fixo" : "Frete grátis"} />
                            <SummaryRow label="Valor" value={form.type === "percent" ? `${form.value}%` : form.type === "fixed" ? formatBRL(form.value) : "—"} />
                            <SummaryRow label="Valor mínimo" value={form.min_value ? formatBRL(form.min_value) : "—"} />
                            <SummaryRow label="Início" value={form.start_date || "—"} />
                            <SummaryRow label="Término" value={form.end_date || "—"} />
                            <SummaryRow label="Status" value={form.active ? "Ativo" : "Inativo"} />
                        </div>
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <AdminWizard
            title={`${item.id ? "Editar" : "Novo"} cupom`}
            subtitle="Configure descontos e promoções"
            icon={Ticket}
            steps={WIZARD_STEPS}
            validateStep={validateStep}
            onSave={save}
            onClose={onClose}
            saveLabel="Salvar cupom"
            saving={saving}
        >
            {renderStep}
        </AdminWizard>
    );
}

function SummaryRow({ label, value }) {
    return (
        <div className="flex justify-between gap-4 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium text-right">{value}</span>
        </div>
    );
}
