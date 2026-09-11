import React, { useState, useEffect } from "react";
import { Plus, Trash2, Power, Tag, Calendar, Palette, Percent, Truck, ShoppingCart, Eye, Check } from "lucide-react";
import AdminWizard from "@/components/admin/AdminWizard";
import AdminInput from "@/components/admin/AdminInput";
import AdminSelect from "@/components/admin/AdminSelect";
import AdminTextarea from "@/components/admin/AdminTextarea";
import AdminToggle from "@/components/admin/AdminToggle";
import AdminImageUploader from "@/components/admin/AdminImageUploader";
import PromotionPreview from "@/components/admin/PromotionPreview";

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

const WIZARD_STEPS = [
    { id: "ident", label: "Identificação", icon: Tag },
    { id: "discount", label: "Desconto", icon: Percent },
    { id: "apply", label: "Aplicação", icon: ShoppingCart },
    { id: "period", label: "Período", icon: Calendar },
    { id: "visual", label: "Visual", icon: Palette },
    { id: "review", label: "Revisão", icon: Check },
];

const PROMO_TYPE_LABELS = Object.fromEntries(PROMO_TYPES.map(t => [t.value, t.label]));

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

    if (editing) return <PromoWizard promo={editing} onSave={handleSave} onCancel={() => setEditing(null)} />;

    function getPromoStatus(p) {
        const now = new Date();
        const start = p.valid_from ? new Date(p.valid_from) : null;
        const end = p.valid_until ? new Date(p.valid_until) : null;
        if (!p.active) return { label: "INATIVA", className: "border-border text-muted-foreground" };
        if (start && start > now) return { label: "AGENDADA", className: "border-blue-400/40 text-blue-600" };
        if (end && end < now) return { label: "ENCERRADA", className: "border-border text-muted-foreground line-through" };
        return { label: "ATIVA", className: "border-green-500/40 text-green-600" };
    }

    function formatDate(dt) {
        if (!dt) return "—";
        return new Date(dt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
    }

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
                    {promos.map(p => {
                        const status = getPromoStatus(p);
                        return (
                            <div key={p.id} className="bg-background border border-border p-4 flex items-center justify-between gap-4">
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                    <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: (p.campaign_color || '#A5925A') + '20' }}>
                                        <Tag className="w-4 h-4" style={{ color: p.campaign_color || '#A5925A' }} strokeWidth={1.5} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="font-medium text-sm">{p.name}</p>
                                            <span className={`text-[9px] uppercase tracking-[0.12em] px-2 py-0.5 border ${status.className}`}>
                                                {status.label}
                                            </span>
                                            {p.free_shipping && <span className="text-[9px] uppercase tracking-[0.1em] px-2 py-0.5 border border-[hsl(var(--gold))]/30 text-[hsl(var(--gold))]">Frete grátis</span>}
                                        </div>
                                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                                            <span className="text-[11px] text-muted-foreground">Tipo: {PROMO_TYPE_LABELS[p.promo_type || p.type] || p.type}</span>
                                            <span className="text-[11px] text-muted-foreground">Desconto: {Number(p.discount_percent) > 0 ? `${Number(p.discount_percent)}%` : Number(p.discount_fixed) > 0 ? `R$ ${p.discount_fixed}` : "—"}</span>
                                            <span className="text-[11px] text-muted-foreground">Início: {formatDate(p.valid_from)}</span>
                                            <span className="text-[11px] text-muted-foreground">Fim: {formatDate(p.valid_until)}</span>
                                            <span className="text-[11px] text-muted-foreground">Prioridade: {p.priority || 0}</span>
                                            {p.applicable_category && <span className="text-[11px] text-muted-foreground">Cat: {p.applicable_category}</span>}
                                            {p.applicable_collection && <span className="text-[11px] text-muted-foreground">Col: {p.applicable_collection}</span>}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex gap-2 shrink-0">
                                    <button onClick={() => handleToggle(p)} className={`p-1.5 ${p.active ? "text-green-600" : "text-muted-foreground hover:text-foreground"}`} title={p.active ? "Desativar" : "Ativar"}>
                                        <Power className="w-4 h-4" strokeWidth={1.25} />
                                    </button>
                                    <button onClick={() => setEditing(p)} className="text-[11px] uppercase tracking-[0.12em] text-foreground/70 hover:text-foreground border border-border px-3 py-1.5">Editar</button>
                                    <button onClick={() => handleDelete(p.id)} className="text-muted-foreground hover:text-[hsl(var(--rose))] p-1.5"><Trash2 className="w-4 h-4" strokeWidth={1.25} /></button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function PromoWizard({ promo, onSave, onCancel }) {
    const [form, setForm] = useState(promo);
    const [saving, setSaving] = useState(false);
    const set = (field, val) => setForm(prev => ({ ...prev, [field]: val }));

    const validateStep = (stepIndex) => {
        const errors = {};
        if (stepIndex === 0 && !form.name?.trim()) errors.name = "Nome da campanha é obrigatório";
        return Object.keys(errors).length > 0 ? errors : null;
    };

    const handleSave = async () => {
        setSaving(true);
        try { await onSave(form); } finally { setSaving(false); }
    };

    const getPromoStatus = () => {
        const now = new Date();
        const start = form.valid_from ? new Date(form.valid_from) : null;
        const end = form.valid_until ? new Date(form.valid_until) : null;
        if (!form.active) return "INATIVA";
        if (start && start > now) return "AGENDADA";
        if (end && end < now) return "ENCERRADA";
        return "ATIVA";
    };

    const renderStep = (step) => {
        switch (step.id) {
            case "ident":
                return (
                    <div className="max-w-xl mx-auto space-y-4">
                        <AdminInput label="Nome da campanha" value={form.name} onChange={(v) => set("name", v)} required full placeholder="Ex: Dia das Mães 2026" error={stepErrors?.name} />
                        <AdminInput label="Título de destaque" value={form.title || ""} onChange={(v) => set("title", v)} full placeholder="Ex: DIA DAS MÃES" />
                        <AdminInput label="Subtítulo" value={form.subtitle || ""} onChange={(v) => set("subtitle", v)} full placeholder="Ex: 10% OFF em looks com 3+ peças" />
                        <AdminTextarea label="Texto curto de divulgação" value={form.short_text || ""} onChange={(v) => set("short_text", v)} rows={2} full placeholder="Ex: Leve 3 peças e ganhe 10% OFF" />
                    </div>
                );
            case "discount":
                return (
                    <div className="max-w-xl mx-auto space-y-4">
                        <AdminSelect label="Tipo da promoção" value={form.promo_type || form.type} onChange={(v) => { set("promo_type", v); set("type", v); }} required options={PROMO_TYPES} />
                        {form.promo_type !== "free_shipping" && (
                            <div className="grid grid-cols-2 gap-4">
                                <AdminInput label="Desconto (%)" type="number" value={form.discount_percent || 0} onChange={(v) => set("discount_percent", parseFloat(v) || 0)} />
                                <AdminInput label="Desconto fixo (R$)" type="number" value={form.discount_fixed || 0} onChange={(v) => set("discount_fixed", parseFloat(v) || 0)} />
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-4">
                            <AdminInput label="Valor mínimo (R$)" type="number" value={form.min_value || 0} onChange={(v) => set("min_value", parseFloat(v) || 0)} />
                            <AdminInput label="Compre X peças" type="number" value={form.min_items || 0} onChange={(v) => set("min_items", parseInt(v) || 0)} />
                        </div>
                        {form.promo_type === "buy_x" && (
                            <AdminInput label="Buy quantity (qty alvo)" type="number" value={form.buy_quantity || 0} onChange={(v) => set("buy_quantity", parseInt(v) || 0)} />
                        )}
                        <AdminInput label="Prioridade (maior = mais destaque)" type="number" value={form.priority || 0} onChange={(v) => set("priority", parseInt(v) || 0)} />
                        <label className="flex items-center gap-3 cursor-pointer pt-2">
                            <input type="checkbox" checked={form.free_shipping ?? false} onChange={e => set("free_shipping", e.target.checked)} className="w-4 h-4" />
                            <span className="text-sm flex items-center gap-1.5"><Truck className="w-3.5 h-3.5" /> Frete grátis</span>
                        </label>
                        <label className="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" checked={form.stacks_with_coupon ?? false} onChange={e => set("stacks_with_coupon", e.target.checked)} className="w-4 h-4" />
                            <span className="text-sm">Acumula com cupom</span>
                        </label>
                    </div>
                );
            case "apply":
                return (
                    <div className="max-w-xl mx-auto space-y-4">
                        <AdminInput label="Categoria aplicável" value={form.applicable_category || ""} onChange={(v) => set("applicable_category", v)} full placeholder="Ex: vestidos" />
                        <AdminInput label="Coleção aplicável" value={form.applicable_collection || ""} onChange={(v) => set("applicable_collection", v)} full placeholder="Ex: verao-2026" />
                        <p className="text-[11px] text-muted-foreground">Deixe ambos vazios para aplicar a todo o site.</p>
                    </div>
                );
            case "period":
                return (
                    <div className="max-w-xl mx-auto space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <AdminInput label="Data de início" type="datetime-local" value={form.valid_from?.slice(0, 16) || ""} onChange={(v) => set("valid_from", v || null)} />
                            <AdminInput label="Data de término" type="datetime-local" value={form.valid_until?.slice(0, 16) || ""} onChange={(v) => set("valid_until", v || null)} />
                        </div>
                        <AdminToggle label="Ativa" checked={form.active ?? false} onChange={(v) => set("active", v)} description="Quando ativa, a promoção é aplicada na loja" />
                        <div className="flex items-center gap-2 pt-2">
                            <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Status previsto:</span>
                            <span className={`text-[10px] uppercase tracking-[0.12em] px-2.5 py-1 border ${
                                getPromoStatus() === "ATIVA" ? "border-green-500/40 text-green-600"
                                : getPromoStatus() === "AGENDADA" ? "border-blue-400/40 text-blue-600"
                                : "border-border text-muted-foreground"
                            }`}>{getPromoStatus()}</span>
                        </div>
                    </div>
                );
            case "visual":
                return (
                    <div className="max-w-xl mx-auto space-y-4">
                        <div>
                            <label className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground block mb-2">Cor da campanha</label>
                            <div className="flex gap-2 flex-wrap">
                                {CAMPAIGN_COLORS.map(c => (
                                    <button key={c.value} onClick={() => set("campaign_color", c.value)}
                                        className={`w-9 h-9 rounded-full border-2 transition-all ${(form.campaign_color || '#A5925A') === c.value ? "border-foreground scale-110" : "border-border"}`}
                                        style={{ backgroundColor: c.value }} title={c.label} />
                                ))}
                            </div>
                        </div>
                        <AdminImageUploader label="Imagem / banner" preset="promotion_banner" value={form.banner_image || ""} onChange={(v) => set("banner_image", v)} full />
                    </div>
                );
            case "review":
                return (
                    <div className="max-w-3xl mx-auto space-y-6">
                        {/* Summary */}
                        <div className="bg-muted/30 rounded-lg border border-border p-6 space-y-3">
                            <h3 className="text-[11px] uppercase tracking-[0.18em] font-medium text-accent mb-4">Resumo da Promoção</h3>
                            <SummaryRow label="Campanha" value={form.name || "—"} />
                            <SummaryRow label="Título" value={form.title || "—"} />
                            <SummaryRow label="Tipo" value={PROMO_TYPE_LABELS[form.promo_type || form.type] || "—"} />
                            <SummaryRow label="Desconto" value={Number(form.discount_percent) > 0 ? `${form.discount_percent}%` : Number(form.discount_fixed) > 0 ? `R$ ${form.discount_fixed}` : "—"} />
                            <SummaryRow label="Aplicação" value={form.applicable_category ? `Categoria: ${form.applicable_category}` : form.applicable_collection ? `Coleção: ${form.applicable_collection}` : "Todo o site"} />
                            <SummaryRow label="Início" value={form.valid_from ? new Date(form.valid_from).toLocaleDateString('pt-BR') : "—"} />
                            <SummaryRow label="Fim" value={form.valid_until ? new Date(form.valid_until).toLocaleDateString('pt-BR') : "—"} />
                            <SummaryRow label="Prioridade" value={String(form.priority || 0)} />
                            <SummaryRow label="Status" value={getPromoStatus()} />
                        </div>

                        {/* Real context-aware preview */}
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Eye className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
                                <span className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground">Como ficará no site</span>
                            </div>
                            <PromotionPreview form={form} />
                        </div>
                    </div>
                );
            default:
                return null;
        }
    };

    // stepErrors is passed by AdminWizard's render prop
    let stepErrors = null;
    const renderWithErrors = (step, wizProps) => {
        stepErrors = wizProps.stepErrors;
        return renderStep(step);
    };

    return (
        <AdminWizard
            title={promo.id ? "Editar Promoção" : "Nova Promoção"}
            subtitle="Configure campanhas de desconto em etapas"
            icon={Tag}
            steps={WIZARD_STEPS}
            validateStep={validateStep}
            onSave={handleSave}
            onClose={onCancel}
            saveLabel="Publicar"
            saving={saving}
        >
            {renderWithErrors}
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
