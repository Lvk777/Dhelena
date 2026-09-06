import React, { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, Ticket, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { formatBRL } from "@/data/products";
import AdminModal from "@/components/admin/AdminModal";
import AdminInput from "@/components/admin/AdminInput";
import AdminSelect from "@/components/admin/AdminSelect";
import AdminTextarea from "@/components/admin/AdminTextarea";
import AdminToggle from "@/components/admin/AdminToggle";
import AdminFormSection from "@/components/admin/AdminFormSection";
import AdminConfirmDialog from "@/components/admin/AdminConfirmDialog";
import { logAdminAction } from "@/lib/audit";

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
            {editing && <CouponForm item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}

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

function CouponForm({ item, onClose, onSaved }) {
    const [form, setForm] = useState({
        code: item.code || "", description: item.description || "", type: item.type || "percent", value: item.value ?? "",
        max_discount: item.max_discount ?? "", active: item.active !== false, max_uses: item.max_uses ?? "",
        max_uses_per_client: item.max_uses_per_client ?? "", min_value: item.min_value ?? 0,
        start_date: item.start_date ? item.start_date.slice(0, 10) : "", end_date: item.end_date ? item.end_date.slice(0, 10) : "",
        first_purchase_only: item.first_purchase_only || false,
    });
    const [saving, setSaving] = useState(false);
    const [errors, setErrors] = useState({});
    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

    const validate = () => {
        const e = {};
        if (!form.code.trim()) e.code = "Informe o código do cupom";
        if (form.type === "percent" && (parseFloat(form.value) > 100 || parseFloat(form.value) <= 0)) e.value = "Percentual deve ser entre 0 e 100";
        if ((form.type === "percent" || form.type === "fixed") && !form.value) e.value = "Informe o valor do desconto";
        if (form.type === "fixed" && parseFloat(form.value) <= 0) e.value = "Valor deve ser maior que zero";
        if (form.start_date && form.end_date && form.start_date > form.end_date) e.end_date = "Data final anterior à data de início";
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    const save = async () => {
        if (!validate()) return;
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

    return (
        <AdminModal
            open
            onClose={onClose}
            title={`${item.id ? "Editar" : "Novo"} cupom`}
            subtitle="Configure descontos e promoções para seus clientes"
            size="lg"
            icon={Ticket}
            footer={
                <>
                    <button onClick={onClose} className="btn-ghost">Cancelar</button>
                    <button onClick={save} disabled={saving} className="btn-gold">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar cupom"}</button>
                </>
            }
        >
            <div className="space-y-5">
                <AdminFormSection title="Informações básicas">
                    <AdminInput label="Código" value={form.code} onChange={(v) => set("code", v.toUpperCase())} required error={errors.code} placeholder="DHELENAS10" mono description="Código que o cliente digita no checkout" />
                    <AdminSelect label="Tipo de desconto" value={form.type} onChange={(v) => set("type", v)} required options={[{ value: "percent", label: "Percentual (%)" }, { value: "fixed", label: "Valor fixo (R$)" }, { value: "free_shipping", label: "Frete grátis" }]} />
                    <AdminTextarea label="Descrição interna" value={form.description} onChange={(v) => set("description", v)} rows={2} placeholder="Descrição para uso interno (não visível ao cliente)" full />
                </AdminFormSection>

                {form.type !== "free_shipping" && (
                    <AdminFormSection title="Valor do desconto">
                        <AdminInput label={form.type === "percent" ? "Percentual (%)" : "Valor (R$)"} type="number" value={form.value} onChange={(v) => set("value", v)} required error={errors.value} placeholder={form.type === "percent" ? "10" : "50.00"} />
                        <AdminInput label="Desconto máximo (R$)" type="number" value={form.max_discount} onChange={(v) => set("max_discount", v)} description="Opcional — limite máximo do desconto para cupons percentuais" placeholder="Sem limite" />
                    </AdminFormSection>
                )}

                <AdminFormSection title="Regras de uso">
                    <AdminInput label="Valor mínimo do pedido (R$)" type="number" value={form.min_value} onChange={(v) => set("min_value", v)} placeholder="0.00" />
                    <AdminInput label="Quantidade máxima de usos" type="number" value={form.max_uses} onChange={(v) => set("max_uses", v)} placeholder="Ilimitado" description="Deixe vazio para uso ilimitado" />
                    <AdminInput label="Máximo por cliente" type="number" value={form.max_uses_per_client} onChange={(v) => set("max_uses_per_client", v)} placeholder="Ilimitado" />
                    <div />
                </AdminFormSection>

                <AdminFormSection title="Período de validade">
                    <AdminInput label="Data de início" type="date" value={form.start_date} onChange={(v) => set("start_date", v)} />
                    <AdminInput label="Data de término" type="date" value={form.end_date} onChange={(v) => set("end_date", v)} error={errors.end_date} />
                </AdminFormSection>

                <AdminFormSection title="Restrições">
                    <div className="sm:col-span-2 space-y-1">
                        <AdminToggle label="Cupom ativo" checked={form.active} onChange={(v) => set("active", v)} description="Quando ativo, o cupom pode ser utilizado no checkout" />
                        <AdminToggle label="Primeira compra somente" checked={form.first_purchase_only} onChange={(v) => set("first_purchase_only", v)} description="Disponível apenas para clientes que nunca fizeram um pedido" />
                    </div>
                </AdminFormSection>
            </div>
        </AdminModal>
    );
}