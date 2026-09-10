import React, { useState, useEffect } from "react";
import { Plus, Trash2, X, Power } from "lucide-react";

export default function Promotions() {
    const [promos, setPromos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null);

    const token = localStorage.getItem("dhelena_access_token");
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

    const load = async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/look-promotions/admin", { headers });
            const data = await res.json();
            setPromos(data || []);
        } catch { /* */ }
        finally { setLoading(false); }
    };

    useEffect(() => { load(); }, []);

    const handleSave = async (promo) => {
        if (promo.id) {
            await fetch(`/api/look-promotions/${promo.id}`, { method: "PATCH", headers, body: JSON.stringify(promo) });
        } else {
            await fetch("/api/look-promotions", { method: "POST", headers, body: JSON.stringify(promo) });
        }
        setEditing(null);
        load();
    };

    const handleToggle = async (promo) => {
        await fetch(`/api/look-promotions/${promo.id}`, { method: "PATCH", headers, body: JSON.stringify({ active: !promo.active }) });
        load();
    };

    const handleDelete = async (id) => {
        if (!confirm("Excluir esta promoção?")) return;
        await fetch(`/api/look-promotions/${id}`, { method: "DELETE", headers });
        load();
    };

    if (editing) return <PromoEditor promo={editing} onSave={handleSave} onCancel={() => setEditing(null)} />;

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="font-heading text-2xl tracking-[0.04em]">Promoções</h1>
                    <p className="text-[11px] text-muted-foreground mt-1">Campanhas de desconto para Monte seu Look e muito mais</p>
                </div>
                <button onClick={() => setEditing({ name: "", type: "look_discount", min_items: 3, discount_percent: 10, discount_fixed: 0, required_categories: [], eligible_products: [], eligible_collections: [], valid_from: null, valid_until: null, active: false, stacks_with_coupon: false })} className="btn-gold px-4 py-2 text-sm flex items-center gap-2">
                    <Plus className="w-4 h-4" strokeWidth={1.5} /> Nova Promoção
                </button>
            </div>

            {loading ? (
                <div className="py-12 text-center"><div className="w-6 h-6 border-2 border-[hsl(var(--bone))] border-t-[hsl(var(--gold))] rounded-full animate-spin mx-auto" /></div>
            ) : promos.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nenhuma promoção cadastrada.</p>
            ) : (
                <div className="space-y-3">
                    {promos.map(p => (
                        <div key={p.id} className="bg-background border border-border p-4 flex items-center justify-between">
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <p className="font-medium text-sm">{p.name}</p>
                                    <span className={`text-[9px] uppercase tracking-[0.12em] px-2 py-0.5 border ${p.active ? "border-green-500/40 text-green-600" : "border-border text-muted-foreground"}`}>
                                        {p.active ? "Ativa" : "Inativa"}
                                    </span>
                                </div>
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                    {p.min_items}+ peças · {Number(p.discount_percent)}% OFF
                                    {p.stacks_with_coupon ? " · Acumula com cupom" : ""}
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => handleToggle(p)} className={`p-1.5 ${p.active ? "text-green-600" : "text-muted-foreground hover:text-foreground"}`} title={p.active ? "Desativar" : "Ativar"}>
                                    <Power className="w-4 h-4" strokeWidth={1.25} />
                                </button>
                                <button onClick={() => setEditing(p)} className="text-[11px] uppercase tracking-[0.12em] text-foreground/70 hover:text-foreground border border-border px-3 py-1.5">Editar</button>
                                <button onClick={() => handleDelete(p.id)} className="text-muted-foreground hover:text-[hsl(var(--rose))] p-1.5"><Trash2 className="w-4 h-4" strokeWidth={1.25} /></button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function PromoEditor({ promo, onSave, onCancel }) {
    const [form, setForm] = useState(promo);

    const set = (field, val) => setForm(prev => ({ ...prev, [field]: val }));

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="font-heading text-2xl tracking-[0.04em]">{promo.id ? "Editar Promoção" : "Nova Promoção"}</h1>
                <button onClick={onCancel} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>

            <div className="max-w-xl space-y-4">
                <div>
                    <label className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground block mb-1.5">Nome</label>
                    <input value={form.name} onChange={e => set("name", e.target.value)} className="w-full border border-border px-3 py-2 text-sm" placeholder="Ex: Look Completo" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground block mb-1.5">Qtd. mínima de itens</label>
                        <input type="number" value={form.min_items} onChange={e => set("min_items", parseInt(e.target.value) || 0)} className="w-full border border-border px-3 py-2 text-sm" />
                    </div>
                    <div>
                        <label className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground block mb-1.5">Desconto (%)</label>
                        <input type="number" value={form.discount_percent} onChange={e => set("discount_percent", parseFloat(e.target.value) || 0)} className="w-full border border-border px-3 py-2 text-sm" />
                    </div>
                </div>

                <div>
                    <label className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground block mb-1.5">Desconto fixo (R$) — opcional</label>
                    <input type="number" step="0.01" value={form.discount_fixed} onChange={e => set("discount_fixed", parseFloat(e.target.value) || 0)} className="w-full border border-border px-3 py-2 text-sm" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground block mb-1.5">Data início</label>
                        <input type="datetime-local" value={form.valid_from?.slice(0, 16) || ""} onChange={e => set("valid_from", e.target.value || null)} className="w-full border border-border px-3 py-2 text-sm" />
                    </div>
                    <div>
                        <label className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground block mb-1.5">Data término</label>
                        <input type="datetime-local" value={form.valid_until?.slice(0, 16) || ""} onChange={e => set("valid_until", e.target.value || null)} className="w-full border border-border px-3 py-2 text-sm" />
                    </div>
                </div>

                <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={form.active} onChange={e => set("active", e.target.checked)} className="w-4 h-4" />
                    <span className="text-sm">Ativa</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={form.stacks_with_coupon} onChange={e => set("stacks_with_coupon", e.target.checked)} className="w-4 h-4" />
                    <span className="text-sm">Acumula com cupom</span>
                </label>

                <div className="flex gap-3 pt-4">
                    <button onClick={() => onSave(form)} disabled={!form.name} className="btn-gold px-6 py-2.5 text-sm disabled:opacity-40">Salvar</button>
                    <button onClick={onCancel} className="btn-outline px-6 py-2.5 text-sm">Cancelar</button>
                </div>
            </div>
        </div>
    );
}
