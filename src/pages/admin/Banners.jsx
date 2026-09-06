import React, { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, Image, Loader2, Eye } from "lucide-react";
import { base44 } from "@/api/base44Client";
import AdminModal from "@/components/admin/AdminModal";
import AdminInput from "@/components/admin/AdminInput";
import AdminTextarea from "@/components/admin/AdminTextarea";
import AdminUpload from "@/components/admin/AdminUpload";
import AdminToggle from "@/components/admin/AdminToggle";
import AdminFormSection from "@/components/admin/AdminFormSection";
import AdminConfirmDialog from "@/components/admin/AdminConfirmDialog";
import { logAdminAction } from "@/lib/audit";

export default function Banners() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleting, setDeleting] = useState(false);

    const load = () => { setLoading(true); base44.entities.Banner.list("sort_order", 50).then(setItems).catch(() => { }).finally(() => setLoading(false)); };
    useEffect(() => { load(); }, []);

    const confirmDelete = async () => {
        setDeleting(true);
        try {
            await base44.entities.Banner.delete(deleteTarget.id);
            await logAdminAction("banner_update", "Banner", deleteTarget.id, deleteTarget.title, "Banner excluído");
            setDeleteTarget(null); load();
        }
        catch { } finally { setDeleting(false); }
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
                            <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{b.title}</p><p className="text-[11px] text-muted-foreground truncate">{b.eyebrow || "—"}</p></div>
                            <span className={`text-[10px] uppercase tracking-[0.12em] px-2 py-1 rounded ${b.active ? "bg-accent/10 text-accent" : "bg-muted text-muted-foreground"}`}>{b.active ? "Ativo" : "Inativo"}</span>
                            <div className="flex gap-1"><button onClick={() => setEditing(b)} className="p-2 hover:bg-muted rounded transition-colors"><Pencil className="w-4 h-4" strokeWidth={1.25} /></button><button onClick={() => setDeleteTarget(b)} className="p-2 hover:bg-muted rounded transition-colors text-rose"><Trash2 className="w-4 h-4" strokeWidth={1.25} /></button></div>
                        </div>
                    ))}
                </div>
            )}
            {editing && <BannerForm item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}

            <AdminConfirmDialog
                open={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={confirmDelete}
                title="Excluir banner"
                message="Você está prestes a excluir:"
                itemName={deleteTarget?.title}
                confirmLabel="Excluir"
                loading={deleting}
            />
        </div>
    );
}

