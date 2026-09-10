import React, { useState } from "react";
import { Layers, Loader2, Check, Tag, Image, Settings, Eye } from "lucide-react";
import { base44 } from "@/api/base44Client";
import AdminWizard from "@/components/admin/AdminWizard";
import AdminInput from "@/components/admin/AdminInput";
import AdminTextarea from "@/components/admin/AdminTextarea";
import AdminImageUploader from "@/components/admin/AdminImageUploader";
import AdminToggle from "@/components/admin/AdminToggle";
import CollectionPreview from "@/components/admin/CollectionPreview";
import { logAdminAction } from "@/lib/audit";

const slugify = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const WIZARD_STEPS = [
    { id: "info", label: "Nome e descrição", icon: Tag },
    { id: "image", label: "Imagem", icon: Image },
    { id: "settings", label: "Configurações", icon: Settings },
    { id: "preview", label: "Preview", icon: Check },
];

export default function CollectionForm({ item, onClose, onSaved }) {
    const [form, setForm] = useState({
        name: item.name || "",
        slug: item.slug || "",
        description: item.description || "",
        image: item.image || "",
        banner_image: item.banner_image || "",
        status: item.status || "active",
        featured: item.featured || false,
        sort_order: item.sort_order || 0,
        start_date: item.start_date ? item.start_date.slice(0, 10) : "",
        end_date: item.end_date ? item.end_date.slice(0, 10) : "",
    });
    const [slugEdited, setSlugEdited] = useState(!!item.slug);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

    const onNameChange = (v) => {
        set("name", v);
        if (!slugEdited) set("slug", slugify(v));
    };

    const validateStep = (stepIndex) => {
        const errors = {};
        if (stepIndex === 0 && !form.name.trim()) errors.name = "Informe o nome da coleção";
        return Object.keys(errors).length > 0 ? errors : null;
    };

    const save = async () => {
        if (!form.name.trim()) { setError("Informe o nome da coleção"); return; }
        setSaving(true);
        setError("");
        const slug = form.slug || slugify(form.name);
        const payload = {
            ...form,
            slug,
            sort_order: parseInt(form.sort_order) || 0,
            start_date: form.start_date || null,
            end_date: form.end_date || null,
        };
        try {
            if (item.id) {
                await base44.entities.Collection.update(item.id, payload);
                await logAdminAction("collection_update", "Collection", item.id, form.name, "Coleção atualizada");
            } else {
                const newCol = await base44.entities.Collection.create(payload);
                await logAdminAction("collection_create", "Collection", newCol.id, form.name, "Coleção criada");
            }
            onSaved();
        } catch (e) {
            setError(e.message || "Erro ao salvar");
        } finally {
            setSaving(false);
        }
    };

    const renderStep = (step) => {
        switch (step.id) {
            case "info":
                return (
                    <div className="max-w-xl mx-auto space-y-4">
                        <AdminInput label="Nome da coleção" value={form.name} onChange={onNameChange} required full placeholder="Ex: Primavera 2027" />
                        <AdminInput label="Slug (URL)" value={form.slug} onChange={(v) => { set("slug", slugify(v)); setSlugEdited(true); }} description="Gerado automaticamente a partir do nome" placeholder="auto" mono full />
                        <AdminTextarea label="Descrição" value={form.description} onChange={(v) => set("description", v)} rows={3} full placeholder="Descrição exibida na página da coleção" />
                    </div>
                );
            case "image":
                return (
                    <div className="max-w-xl mx-auto space-y-5">
                        <AdminImageUploader label="Imagem de capa" preset="collection_cover" value={form.image} onChange={(v) => set("image", v)} required />
                        <AdminImageUploader label="Banner opcional" preset="collection_banner" value={form.banner_image} onChange={(v) => set("banner_image", v)} />
                    </div>
                );
            case "settings":
                return (
                    <div className="max-w-xl mx-auto space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <AdminInput label="Ordem de exibição" type="number" value={form.sort_order} onChange={(v) => set("sort_order", parseInt(v) || 0)} description="Menor número aparece primeiro" />
                            <AdminInput label="Data de início (opcional)" type="date" value={form.start_date} onChange={(v) => set("start_date", v)} />
                        </div>
                        <AdminInput label="Data de término (opcional)" type="date" value={form.end_date} onChange={(v) => set("end_date", v)} full />
                        <div>
                            <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Status</label>
                            <div className="flex gap-2">
                                <button onClick={() => set("status", "active")} className={`flex-1 py-3 text-sm border rounded-lg transition-colors ${form.status === "active" ? "border-accent bg-accent/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>Ativa</button>
                                <button onClick={() => set("status", "inactive")} className={`flex-1 py-3 text-sm border rounded-lg transition-colors ${form.status === "inactive" ? "border-accent bg-accent/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>Inativa</button>
                            </div>
                        </div>
                        <AdminToggle label="Destaque na Home" checked={form.featured} onChange={(v) => set("featured", v)} description="Exibe a coleção em destaque na página inicial" />
                    </div>
                );
            case "preview":
                return (
                    <div className="max-w-3xl mx-auto space-y-6">
                        <div className="bg-muted/30 rounded-lg border border-border p-6 space-y-2">
                            <h3 className="text-[11px] uppercase tracking-[0.18em] font-medium text-accent mb-3">Resumo da Coleção</h3>
                            <SummaryRow label="Nome" value={form.name || "—"} />
                            <SummaryRow label="Slug" value={form.slug || slugify(form.name) || "—"} />
                            <SummaryRow label="Status" value={form.status === "active" ? "Ativa" : "Inativa"} />
                            <SummaryRow label="Destaque" value={form.featured ? "Sim" : "Não"} />
                            <SummaryRow label="Ordem" value={String(form.sort_order || 0)} />
                        </div>
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Eye className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
                                <span className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground">Como ficará no site</span>
                            </div>
                            <CollectionPreview form={form} />
                        </div>
                        {error && <p className="text-[11px] text-destructive text-center">{error}</p>}
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <AdminWizard
            title={`${item.id ? "Editar" : "Nova"} coleção`}
            subtitle="Organize suas coleções"
            icon={Layers}
            steps={WIZARD_STEPS}
            validateStep={validateStep}
            onSave={save}
            onClose={onClose}
            saveLabel="Salvar coleção"
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
