import React, { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, FolderTree, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import AdminModal from "@/components/admin/AdminModal";
import AdminInput from "@/components/admin/AdminInput";
import AdminTextarea from "@/components/admin/AdminTextarea";
import AdminImageUploader from "@/components/admin/AdminImageUploader";
import AdminToggle from "@/components/admin/AdminToggle";
import AdminFormSection from "@/components/admin/AdminFormSection";
import AdminConfirmDialog from "@/components/admin/AdminConfirmDialog";
import { logAdminAction } from "@/lib/audit";

const slugify = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default function Categories() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleting, setDeleting] = useState(false);

    const load = () => {
        setLoading(true);
        base44.entities.Category.list("sort_order", 100).then(setItems).catch(() => { }).finally(() => setLoading(false));
    };
    useEffect(() => { load(); }, []);

    const confirmDelete = async () => {
        setDeleting(true);
        try {
            await base44.entities.Category.delete(deleteTarget.id);
            await logAdminAction("category_delete", "Category", deleteTarget.id, deleteTarget.name, "Categoria excluída");
            setDeleteTarget(null); load();
        }
        catch { } finally { setDeleting(false); }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="font-heading text-2xl tracking-[0.03em]">Categorias</h1>
                <button onClick={() => setEditing({})} className="btn-gold"><Plus className="w-4 h-4" strokeWidth={1.5} /> Nova categoria</button>
            </div>

            {loading ? <div className="h-40 bg-background animate-pulse rounded-lg" /> : items.length === 0 ? (
                <div className="bg-background p-12 text-center rounded-lg border border-border">
                    <FolderTree className="w-10 h-10 text-muted-foreground/40 mx-auto mb-4" strokeWidth={1} />
                    <p className="text-sm text-muted-foreground">Nenhuma categoria cadastrada.</p>
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {items.map((c) => (
                        <div key={c.id} className="bg-background rounded-lg border border-border overflow-hidden">
                            {c.image ? <img src={c.image} alt="" className="w-full aspect-[3/4] object-cover bg-bone" /> : <div className="w-full aspect-[3/4] bg-bone flex items-center justify-center"><FolderTree className="w-8 h-8 text-muted-foreground/30" strokeWidth={1} /></div>}
                            <div className="p-3">
                                <div className="flex items-center gap-2">
                                    <p className="text-sm font-medium truncate">{c.name}</p>
                                    {c.status === "inactive" && <span className="text-[9px] uppercase tracking-[0.12em] px-1.5 py-0.5 bg-muted text-muted-foreground rounded">Inativa</span>}
                                </div>
                                <p className="text-[11px] text-muted-foreground truncate">/{c.slug}</p>
                                <div className="flex gap-1 mt-2">
                                    <button onClick={() => setEditing(c)} className="p-1.5 hover:bg-muted rounded transition-colors"><Pencil className="w-4 h-4" strokeWidth={1.25} /></button>
                                    <button onClick={() => setDeleteTarget(c)} className="p-1.5 hover:bg-muted rounded transition-colors text-rose"><Trash2 className="w-4 h-4" strokeWidth={1.25} /></button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {editing && <CategoryForm item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}

            <AdminConfirmDialog
                open={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={confirmDelete}
                title="Excluir categoria"
                message="Você está prestes a excluir:"
                itemName={deleteTarget?.name}
                confirmLabel="Excluir"
                loading={deleting}
            />
        </div>
    );
}

function CategoryForm({ item, onClose, onSaved }) {
    const [form, setForm] = useState({
        name: item.name || "", slug: item.slug || "", image: item.image || "",
        description: item.description || "", status: item.status || "active", sort_order: item.sort_order || 0,
    });
    const [slugEdited, setSlugEdited] = useState(!!item.slug);
    const [saving, setSaving] = useState(false);
    const [errors, setErrors] = useState({});
    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

    const onNameChange = (v) => {
        set("name", v);
        if (!slugEdited) set("slug", slugify(v));
    };
    const onSlugChange = (v) => { set("slug", slugify(v)); setSlugEdited(true); };

    const save = async () => {
        const e = {};
        if (!form.name.trim()) e.name = "Informe o nome da categoria";
        setErrors(e);
        if (Object.keys(e).length) return;
        setSaving(true);
        const slug = form.slug || slugify(form.name);
        try {
            if (item.id) {
                await base44.entities.Category.update(item.id, { ...form, slug });
                await logAdminAction("category_update", "Category", item.id, form.name, "Categoria atualizada");
            } else {
                const newCat = await base44.entities.Category.create({ ...form, slug });
                await logAdminAction("category_create", "Category", newCat.id, form.name, "Categoria criada");
            }
            onSaved();
        } catch { console.error("Erro ao salvar categoria"); } finally { setSaving(false); }
    };

    return (
        <AdminModal
            open
            onClose={onClose}
            title={`${item.id ? "Editar" : "Nova"} categoria`}
            subtitle="Organize seus produtos em categorias para facilitar a navegação"
            size="md"
            icon={FolderTree}
            footer={
                <>
                    <button onClick={onClose} className="btn-ghost">Cancelar</button>
                    <button onClick={save} disabled={saving} className="btn-gold">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar categoria"}</button>
                </>
            }
        >
            <div className="space-y-5">
                <AdminFormSection>
                    <AdminInput label="Nome" value={form.name} onChange={onNameChange} required error={errors.name} placeholder="Ex: Vestidos Longos" />
                    <AdminInput label="Slug (URL)" value={form.slug} onChange={onSlugChange} description="Gerado automaticamente a partir do nome" placeholder="auto" mono />
                </AdminFormSection>
                <AdminFormSection title="Imagem" description="Imagem de destaque da categoria (proporção 3:4)">
                    <AdminImageUploader label="Imagem da categoria" preset="category_image" value={form.image} onChange={(v) => set("image", v)} full />
                </AdminFormSection>
                <AdminFormSection title="Detalhes">
                    <AdminTextarea label="Descrição" value={form.description} onChange={(v) => set("description", v)} rows={2} placeholder="Descrição opcional da categoria" full />
                    <AdminInput label="Ordem de exibição" type="number" value={form.sort_order} onChange={(v) => set("sort_order", parseInt(v) || 0)} description="Menor número aparece primeiro" />
                    <div className="py-2">
                        <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Status</label>
                        <div className="flex gap-2">
                            <button onClick={() => set("status", "active")} className={`flex-1 py-3 text-sm border rounded-lg transition-colors ${form.status === "active" ? "border-accent bg-accent/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>Ativa</button>
                            <button onClick={() => set("status", "inactive")} className={`flex-1 py-3 text-sm border rounded-lg transition-colors ${form.status === "inactive" ? "border-accent bg-accent/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>Inativa</button>
                        </div>
                    </div>
                </AdminFormSection>
            </div>
        </AdminModal>
    );
}