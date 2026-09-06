import React, { useState } from "react";
import { Layers, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import AdminModal from "@/components/admin/AdminModal";
import AdminInput from "@/components/admin/AdminInput";
import AdminTextarea from "@/components/admin/AdminTextarea";
import AdminUpload from "@/components/admin/AdminUpload";
import AdminToggle from "@/components/admin/AdminToggle";
import AdminFormSection from "@/components/admin/AdminFormSection";
import { logAdminAction } from "@/lib/audit";

const slugify = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

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

    return (
        <AdminModal
            open
            onClose={onClose}
            title={`${item.id ? "Editar" : "Nova"} coleção`}
            subtitle="Organize suas coleções para destacar na loja"
            size="lg"
            icon={Layers}
            footer={
                <>
                    <button onClick={onClose} className="btn-ghost">Cancelar</button>
                    <button onClick={save} disabled={saving} className="btn-gold">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar coleção"}
                    </button>
                </>
            }
        >
            <div className="space-y-5">
                <AdminFormSection title="Informações básicas">
                    <AdminInput label="Nome da coleção" value={form.name} onChange={onNameChange} required placeholder="Ex: Primavera 2027" />
                    <AdminInput label="Slug (URL)" value={form.slug} onChange={(v) => { set("slug", slugify(v)); setSlugEdited(true); }} description="Gerado automaticamente a partir do nome" placeholder="auto" mono />
                    <AdminTextarea label="Descrição" value={form.description} onChange={(v) => set("description", v)} rows={2} full placeholder="Descrição exibida na página da coleção" />
                </AdminFormSection>

                <AdminFormSection title="Imagens" description="Imagem de capa (proporção 3:4) e banner opcional (16:9)">
                    <AdminUpload label="Imagem de capa" value={form.image} onChange={(v) => set("image", v)} aspect="3/4" full />
                    <AdminUpload label="Banner opcional" value={form.banner_image} onChange={(v) => set("banner_image", v)} aspect="16/9" full />
                </AdminFormSection>

                <AdminFormSection title="Configurações">
                    <AdminInput label="Ordem de exibição" type="number" value={form.sort_order} onChange={(v) => set("sort_order", parseInt(v) || 0)} description="Menor número aparece primeiro" />
                    <AdminInput label="Data de início (opcional)" type="date" value={form.start_date} onChange={(v) => set("start_date", v)} />
                    <AdminInput label="Data de término (opcional)" type="date" value={form.end_date} onChange={(v) => set("end_date", v)} />
                    <div />
                </AdminFormSection>

                <AdminFormSection title="Status e destaque">
                    <div className="sm:col-span-2 space-y-1">
                        <div>
                            <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Status</label>
                            <div className="flex gap-2">
                                <button onClick={() => set("status", "active")} className={`flex-1 py-3 text-sm border rounded-lg transition-colors ${form.status === "active" ? "border-accent bg-accent/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>Ativa</button>
                                <button onClick={() => set("status", "inactive")} className={`flex-1 py-3 text-sm border rounded-lg transition-colors ${form.status === "inactive" ? "border-accent bg-accent/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>Inativa</button>
                            </div>
                        </div>
                        <AdminToggle label="Destaque na Home" checked={form.featured} onChange={(v) => set("featured", v)} description="Exibe a coleção em destaque na página inicial" />
                    </div>
                </AdminFormSection>

                {error && <p className="text-[11px] text-destructive text-center">{error}</p>}
            </div>
        </AdminModal>
    );
}