import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Plus, Pencil, Copy, Archive, Trash2, Eye, Search } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { formatBRL, totalStock } from "@/data/products";
import AdminConfirmDialog from "@/components/admin/AdminConfirmDialog";
import { logAdminAction } from "@/lib/audit";

const STATUS = {
    draft: { label: "Rascunho", color: "text-muted-foreground bg-[hsl(var(--bone))]" },
    published: { label: "Publicado", color: "text-[hsl(var(--gold))] bg-[hsl(var(--gold))]/10" },
    archived: { label: "Arquivado", color: "text-muted-foreground bg-muted" },
};

export default function AdminProducts() {
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState("all");
    const [q, setQ] = useState("");

    const load = () => {
        setLoading(true);
        base44.entities.Product.list("-created_date", 200)
            .then(setProducts)
            .catch(() => { })
            .finally(() => setLoading(false));
    };

    useEffect(() => { load(); }, []);

    const filtered = products.filter((p) => {
        if (filter !== "all" && p.status !== filter) return false;
        if (q && !p.name.toLowerCase().includes(q.toLowerCase()) && !(p.sku || "").toLowerCase().includes(q.toLowerCase())) return false;
        return true;
    });

    const duplicate = async (p) => {
        const { id, created_date, updated_date, created_by_id, ...data } = p;
        const newProduct = await base44.entities.Product.create({ ...data, name: `${p.name} (cópia)`, sku: "", status: "draft" });
        await logAdminAction("product_create", "Product", newProduct.id, `${p.name} (cópia)`, `Produto duplicado de "${p.name}"`);
        load();
    };

    const archive = async (p) => {
        await base44.entities.Product.update(p.id, { status: "archived" });
        await logAdminAction("product_archive", "Product", p.id, p.name, "Produto arquivado", { status: p.status }, { status: "archived" });
        load();
    };

    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState("");

    const confirmDelete = async () => {
        setDeleting(true);
        setDeleteError("");
        try {
            await base44.entities.Product.delete(deleteTarget.id);
            await logAdminAction("product_delete", "Product", deleteTarget.id, deleteTarget.name, "Produto excluído");
            setDeleteTarget(null);
            load();
        } catch {
            setDeleteError("Não foi possível excluir — este produto pode ter pedidos vinculados. Considere arquivar.");
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div>
            <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
                <h1 className="font-heading text-2xl tracking-[0.03em]">Produtos</h1>
                <Link to="/admin/produtos/novo" className="btn-gold">
                    <Plus className="w-4 h-4" strokeWidth={1.5} /> Novo produto
                </Link>
            </div>

            <div className="flex items-center gap-3 mb-5 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou SKU..." className="w-full border border-border bg-background pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-[hsl(var(--gold))]" />
                </div>
                <select value={filter} onChange={(e) => setFilter(e.target.value)} className="border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:border-[hsl(var(--gold))]" >
                    <option value="all">Todos</option>
                    <option value="published">Publicados</option>
                    <option value="draft">Rascunhos</option>
                    <option value="archived">Arquivados</option>
                </select>
            </div>

            {loading ? (
                <div className="h-64 bg-background animate-pulse" />
            ) : filtered.length === 0 ? (
                <div className="bg-background p-12 text-center">
                    <p className="text-sm text-muted-foreground">Nenhum produto encontrado.</p>
                </div>
            ) : (
                <div className="bg-background overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                <th className="py-3 px-3">Foto</th>
                                <th className="py-3 px-3">Nome</th>
                                <th className="py-3 px-3 hidden md:table-cell">SKU</th>
                                <th className="py-3 px-3 hidden lg:table-cell">Categoria</th>
                                <th className="py-3 px-3">Preço</th>
                                <th className="py-3 px-3 hidden sm:table-cell">Estoque</th>
                                <th className="py-3 px-3">Status</th>
                                <th className="py-3 px-3 text-right">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {filtered.map((p) => (
                                <tr key={p.id} className="hover:bg-[hsl(var(--bone))]/50 transition-colors">
                                    <td className="py-2 px-3">
                                        <img src={p.images?.[0]} alt="" className="w-10 h-12 object-cover bg-bone" />
                                    </td>
                                    <td className="py-2 px-3">
                                        <Link to={`/admin/produtos/${p.id}`} className="font-medium hover:text-[hsl(var(--rose))]">{p.name}</Link>
                                        <p className="text-[11px] text-muted-foreground md:hidden font-numeric">{p.sku}</p>
                                    </td>
                                    <td className="py-2 px-3 hidden md:table-cell text-muted-foreground font-numeric">{p.sku || "—"}</td>
                                    <td className="py-2 px-3 hidden lg:table-cell text-muted-foreground">{p.category || "—"}</td>
                                    <td className="py-2 px-3 font-numeric">{formatBRL(p.sale_price || p.price)}</td>
                                    <td className="py-2 px-3 hidden sm:table-cell font-numeric">{totalStock(p)}</td>
                                    <td className="py-2 px-3">
                                        <span className={`text-[10px] uppercase tracking-[0.12em] px-2 py-1 ${STATUS[p.status]?.color || ""}`}>{STATUS[p.status]?.label || p.status}</span>
                                    </td>
                                    <td className="py-2 px-3">
                                        <div className="flex items-center justify-end gap-1">
                                            <Link to={`/produto/${p.id}`} className="p-1.5 hover:bg-[hsl(var(--bone))] rounded" title="Visualizar"><Eye className="w-4 h-4" strokeWidth={1.25} /></Link>
                                            <Link to={`/admin/produtos/${p.id}`} className="p-1.5 hover:bg-[hsl(var(--bone))] rounded" title="Editar"><Pencil className="w-4 h-4" strokeWidth={1.25} /></Link>
                                            <button onClick={() => duplicate(p)} className="p-1.5 hover:bg-[hsl(var(--bone))] rounded" title="Duplicar"><Copy className="w-4 h-4" strokeWidth={1.25} /></button>
                                            {p.status !== "archived" ? (
                                                <button onClick={() => archive(p)} className="p-1.5 hover:bg-[hsl(var(--bone))] rounded" title="Arquivar"><Archive className="w-4 h-4" strokeWidth={1.25} /></button>
                                            ) : null}
                                            <button onClick={() => { setDeleteTarget(p); setDeleteError(""); }} className="p-1.5 hover:bg-[hsl(var(--bone))] rounded text-[hsl(var(--rose))]" title="Excluir"><Trash2 className="w-4 h-4" strokeWidth={1.25} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <AdminConfirmDialog
                open={!!deleteTarget}
                onClose={() => { setDeleteTarget(null); setDeleteError(""); }}
                onConfirm={confirmDelete}
                title="Excluir produto"
                message={deleteError || "Você está prestes a excluir:"}
                itemName={deleteTarget?.name}
                confirmLabel="Excluir"
                requireTyping
                loading={deleting}
            />
        </div>
    );
}