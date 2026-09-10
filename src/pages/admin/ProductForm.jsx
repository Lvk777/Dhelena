import React, { useState, useEffect } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { Plus, X, Loader2, Eye, Check, Package, ImageIcon, DollarSign, Palette, FolderTree, Settings, Truck } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useCatalog } from "@/context/CatalogContext";
import { COLOR_SWATCHES, SIZES_LIST } from "@/data/products";
import ImageUploader from "@/components/ImageUploader";
import AdminWizard from "@/components/admin/AdminWizard";
import ProductPreview from "@/components/admin/ProductPreview";
import { logAdminAction } from "@/lib/audit";

const TAGS = [
    { key: "novo", label: "Novidade" },
    { key: "destaque", label: "Destaque" },
    { key: "maisVendido", label: "Mais vendido" },
    { key: "ultimas", label: "Últimas peças" },
    { key: "promocao", label: "Promoção" },
    { key: "exclusivo", label: "Exclusivo" },
];

const WIZARD_STEPS = [
    { id: "basic", label: "Informações", icon: Package },
    { id: "photos", label: "Fotos", icon: ImageIcon },
    { id: "variants", label: "Variações", icon: Palette },
    { id: "price", label: "Preço", icon: DollarSign },
    { id: "category", label: "Organização", icon: FolderTree },
    { id: "seo", label: "SEO", icon: Settings },
    { id: "review", label: "Revisão", icon: Check },
];

