import React, { useState, useEffect, useRef } from "react";
import { Plus, Pencil, Trash2, Image, Eye, AlertCircle, Tag, MapPin, Link2, Calendar, Check, Wand2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import AdminWizard from "@/components/admin/AdminWizard";
import AdminInput from "@/components/admin/AdminInput";
import AdminTextarea from "@/components/admin/AdminTextarea";
import AdminImageUploader from "@/components/admin/AdminImageUploader";
import AdminToggle from "@/components/admin/AdminToggle";
import AdminSelect from "@/components/admin/AdminSelect";
import AdminConfirmDialog from "@/components/admin/AdminConfirmDialog";
import ErrorBoundary from "@/components/admin/ErrorBoundary";
import StorefrontPreview from "@/components/admin/StorefrontPreview";
import { logAdminAction } from "@/lib/audit";
import { BANNER_POSITION_PRESETS, IMAGE_PRESETS, generateMobileVersion, blobToFile } from "@/lib/imageProcessor";

export const BANNER_POSITIONS = [
    { value: "home_hero", label: "Home — Hero principal" },
    { value: "home_after_news", label: "Home — Após novidades" },
    { value: "home_between_categories", label: "Home — Entre categorias" },
    { value: "home_before_instagram", label: "Home — Antes do Instagram" },
    { value: "home_footer_promo", label: "Home — Rodapé promocional" },
    { value: "product_top", label: "Página de Produto — Topo" },
    { value: "product_after_desc", label: "Página de Produto — Após descrição" },
    { value: "lookbook_top", label: "Monte seu Look — Topo" },
    { value: "lookbook_sidebar", label: "Monte seu Look — Lateral/Resumo" },
    { value: "cart_top", label: "Carrinho — Topo" },
    { value: "cart_summary", label: "Carrinho — Resumo" },
    { value: "checkout_top", label: "Checkout — Topo" },
    { value: "collections_top", label: "Coleções — Topo" },
    { value: "shop_top", label: "Loja — Topo" },
    { value: "about_top", label: "Nossa História — Topo" },
    { value: "contact_top", label: "Contato — Topo" },
    { value: "custom", label: "Custom / Posição futura" },
];

const POSITION_LABELS = Object.fromEntries(BANNER_POSITIONS.map(p => [p.value, p.label]));

const WIZARD_STEPS = [
    { id: "ident", label: "Identificação", icon: Tag },
    { id: "images", label: "Imagens", icon: Image },
    { id: "position", label: "Onde exibir", icon: MapPin },
    { id: "cta", label: "CTA e links", icon: Link2 },
    { id: "schedule", label: "Agendamento", icon: Calendar },
    { id: "preview", label: "Revisão", icon: Check },
];

export default function Banners() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleting, setDeleting] = useState(false);

    const load = () => {
        setLoading(true);
        base44.entities.Banner.list("sort_order", 100).then(setItems).catch(() => {}).finally(() => setLoading(false));
    };
    useEffect(() => { load(); }, []);

    const confirmDelete = async () => {
        setDeleting(true);
        try {
            await base44.entities.Banner.delete(deleteTarget.id);
            await logAdminAction("banner_deleted", "Banner", deleteTarget.id, deleteTarget.internal_name || deleteTarget.title, "Banner excluído");
            setDeleteTarget(null); load();
        } catch {} finally { setDeleting(false); }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="font-heading text-2xl tracking-[0.03em]">Banners</h1>
                <button onClick={() => setEditing({})} className="btn-gold"><Plus className="w-4 h-4" strokeWidth={1.5} /> Novo banner</button>
            </div>
            {loading ? <div className="h-40 bg-background animate-pulse rounded-lg" /> : items.length === 0 ? (
                <div className="bg-background p-12 text-center rounded-lg border border-border">
                    <Image className="w-10 h-10 text-muted-foreground/40 mx-auto mb-4" strokeWidth={1} />
                    <p className="text-sm text-muted-foreground">Nenhum banner cadastrado.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {items.map((b) => (
                        <div key={b.id} className="bg-background rounded-lg border border-border p-4 flex items-center gap-4">
                            {b.image ? <img src={b.image} alt="" className="w-24 h-16 object-cover bg-bone rounded" /> : <div className="w-24 h-16 bg-bone rounded flex items-center justify-center"><Image className="w-6 h-6 text-muted-foreground/30" strokeWidth={1} /></div>}
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{b.internal_name || b.title || "Sem nome"}</p>
                                <p className="text-[11px] text-muted-foreground truncate">
                                    {POSITION_LABELS[b.position] || b.position || "—"}
                                    {b.promotion_id && <span className="ml-2 inline-flex items-center gap-1 text-accent"><Tag className="w-3 h-3" /> promoção</span>}
                                </p>
                            </div>
                            <span className={`text-[10px] uppercase tracking-[0.12em] px-2 py-1 rounded ${b.active ? "bg-accent/10 text-accent" : "bg-muted text-muted-foreground"}`}>{b.active ? "Ativo" : "Inativo"}</span>
                            <div className="flex gap-1">
                                <button onClick={() => setEditing(b)} className="p-2 hover:bg-muted rounded transition-colors"><Pencil className="w-4 h-4" strokeWidth={1.25} /></button>
                                <button onClick={() => setDeleteTarget(b)} className="p-2 hover:bg-muted rounded transition-colors text-rose"><Trash2 className="w-4 h-4" strokeWidth={1.25} /></button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {editing && (
                <ErrorBoundary
                    message="Não foi possível carregar o formulário. Tente novamente."
                    fallback={(err, retry) => (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 backdrop-blur-sm">
                            <div className="bg-background border border-border rounded-xl shadow-2xl max-w-md p-8 text-center">
                                <AlertCircle className="w-8 h-8 text-rose mx-auto mb-4" strokeWidth={1.5} />
                                <p className="text-sm text-muted-foreground mb-4">Não foi possível carregar o formulário. Tente novamente.</p>
                                <button onClick={retry} className="btn-outline">Tentar novamente</button>
                            </div>
                        </div>
                    )}
                >
                    <BannerWizard item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
                </ErrorBoundary>
            )}
            <AdminConfirmDialog
                open={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={confirmDelete}
                title="Excluir banner"
                message="Você está prestes a excluir:"
                itemName={deleteTarget?.internal_name || deleteTarget?.title}
                confirmLabel="Excluir"
                loading={deleting}
            />
        </div>
    );
}

function BannerWizard({ item, onClose, onSaved }) {
    const [form, setForm] = useState({
        internal_name: item.internal_name || "",
        title: item.title || "",
        subtitle: item.subtitle || "",
        eyebrow: item.eyebrow || "",
        text: item.text || "",
        image: item.image || "",
        image_mobile: item.image_mobile || "",
        position: item.position || "",
        button_text: item.button_text || item.primary_cta_label || "",
        button_link: item.button_link || item.primary_cta_link || "",
        secondary_cta_label: item.secondary_cta_label || "",
        secondary_cta_link: item.secondary_cta_link || "",
        active: item.active !== false,
        sort_order: item.sort_order || 0,
        priority: item.priority || 0,
        start_date: item.start_date ? item.start_date.slice(0, 16) : "",
        end_date: item.end_date ? item.end_date.slice(0, 16) : "",
        display_mode: item.display_mode || "priority",
        promotion_id: item.promotion_id || "",
        max_image_size_mb: item.max_image_size_mb || 5,
    });
    const [saving, setSaving] = useState(false);
    const [previewDevice, setPreviewDevice] = useState("desktop");
    const [stepErrors, setStepErrors] = useState(null);
    const [generatingMobile, setGeneratingMobile] = useState(false);
    const [positionChanged, setPositionChanged] = useState(null); // { oldPos, newPos } or null
    const prevPositionRef = useRef(form.position);
    const set = (k, v) => {
        if (k === "position" && v !== prevPositionRef.current) {
            if (form.image) setPositionChanged({ oldPos: prevPositionRef.current, newPos: v });
            prevPositionRef.current = v;
        }
        setForm((f) => ({ ...f, [k]: v }));
        setStepErrors(null);
    };

    // Position presets for desktop and mobile
    const posPresets = BANNER_POSITION_PRESETS[form.position || "custom"] || BANNER_POSITION_PRESETS.custom;
    const desktopPreset = posPresets.desktop;
    const mobilePreset = posPresets.mobile;

    const handleGenerateMobile = async () => {
        if (!form.image) return;
        setGeneratingMobile(true);
        try {
            const mobilePresetData = IMAGE_PRESETS[mobilePreset];
            const { blob, ext } = await generateMobileVersion(
                form.image,
                mobilePresetData.aspect,
                mobilePresetData.maxWidth,
                mobilePresetData.maxHeight,
                mobilePresetData.quality || 0.8
            );
            const file = blobToFile(blob, "mobile-version", ext);
            const { file_url } = await base44.integrations.Core.UploadFile({ file });
            set("image_mobile", file_url);
        } catch (e) {
            console.error("[BannerWizard] Mobile generation error:", e);
        } finally {
            setGeneratingMobile(false);
        }
    };

    const validateStep = (stepIndex) => {
        const errors = {};
        if (stepIndex === 0 && !form.internal_name?.trim()) errors.internal_name = "Nome interno é obrigatório";
        if (stepIndex === 1 && !form.image) errors.image = "Adicione uma imagem para publicar este banner.";
        if (stepIndex === 2 && !form.position) errors.position = "Posição é obrigatória";
        return Object.keys(errors).length > 0 ? errors : null;
    };

    const save = async () => {
        const allErrors = {};
        if (!form.internal_name?.trim()) allErrors.internal_name = "Nome interno é obrigatório";
        if (!form.position) allErrors.position = "Posição é obrigatória";
        if (!form.image) allErrors.image = "Adicione uma imagem para publicar este banner.";
        if (Object.keys(allErrors).length > 0) { setStepErrors(allErrors); return; }

        setSaving(true);
        try {
            const data = { ...form };
            if (!data.image_mobile && data.image) data.image_mobile = data.image;
            if (data.start_date) data.start_date = new Date(data.start_date).toISOString();
            if (data.end_date) data.end_date = new Date(data.end_date).toISOString();
            if (!data.promotion_id) delete data.promotion_id;

            if (item.id) {
                await base44.entities.Banner.update(item.id, data);
                await logAdminAction("banner_updated", "Banner", item.id, form.internal_name, "Banner atualizado");
            } else {
                const newBanner = await base44.entities.Banner.create(data);
                await logAdminAction("banner_created", "Banner", newBanner.id, form.internal_name, "Banner criado");
            }
            onSaved();
        } catch (err) {
            console.error("Erro ao salvar banner:", err);
            setStepErrors({ _general: "Erro ao salvar. Verifique os dados." });
        } finally { setSaving(false); }
    };

    const previewImage = previewDevice === "mobile" ? (form.image_mobile || form.image) : form.image;

    const renderStep = (step, wizProps) => {
        const errors = wizProps?.stepErrors || stepErrors;

        switch (step.id) {
            case "ident":
                return (
                    <div className="max-w-xl mx-auto space-y-4">
                        <AdminInput label="Nome interno" value={form.internal_name} onChange={(v) => set("internal_name", v)} required full placeholder="Ex: Banner Dia das Mães 2026" error={errors?.internal_name} />
                        <AdminInput label="Título" value={form.title} onChange={(v) => set("title", v)} full placeholder="Título exibido no banner" />
                        <AdminInput label="Subtítulo" value={form.subtitle} onChange={(v) => set("subtitle", v)} full placeholder="Texto abaixo do título" />
                        <AdminInput label="Sobretítulo" value={form.eyebrow} onChange={(v) => set("eyebrow", v)} placeholder="Texto acima do título" />
                        <AdminTextarea label="Texto de apoio" value={form.text} onChange={(v) => set("text", v)} rows={2} full placeholder="Texto descritivo do banner" />
                    </div>
                );
            case "images":
                return (
                    <div className="max-w-xl mx-auto space-y-4">
                        {errors?._general && (
                            <div className="flex items-center gap-2 text-sm text-rose bg-rose/5 p-3 rounded">
                                <AlertCircle className="w-4 h-4" /> {errors._general}
                            </div>
                        )}
                        {positionChanged && (
                            <div className="flex items-center justify-between gap-3 text-sm bg-amber-500/10 border border-amber-500/30 p-3 rounded">
                                <span className="flex items-center gap-1.5 text-amber-600">
                                    <AlertCircle className="w-4 h-4" /> A posição foi alterada. Deseja reajustar a imagem para a nova proporção?
                                </span>
                                <div className="flex gap-2 shrink-0">
                                    <button type="button" onClick={() => setPositionChanged(null)} className="text-[10px] uppercase tracking-[0.1em] px-2.5 py-1 border border-border rounded hover:bg-muted">Manter</button>
                                </div>
                            </div>
                        )}

                        {/* Desktop — independent instance */}
                        <AdminImageUploader
                            label="Imagem Desktop"
                            preset={desktopPreset}
                            value={form.image}
                            onChange={(v) => set("image", v)}
                            required
                            error={errors?.image}
                        />

                        {/* Mobile — independent instance */}
                        <AdminImageUploader
                            label="Imagem Mobile"
                            preset={mobilePreset}
                            value={form.image_mobile}
                            onChange={(v) => set("image_mobile", v)}
                            description={form.image && !form.image_mobile ? "Opcional - gerar a partir da imagem desktop" : undefined}
                        />

                        {/* Generate mobile button */}
                        {form.image && !form.image_mobile && (
                            <button
                                type="button"
                                onClick={handleGenerateMobile}
                                disabled={generatingMobile}
                                className="btn-outline w-full py-2.5 text-xs flex items-center justify-center gap-1.5"
                            >
                                {generatingMobile ? (
                                    <>
                                        <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                        Gerando versao mobile...
                                    </>
                                ) : (
                                    <>
                                        <Wand2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                                        Gerar versao mobile
                                    </>
                                )}
                            </button>
                        )}

                        {/* Fallback warning */}
                        {form.image && !form.image_mobile && (
                            <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" strokeWidth={1.5} />
                                Imagem mobile nao enviada. A versao desktop sera adaptada automaticamente.
                            </p>
                        )}
                    </div>
                );
            case "position":
                return (
                    <div className="max-w-xl mx-auto space-y-4">
                        <AdminSelect label="Posição" value={form.position} onChange={(v) => set("position", v)} required error={errors?.position}>
                            <option value="">Selecione uma posição...</option>
                            {BANNER_POSITIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                        </AdminSelect>
                        <div className="grid grid-cols-2 gap-4">
                            <AdminInput label="Prioridade" type="number" value={form.priority} onChange={(v) => set("priority", parseInt(v) || 0)} placeholder="0" />
                            <AdminSelect label="Modo de exibição" value={form.display_mode} onChange={(v) => set("display_mode", v)}>
                                <option value="priority">Somente maior prioridade</option>
                                <option value="carousel">Carrossel (múltiplos banners)</option>
                            </AdminSelect>
                        </div>
                    </div>
                );
            case "cta":
                return (
                    <div className="max-w-xl mx-auto space-y-4">
                        <AdminInput label="Texto do botão" value={form.button_text} onChange={(v) => set("button_text", v)} full placeholder="Ex: Ver coleção" />
                        <AdminInput label="Link do botão" value={form.button_link} onChange={(v) => set("button_link", v)} full placeholder="/loja" />
                        <AdminInput label="CTA secundário — texto" value={form.secondary_cta_label} onChange={(v) => set("secondary_cta_label", v)} placeholder="Ex: Sobre nós" />
                        <AdminInput label="CTA secundário — link" value={form.secondary_cta_link} onChange={(v) => set("secondary_cta_link", v)} placeholder="/sobre" />
                    </div>
                );
            case "schedule":
                return (
                    <div className="max-w-xl mx-auto space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <AdminInput label="Data de início" type="datetime-local" value={form.start_date} onChange={(v) => set("start_date", v)} />
                            <AdminInput label="Data de fim" type="datetime-local" value={form.end_date} onChange={(v) => set("end_date", v)} />
                        </div>
                        <AdminInput label="Ordem" type="number" value={form.sort_order} onChange={(v) => set("sort_order", parseInt(v) || 0)} />
                        <AdminToggle label="Banner ativo" checked={form.active} onChange={(v) => set("active", v)} description="Quando ativo, o banner aparece na loja (respeitando datas e prioridade)" />
                        {errors?.active && <p className="text-xs text-rose flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {errors.active}</p>}
                        <AdminInput label="ID da promoção (opcional)" value={form.promotion_id} onChange={(v) => set("promotion_id", v)} full placeholder="UUID da promoção" />
                    </div>
                );
            case "preview":
                return (
                    <div className="max-w-3xl mx-auto space-y-6">
                        {/* Summary */}
                        <div className="bg-muted/30 rounded-lg border border-border p-6 space-y-2">
                            <h3 className="text-[11px] uppercase tracking-[0.18em] font-medium text-accent mb-3">Resumo do Banner</h3>
                            <SummaryRow label="Nome" value={form.internal_name || "—"} />
                            <SummaryRow label="Posição" value={POSITION_LABELS[form.position] || form.position || "—"} />
                            <SummaryRow label="Prioridade" value={String(form.priority || 0)} />
                            <SummaryRow label="Modo" value={form.display_mode === "carousel" ? "Carrossel" : "Prioridade"} />
                            <SummaryRow label="Ativo" value={form.active ? "Sim" : "Não"} />
                            <SummaryRow label="CTA" value={form.button_text || "—"} />
                        </div>

                        {/* Real storefront preview */}
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Eye className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
                                <span className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground">Como ficará no site</span>
                            </div>
                            <StorefrontPreview
                                position={form.position || "custom"}
                                banner={form}
                                device={previewDevice}
                                allowDeviceToggle={true}
                            />
                        </div>
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <AdminWizard
            title={`${item.id ? "Editar" : "Novo"} banner`}
            subtitle="Configure banners com posicionamento e agendamento"
            icon={Image}
            steps={WIZARD_STEPS}
            validateStep={validateStep}
            onSave={save}
            onClose={onClose}
            saveLabel="Salvar banner"
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
