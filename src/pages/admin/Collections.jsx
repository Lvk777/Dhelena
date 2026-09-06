import React, { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, Layers, Star, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import AdminConfirmDialog from "@/components/admin/AdminConfirmDialog";
import CollectionForm from "@/components/admin/collections/CollectionForm";
import { logAdminAction } from "@/lib/audit";

export default function Collections() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleting, setDeleting] = useState(false);

    const load = () => {
        setLoading(true);
        base44.entities.Collection.list("sort_order", 100).then(setItems).catch(() => { }).finally(() => setLoading(false));
    };
    useEffect(() => { load(); }, []);

    const confirmDelete = async () => {
        setDeleting(true);
        try {
            await base44.entities.Collection.delete(deleteTarget.id);
            await logAdminAction("collection_delete", "Collection", deleteTarget.id, deleteTarget.name, "Coleção excluída");
            setDeleteTarget(null);
            load();
        } catch {
            // keep dialog open on error
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="font-heading text-2xl tracking-[0.03em]">Coleções</h1>
                <button onClick={() => setEditing({})} className="btn-gold"><Plus className="w-4 h-4" strokeWidth={1.5} /> Nova coleção</button>
            </div>

            {loading ? (
                <div className="h-40 bg-background animate-pulse rounded-lg" />
            ) : items.length === 0 ? (
                <div className="bg-background p-12 text-center rounded-lg border border-border">
                    <Layers className="w-10 h-10 text-muted-foreground/40 mx-auto mb-4" strokeWidth={1} />
                    <p className="text-sm text-muted-foreground">Nenhuma coleção cadastrada.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {items.map((c) => (
                        <div key={c.id} className="bg-background rounded-lg border border-border overflow-hidden">
                            {c.image ? (
                                <img src={c.image} alt="" className="w-full aspect-[3/4] object-cover bg-bone" />
                            ) : (
                                <div className="w-full aspect-[3/4] bg-bone flex items-center justify-center">
                                    <Layers className="w-8 h-8 text-muted-foreground/30" strokeWidth={1} />
                                </div>
                            )}
                            <div className="p-4">
                                <div className="flex items-center gap-2 mb-1">
                                    <p className="text-sm font-medium truncate flex-1">{c.name}</p>
                                    {c.featured && <Star className="w-3.5 h-3.5 text-accent fill-accent shrink-0" strokeWidth={0} />}
                                </div>
                                {c.description && <p className="text-[11px] text-muted-foreground line-clamp-2 mb-2">{c.description}</p>}
                                <div className="flex items-center gap-2 mb-3">
                                    <span className={`text-[9px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded ${c.status === "active" ? "bg-accent/10 text-accent" : "bg-muted text-muted-foreground"}`}>
                                        {c.status === "active" ? "Ativa" : "Inativa"}
                                    </span>
                                    {c.start_date && <span className="text-[10px] text-muted-foreground font-numeric">Início: {new Date(c.start_date).toLocaleDateString("pt-BR")}</span>}
                                </div>
                                <div className="flex gap-1">
                                    <button onClick={() => setEditing(c)} className="p-1.5 hover:bg-muted rounded transition-colors"><Pencil className="w-4 h-4" strokeWidth={1.25} /></button>
                                    <button onClick={() => setDeleteTarget(c)} className="p-1.5 hover:bg-muted rounded transition-colors text-rose"><Trash2 className="w-4 h-4" strokeWidth={1.25} /></button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {editing && <CollectionForm item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}

            <AdminConfirmDialog
                open={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={confirmDelete}
                title="Excluir coleção"
                message="Você está prestes a excluir:"
                itemName={deleteTarget?.name}
                confirmLabel="Excluir"
                requireTyping
                loading={deleting}
            />
        </div>
    );
}