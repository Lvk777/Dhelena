import React, { useState, useEffect } from "react";
import { Plus, Trash2, X, Power, Tag, Calendar, Palette, Percent, Truck, ShoppingCart, Save } from "lucide-react";

const PROMO_TYPES = [
    { value: "look_discount", label: "Desconto no Look" },
    { value: "campaign", label: "Campanha Sazonal" },
    { value: "free_shipping", label: "Frete Grátis" },
    { value: "buy_x", label: "Compre X, leve Y%" },
    { value: "flash_sale", label: "Oferta Relâmpago" },
    { value: "category_discount", label: "Desconto por Categoria" },
];

const CAMPAIGN_COLORS = [
    { value: "#A5925A", label: "Dourado" },
    { value: "#D9534F", label: "Vermelho" },
    { value: "#9B6A8E", label: "Lilás" },
    { value: "#5B8C7B", label: "Verde" },
    { value: "#3B3B3B", label: "Charcoal" },
    { value: "#C77D5A", label: "Terracota" },
];

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
                    <p className="text-[11px] text-muted-foreground mt-1">Campanhas de desconto, frete grátis e ofertas sazonais</p>
                </div>
                <button onClick={() => setEditing({
                    name: "", title: "", subtitle: "", type: "look_discount", promo_type: "look_discount",
                    min_items: 3, discount_percent: 10, discount_fixed: 0, free_shipping: false,
                    buy_quantity: 0, min_value: 0, applicable_category: "", applicable_collection: "",
                    required_categories: [], eligible_products: [], eligible_collections: [],
                    valid_from: null, valid_until: null, active: false, stacks_with_coupon: false,
                    priority: 0, campaign_color: "#A5925A", banner_image: "", short_text: "",
                })} className="btn-gold px-4 py-2 text-sm flex items-center gap-2">
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
                            <div className="flex items-center gap-3 flex-1">
                                <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: (p.campaign_color || '#A5925A') + '20' }}>
                                    <Tag className="w-4 h-4" style={{ color: p.campaign_color || '#A5925A' }} strokeWidth={1.5} />
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <p className="font-medium text-sm">{p.name}</p>
                                        {p.title && <span className="text-[10px] text-muted-foreground">— {p.title}</span>}
                                        <span className={`text-[9px] uppercase tracking-[0.12em] px-2 py-0.5 border ${p.active ? "border-green-500/40 text-green-600" : "border-border text-muted-foreground"}`}>
                                            {p.active ? "Ativa" : "Inativa"}
                                        </span>
                                        {p.free_shipping && <span className="text-[9px] uppercase tracking-[0.1em] px-2 py-0.5 border border-[hsl(var(--gold))]/30 text-[hsl(var(--gold))]">Frete grátis</span>}
                                    </div>
                                    <p className="text-[11px] text-muted-foreground mt-0.5">
                                        {p.type === "campaign" && p.short_text ? p.short_text : `${p.min_items}+ peças · ${Number(p.discount_percent)}% OFF`}
                                        {p.stacks_with_coupon ? " · Acumula com cupom" : ""}
                                        {p.valid_until ? ` · até ${new Date(p.valid_until).toLocaleDateString('pt-BR')}` : ""}
                                    </p>
                                </div>
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

            <div className="max-w-2xl space-y-5">
                {/* Identificação */}
                <Section title="Identificação" icon={Tag}>
                    <Field label="Nome da campanha">
                        <input value={form.name} onChange={e => set("name", e.target.value)} className="admin-field w-full" placeholder="Ex: Dia das Mães 2026" />
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Título de destaque">
                            <input value={form.title || ""} onChange={e => set("title", e.target.value)} className="admin-field w-full" placeholder="Ex: DIA DAS MÃES" />
                        </Field>
                        <Field label="Subtítulo">
                            <input value={form.subtitle || ""} onChange={e => set("subtitle", e.target.value)} className="admin-field w-full" placeholder="Ex: 10% OFF em looks com 3+ peças" />
                        </Field>
                    </div>
                    <Field label="Texto curto de divulgação">
                        <input value={form.short_text || ""} onChange={e => set("short_text", e.target.value)} className="admin-field w-full" placeholder="Ex: Leve 3 peças e ganhe 10% OFF" />
                    </Field>
                </Section>

                {/* Tipo e desconto */}
                <Section title="Tipo e Desconto" icon={Percent}>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Tipo da promoção">
                            <select value={form.promo_type || form.type} onChange={e => { set("promo_type", e.target.value); set("type", e.target.value); }} className="admin-field w-full">
                                {PROMO_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>
                        </Field>
                        <Field label="Prioridade (maior = mais destaque)">
                            <input type="number" value={form.priority || 0} onChange={e => set("priority", parseInt(e.target.value) || 0)} className="admin-field w-full" />
                        </Field>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <Field label="Desconto (%)">
                            <input type="number" value={form.discount_percent || 0} onChange={e => set("discount_percent", parseFloat(e.target.value) || 0)} className="admin-field w-full" />
                        </Field>
                        <Field label="Desconto fixo (R$)">
                            <input type="number" step="0.01" value={form.discount_fixed || 0} onChange={e => set("discount_fixed", parseFloat(e.target.value) || 0)} className="admin-field w-full" />
                        </Field>
                        <Field label="Valor mínimo (R$)">
                            <input type="number" step="0.01" value={form.min_value || 0} onChange={e => set("min_value", parseFloat(e.target.value) || 0)} className="admin-field w-full" />
                        </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Compre X peças">
                            <input type="number" value={form.min_items || 0} onChange={e => set("min_items", parseInt(e.target.value) || 0)} className="admin-field w-full" />
                        </Field>
                        <Field label="Buy quantity (qty alvo)">
                            <input type="number" value={form.buy_quantity || 0} onChange={e => set("buy_quantity", parseInt(e.target.value) || 0)} className="admin-field w-full" />
                        </Field>
                    </div>
                </Section>

                {/* Aplicação */}
                <Section title="Aplicação" icon={ShoppingCart}>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Categoria aplicável">
                            <input value={form.applicable_category || ""} onChange={e => set("applicable_category", e.target.value)} className="admin-field w-full" placeholder="Ex: vestidos" />
                        </Field>
                        <Field label="Coleção aplicável">
                            <input value={form.applicable_collection || ""} onChange={e => set("applicable_collection", e.target.value)} className="admin-field w-full" placeholder="Ex: verao-2026" />
                        </Field>
                    </div>
                </Section>

                {/* Período */}
                <Section title="Período e Status" icon={Calendar}>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Data de início">
                            <input type="datetime-local" value={form.valid_from?.slice(0, 16) || ""} onChange={e => set("valid_from", e.target.value || null)} className="admin-field w-full" />
                        </Field>
                        <Field label="Data de término">
                            <input type="datetime-local" value={form.valid_until?.slice(0, 16) || ""} onChange={e => set("valid_until", e.target.value || null)} className="admin-field w-full" />
                        </Field>
                    </div>
                    <div className="flex flex-col gap-3 pt-1">
                        <label className="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" checked={form.active ?? false} onChange={e => set("active", e.target.checked)} className="w-4 h-4" />
                            <span className="text-sm">Ativa</span>
                        </label>
                        <label className="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" checked={form.free_shipping ?? false} onChange={e => set("free_shipping", e.target.checked)} className="w-4 h-4" />
                            <span className="text-sm flex items-center gap-1.5"><Truck className="w-3.5 h-3.5" /> Frete grátis</span>
                        </label>
                        <label className="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" checked={form.stacks_with_coupon ?? false} onChange={e => set("stacks_with_coupon", e.target.checked)} className="w-4 h-4" />
                            <span className="text-sm">Acumula com cupom</span>
                        </label>
                    </div>
                </Section>

                {/* Visual */}
                <Section title="Estilo Visual" icon={Palette}>
                    <Field label="Cor da campanha">
                        <div className="flex gap-2 flex-wrap">
                            {CAMPAIGN_COLORS.map(c => (
                                <button
                                    key={c.value}
                                    onClick={() => set("campaign_color", c.value)}
                                    className={`w-9 h-9 rounded-full border-2 transition-all ${(form.campaign_color || '#A5925A') === c.value ? "border-foreground scale-110" : "border-border"}`}
                                    style={{ backgroundColor: c.value }}
                                    title={c.label}
                                />
                            ))}
                        </div>
                    </Field>
                    <Field label="Imagem / banner (URL)">
                        <input value={form.banner_image || ""} onChange={e => set("banner_image", e.target.value)} className="admin-field w-full" placeholder="https://..." />
                    </Field>
                    {form.banner_image && (
                        <div className="relative w-full h-32 overflow-hidden rounded-lg border border-border">
                            <img src={form.banner_image} alt="Preview" className="w-full h-full object-cover" />
                        </div>
                    )}
                </Section>

                {/* Actions */}
                <div className="flex gap-3 pt-4 pb-8">
                    <button onClick={() => onSave(form)} disabled={!form.name} className="btn-gold px-6 py-2.5 text-sm disabled:opacity-40 flex items-center gap-2">
                        <Save className="w-4 h-4" strokeWidth={1.5} /> Salvar
                    </button>
                    <button onClick={onCancel} className="btn-outline px-6 py-2.5 text-sm">Cancelar</button>
                </div>
            </div>
        </div>
    );
}

function Section({ title, icon: Icon, children }) {
    return (
        <div className="bg-background border border-border rounded-lg p-5 space-y-4">
            <div className="flex items-center gap-2">
                <Icon className="w-4 h-4 text-[hsl(var(--gold))]" strokeWidth={1.5} />
                <h3 className="text-[11px] uppercase tracking-[0.18em] font-medium">{title}</h3>
            </div>
            {children}
        </div>
    );
}

function Field({ label, children }) {
    return (
        <div>
            <label className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground block mb-1.5">{label}</label>
            {children}
        </div>
    );
}