function BannerForm({ item, onClose, onSaved }) {
    const [form, setForm] = useState({
        title: item.title || "", image: item.image || "", eyebrow: item.eyebrow || "", subtitle: item.subtitle || "",
        text: item.text || "", primary_cta_label: item.primary_cta_label || "", primary_cta_link: item.primary_cta_link || "",
        secondary_cta_label: item.secondary_cta_label || "", secondary_cta_link: item.secondary_cta_link || "",
        active: item.active !== false, sort_order: item.sort_order || 0,
    });
    const [saving, setSaving] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

    const save = async () => {
        setSaving(true);
        try {
            if (item.id) {
                await base44.entities.Banner.update(item.id, form);
                await logAdminAction("banner_update", "Banner", item.id, form.title, "Banner atualizado");
            } else {
                const newBanner = await base44.entities.Banner.create(form);
                await logAdminAction("banner_update", "Banner", newBanner.id, form.title, "Banner criado");
            }
            onSaved();
        }
        catch { console.error("Erro ao salvar banner"); } finally { setSaving(false); }
    };

    return (
        <AdminModal
            open
            onClose={onClose}
            title={`${item.id ? "Editar" : "Novo"} banner`}
            subtitle="Crie banners de destaque para a página inicial da loja"
            size="xl"
            icon={Image}
            footer={
                <>
                    <button onClick={() => setShowPreview(!showPreview)} className="btn-ghost"><Eye className="w-4 h-4" strokeWidth={1.5} /> {showPreview ? "Ocultar preview" : "Preview"}</button>
                    <button onClick={onClose} className="btn-ghost">Cancelar</button>
                    <button onClick={save} disabled={saving} className="btn-gold">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar banner"}</button>
                </>
            }
        >
            <div className="space-y-5">
                {showPreview && (
                    <div className="rounded-xl overflow-hidden border border-border relative h-48 sm:h-64 bg-bone">
                        {form.image ? <img src={form.image} alt="" className="absolute inset-0 w-full h-full object-cover" /> : <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40 text-sm">Sem imagem</div>}
                        <div className="absolute inset-0 bg-gradient-to-t from-charcoal/70 to-transparent" />
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 text-bone">
                            {form.eyebrow && <p className="text-[10px] uppercase tracking-[0.3em] text-gold mb-2">{form.eyebrow}</p>}
                            {form.title && <h3 className="font-heading text-2xl sm:text-3xl tracking-wide">{form.title}</h3>}
                            {form.subtitle && <p className="font-heading text-lg italic mt-1 text-bone/90">{form.subtitle}</p>}
                            {form.text && <p className="text-sm mt-2 max-w-md text-bone/80">{form.text}</p>}
                            <div className="flex gap-3 mt-4">
                                {form.primary_cta_label && <span className="bg-accent text-white text-[10px] uppercase tracking-[0.2em] px-5 py-2.5">{form.primary_cta_label}</span>}
                                {form.secondary_cta_label && <span className="border border-bone/50 text-bone text-[10px] uppercase tracking-[0.2em] px-5 py-2.5">{form.secondary_cta_label}</span>}
                            </div>
                        </div>
                    </div>
                )}

                <AdminFormSection title="Conteúdo" icon={Image}>
                    <AdminInput label="Título" value={form.title} onChange={(v) => set("title", v)} required full placeholder="Título principal do banner" />
                    <AdminInput label="Sobretítulo" value={form.eyebrow} onChange={(v) => set("eyebrow", v)} placeholder="Texto acima do título" />
                    <AdminInput label="Subtítulo" value={form.subtitle} onChange={(v) => set("subtitle", v)} placeholder="Texto abaixo do título" />
                    <AdminTextarea label="Texto" value={form.text} onChange={(v) => set("text", v)} rows={2} full placeholder="Texto de apoio do banner" />
                </AdminFormSection>

                <AdminFormSection title="Imagem de fundo" description="Imagem de destaque do banner (proporção 16:9 recomendada)">
                    <AdminUpload label="Imagem" value={form.image} onChange={(v) => set("image", v)} aspect="16/9" full />
                </AdminFormSection>

                <AdminFormSection title="CTA principal">
                    <AdminInput label="Texto do botão" value={form.primary_cta_label} onChange={(v) => set("primary_cta_label", v)} placeholder="Ex: Ver coleção" />
                    <AdminInput label="Link do botão" value={form.primary_cta_link} onChange={(v) => set("primary_cta_link", v)} placeholder="/loja" />
                </AdminFormSection>

                <AdminFormSection title="CTA secundário">
                    <AdminInput label="Texto do botão" value={form.secondary_cta_label} onChange={(v) => set("secondary_cta_label", v)} placeholder="Ex: Sobre nós" />
                    <AdminInput label="Link do botão" value={form.secondary_cta_link} onChange={(v) => set("secondary_cta_link", v)} placeholder="/sobre" />
                </AdminFormSection>

                <AdminFormSection title="Configurações">
                    <AdminInput label="Ordem de exibição" type="number" value={form.sort_order} onChange={(v) => set("sort_order", parseInt(v) || 0)} />
                    <div className="py-2"><AdminToggle label="Banner ativo" checked={form.active} onChange={(v) => set("active", v)} description="Quando ativo, o banner aparece na loja" /></div>
                </AdminFormSection>
            </div>
        </AdminModal>
    );
}