export default function ProductForm() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { categories, collections, reload } = useCatalog();
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({
        name: "", sku: "", category: "", subcategory: "", collection: "",
        description: "", short_description: "", details: "",
        price: "", sale_price: "", cost_price: "", installments: 6,
        images: [],
        colors: [],
        sizes: [...SIZES_LIST],
        badges: { novo: false, destaque: false, maisVendido: false, ultimas: false, promocao: false, exclusivo: false },
        composition: "", modeling: "", length: "", lining: "", transparency: "", elasticity: "", care: "", measurements: "",
        weight: "", package_height: "", package_width: "", package_length: "",
        status: "draft",
    });

    useEffect(() => {
        if (!id) return;
        base44.entities.Product.get(id).then((p) => {
            setForm({
                name: p.name || "", sku: p.sku || "", category: p.category || "", subcategory: p.subcategory || "",
                collection: p.collection || "", description: p.description || "", short_description: p.short_description || "",
                details: p.details || "", price: p.price || "", sale_price: p.sale_price || "", cost_price: p.cost_price || "",
                installments: p.installments || 6, images: p.images || [], colors: p.colors || [],
                sizes: (p.sizes && p.sizes.length) ? p.sizes : [...SIZES_LIST],
                badges: p.badges || { novo: false, destaque: false, maisVendido: false, ultimas: false, promocao: false, exclusivo: false },
                composition: p.composition || "", modeling: p.modeling || "", length: p.length || "",
                lining: p.lining || "", transparency: p.transparency || "", elasticity: p.elasticity || "",
                care: p.care || "", measurements: p.measurements || "",
                weight: p.weight || "", package_height: p.package_height || "", package_width: p.package_width || "",
                package_length: p.package_length || "", status: p.status || "draft",
            });
        });
    }, [id]);

    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

    const addColor = (colorId) => {
        const sw = COLOR_SWATCHES[colorId];
        if (!sw) return;
        if (form.colors.find((c) => c.id === colorId)) return;
        const stock = {}; form.sizes.forEach((s) => { stock[s] = 0; });
        set("colors", [...form.colors, { id: colorId, name: sw.name, hex: sw.hex, image: "", stock }]);
    };

    const addCustomColor = () => {
        const id = `custom_${Date.now()}`;
        const stock = {}; form.sizes.forEach((s) => { stock[s] = 0; });
        set("colors", [...form.colors, { id, name: "", hex: "#E6B0B8", image: "", stock }]);
    };

    const removeColor = (idx) => set("colors", form.colors.filter((_, i) => i !== idx));
    const updateColor = (idx, field, value) => {
        const next = [...form.colors];
        next[idx] = { ...next[idx], [field]: value };
        set("colors", next);
    };
    const updateStock = (colorIdx, size, value) => {
        const next = [...form.colors];
        next[colorIdx] = { ...next[colorIdx], stock: { ...next[colorIdx].stock, [size]: parseInt(value) || 0 } };
        set("colors", next);
    };

    const addSize = () => {
        const ns = prompt("Nome do tamanho (ex: GG, 38, Único):");
        if (!ns) return;
        if (form.sizes.includes(ns)) return;
        const newColors = form.colors.map((c) => ({ ...c, stock: { ...c.stock, [ns]: 0 } }));
        set("sizes", [...form.sizes, ns]);
        set("colors", newColors);
    };
    const removeSize = (size) => {
        set("sizes", form.sizes.filter((s) => s !== size));
        set("colors", form.colors.map((c) => { const ns = { ...c.stock }; delete ns[size]; return { ...c, stock: ns }; }));
    };

    const toggleTag = (key) => set("badges", { ...form.badges, [key]: !form.badges[key] });

    const buildPayload = (status) => ({
        name: form.name,
        sku: form.sku,
        category: form.category,
        subcategory: form.subcategory,
        collection: form.collection,
        description: form.description,
        short_description: form.short_description,
        details: form.details,
        price: parseFloat(form.price) || 0,
        sale_price: form.sale_price ? parseFloat(form.sale_price) : null,
        cost_price: parseFloat(form.cost_price) || 0,
        installments: parseInt(form.installments) || 6,
        images: form.images,
        colors: form.colors,
        sizes: form.sizes,
        badges: form.badges,
        composition: form.composition,
        modeling: form.modeling,
        length: form.length,
        lining: form.lining,
        transparency: form.transparency,
        elasticity: form.elasticity,
        care: form.care,
        measurements: form.measurements,
        weight: parseFloat(form.weight) || 0,
        package_height: parseFloat(form.package_height) || 0,
        package_width: parseFloat(form.package_width) || 0,
        package_length: parseFloat(form.package_length) || 0,
        status,
    });

    const validateStep = (stepIndex) => {
        const errors = {};
        if (stepIndex === 0 && !form.name.trim()) errors.name = "Informe o nome do produto";
        if (stepIndex === 3 && !form.price) errors.price = "Informe o preço do produto";
        return Object.keys(errors).length > 0 ? errors : null;
    };

    const save = async (status) => {
        if (!form.name.trim()) return;
        setSaving(true);
        try {
            if (id) {
                await base44.entities.Product.update(id, buildPayload(status));
                await logAdminAction("product_update", "Product", id, form.name, `Produto atualizado (status: ${status})`);
            } else {
                const newProduct = await base44.entities.Product.create(buildPayload(status));
                await logAdminAction("product_create", "Product", newProduct.id, form.name, `Produto criado (status: ${status})`);
            }
            await reload();
            navigate("/admin/produtos");
        } catch (e) {
            console.error("Erro ao salvar:", e);
        } finally {
            setSaving(false);
        }
    };

    const renderStep = (step) => {
        switch (step.id) {
            case "basic":
                return (
                    <div className="max-w-xl mx-auto space-y-4">
                        <WizardInput label="Nome do produto" value={form.name} onChange={(v) => set("name", v)} full placeholder="Ex: Vestido Helena Midi" />
                        <WizardInput label="SKU" value={form.sku} onChange={(v) => set("sku", v)} placeholder="Ex: DH-VD-001" />
                        <WizardTextarea label="Descrição completa" value={form.description} onChange={(v) => set("description", v)} full rows={4} />
                        <WizardTextarea label="Descrição resumida" value={form.short_description} onChange={(v) => set("short_description", v)} full rows={2} />
                        <WizardTextarea label="Detalhes" value={form.details} onChange={(v) => set("details", v)} full rows={2} />
                    </div>
                );
            case "photos":
                return (
                    <div className="max-w-xl mx-auto">
                        <ImageUploader images={form.images} onChange={(urls) => set("images", urls)} />
                    </div>
                );
            case "variants":
                return (
                    <div className="max-w-2xl mx-auto space-y-5">
                        {/* Sizes */}
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Tamanhos</span>
                                <button onClick={addSize} className="text-xs text-[hsl(var(--rose))] flex items-center gap-1"><Plus className="w-3 h-3" /> Adicionar tamanho</button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {form.sizes.map((s) => (
                                    <div key={s} className="flex items-center gap-1 bg-[hsl(var(--bone))] px-3 py-1.5 text-sm">
                                        {s}
                                        <button onClick={() => removeSize(s)} className="text-muted-foreground hover:text-[hsl(var(--rose))]"><X className="w-3 h-3" /></button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Colors */}
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Cores e estoque</span>
                                <button onClick={addCustomColor} className="text-xs text-[hsl(var(--rose))] flex items-center gap-1"><Plus className="w-3 h-3" /> Cor personalizada</button>
                            </div>
                            <div className="flex flex-wrap gap-2 mb-4">
                                {Object.entries(COLOR_SWATCHES).map(([key, sw]) => {
                                    const added = form.colors.find((c) => c.id === key);
                                    if (added) return null;
                                    return (
                                        <button key={key} onClick={() => addColor(key)} className="flex items-center gap-2 border border-border px-3 py-1.5 text-xs hover:border-foreground/40 transition-colors">
                                            <span className="w-3 h-3 rounded-full border border-border" style={{ background: sw.hex }} />
                                            {sw.name}
                                            <Plus className="w-3 h-3" />
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="space-y-4">
                                {form.colors.map((color, idx) => (
                                    <div key={idx} className="bg-[hsl(var(--bone))] p-4">
                                        <div className="flex items-center gap-3 mb-3">
                                            <input type="color" value={color.hex} onChange={(e) => updateColor(idx, "hex", e.target.value)} className="w-10 h-10 rounded border border-border cursor-pointer" />
                                            <input value={color.name} onChange={(e) => updateColor(idx, "name", e.target.value)} placeholder="Nome da cor" className="flex-1 border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--gold))]" />
                                            <button onClick={() => removeColor(idx)} className="p-2 text-muted-foreground hover:text-[hsl(var(--rose))]"><X className="w-4 h-4" /></button>
                                        </div>
                                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                                            {form.sizes.map((s) => (
                                                <div key={s}>
                                                    <label className="block text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1">{s}</label>
                                                    <input type="number" min="0" value={color.stock?.[s] ?? 0} onChange={(e) => updateStock(idx, s, e.target.value)} className="w-full border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:border-[hsl(var(--gold))]" />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                                {form.colors.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma cor adicionada. Clique em uma cor acima para adicionar.</p>}
                            </div>
                        </div>
                    </div>
                );
            case "price":
                return (
                    <div className="max-w-xl mx-auto space-y-4">
                        <WizardInput label="Preço de venda (R$)" value={form.price} onChange={(v) => set("price", v)} type="number" placeholder="299.90" full />
                        <WizardInput label="Preço promocional (opcional)" value={form.sale_price} onChange={(v) => set("sale_price", v)} type="number" placeholder="249.90" full />
                        <WizardInput label="Preço de custo (admin)" value={form.cost_price} onChange={(v) => set("cost_price", v)} type="number" placeholder="120.00" full />
                        <div>
                            <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Parcelas máximas</label>
                            <input type="number" min="1" max="12" value={form.installments} onChange={(e) => set("installments", e.target.value)} className="w-full border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:border-[hsl(var(--gold))]" />
                        </div>
                    </div>
                );
            case "category":
                return (
                    <div className="max-w-xl mx-auto space-y-4">
                        <div>
                            <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Categoria</label>
                            <select value={form.category} onChange={(e) => set("category", e.target.value)} className="w-full border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:border-[hsl(var(--gold))]" >
                                <option value="">Selecione...</option>
                                {categories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Coleção</label>
                            <select value={form.collection} onChange={(e) => set("collection", e.target.value)} className="w-full border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:border-[hsl(var(--gold))]" >
                                <option value="">Selecione...</option>
                                {collections.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Tags</label>
                            <div className="flex flex-wrap gap-2">
                                {TAGS.map((t) => (
                                    <button key={t.key} type="button" onClick={() => toggleTag(t.key)} className={`text-xs px-3 py-2 border transition-colors ${form.badges[t.key] ? "bg-[hsl(var(--gold))] text-white border-[hsl(var(--gold))]" : "border-border hover:border-foreground/40"}`}>
                                        {t.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                );
            case "seo":
                return (
                    <div className="max-w-xl mx-auto space-y-4">
                        <WizardInput label="Composição" value={form.composition} onChange={(v) => set("composition", v)} full />
                        <WizardInput label="Modelagem" value={form.modeling} onChange={(v) => set("modeling", v)} full />
                        <WizardInput label="Comprimento" value={form.length} onChange={(v) => set("length", v)} full />
                        <div className="grid grid-cols-2 gap-4">
                            <WizardInput label="Forro" value={form.lining} onChange={(v) => set("lining", v)} />
                            <WizardInput label="Transparência" value={form.transparency} onChange={(v) => set("transparency", v)} />
                            <WizardInput label="Elasticidade" value={form.elasticity} onChange={(v) => set("elasticity", v)} />
                            <WizardInput label="Peso (kg)" value={form.weight} onChange={(v) => set("weight", v)} type="number" />
                        </div>
                        <WizardTextarea label="Cuidados de lavagem" value={form.care} onChange={(v) => set("care", v)} full rows={2} />
                        <WizardTextarea label="Guia de medidas" value={form.measurements} onChange={(v) => set("measurements", v)} full rows={3} />
                        <div className="grid grid-cols-3 gap-4">
                            <WizardInput label="Altura emb. (cm)" value={form.package_height} onChange={(v) => set("package_height", v)} type="number" />
                            <WizardInput label="Largura emb. (cm)" value={form.package_width} onChange={(v) => set("package_width", v)} type="number" />
                            <WizardInput label="Compr. emb. (cm)" value={form.package_length} onChange={(v) => set("package_length", v)} type="number" />
                        </div>
                    </div>
                );
            case "review":
                return (
                    <div className="max-w-3xl mx-auto space-y-6">
                        <div className="bg-muted/30 rounded-lg border border-border p-6 space-y-2">
                            <h3 className="text-[11px] uppercase tracking-[0.18em] font-medium text-accent mb-3">Resumo do Produto</h3>
                            <SummaryRow label="Nome" value={form.name || "—"} />
                            <SummaryRow label="SKU" value={form.sku || "—"} />
                            <SummaryRow label="Preço" value={form.price ? `R$ ${form.price}` : "—"} />
                            <SummaryRow label="Preço promocional" value={form.sale_price ? `R$ ${form.sale_price}` : "—"} />
                            <SummaryRow label="Categoria" value={form.category || "—"} />
                            <SummaryRow label="Coleção" value={form.collection || "—"} />
                            <SummaryRow label="Cores" value={`${form.colors.length} cor(es)`} />
                            <SummaryRow label="Tamanhos" value={form.sizes.join(", ") || "—"} />
                            <SummaryRow label="Fotos" value={`${form.images.length} imagem(ns)`} />
                        </div>

                        {/* Real product page preview */}
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Eye className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
                                <span className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground">Como ficará no site</span>
                            </div>
                            <ProductPreview form={form} />
                        </div>
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <div>
            <Link to="/admin/produtos" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
                <X className="w-4 h-4" strokeWidth={1.5} /> Produtos
            </Link>
            <AdminWizard
                title={id ? "Editar produto" : "Novo produto"}
                subtitle="Cadastre produtos em etapas"
                icon={Package}
                steps={WIZARD_STEPS}
                validateStep={validateStep}
                onSave={(status) => save(status)}
                onClose={() => navigate("/admin/produtos")}
                saveLabel="Publicar produto"
                draftLabel="Salvar rascunho"
                onSaveDraft={(status) => save("draft")}
                saving={saving}
            >
                {renderStep}
            </AdminWizard>
        </div>
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

function WizardInput({ label, value, onChange, type = "text", full, placeholder }) {
    return (
        <div className={full ? "" : ""}>
            <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">{label}</label>
            <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors" />
        </div>
    );
}

function WizardTextarea({ label, value, onChange, full, rows = 3 }) {
    return (
        <div className={full ? "" : ""}>
            <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">{label}</label>
            <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} className="w-full border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors resize-none" />
        </div>
    );
}
