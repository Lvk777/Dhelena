import React, { useState, useEffect, useMemo } from "react";
import { ShieldCheck, Search, Filter, Eye, ChevronLeft, ChevronRight } from "lucide-react";
import { base44 } from "@/api/base44Client";
import AdminModal from "@/components/admin/AdminModal";

const PAGE_SIZE = 25;

const ACTION_LABELS = {
    login_admin: "Login admin",
    login_failed: "Login falhou",
    product_create: "Produto criado",
    product_update: "Produto editado",
    product_delete: "Produto excluído",
    product_archive: "Produto arquivado",
    stock_adjust: "Ajuste de estoque",
    order_status_update: "Status do pedido",
    order_tracking_update: "Rastreamento",
    order_cancel: "Pedido cancelado",
    settings_update: "Configurações",
    coupon_create: "Cupom criado",
    coupon_update: "Cupom editado",
    coupon_delete: "Cupom excluído",
    category_create: "Categoria criada",
    category_update: "Categoria editada",
    category_delete: "Categoria excluída",
    collection_create: "Coleção criada",
    collection_update: "Coleção editada",
    collection_delete: "Coleção excluída",
    banner_update: "Banner alterado",
    role_change: "Role alterado",
};

export default function AuditLog() {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(0);
    const [total, setTotal] = useState(0);
    const [filters, setFilters] = useState({ action: "", entity_type: "", admin_email: "", search: "", date_from: "", date_to: "" });
    const [detail, setDetail] = useState(null);

    const load = async () => {
        setLoading(true);
        try {
            const allLogs = await base44.entities.AuditLog.list("-created_date", 500);
            let filtered = allLogs || [];

            if (filters.action) filtered = filtered.filter((l) => l.action === filters.action);
            if (filters.entity_type) filtered = filtered.filter((l) => l.entity_type === filters.entity_type);
            if (filters.admin_email) filtered = filtered.filter((l) => (l.admin_email || "").toLowerCase().includes(filters.admin_email.toLowerCase()));
            if (filters.search) {
                const q = filters.search.toLowerCase();
                filtered = filtered.filter((l) =>
                    (l.entity_name || "").toLowerCase().includes(q) ||
                    (l.entity_id || "").toLowerCase().includes(q) ||
                    (l.details || "").toLowerCase().includes(q)
                );
            }
            if (filters.date_from) {
                const from = new Date(filters.date_from);
                filtered = filtered.filter((l) => new Date(l.created_date) >= from);
            }
            if (filters.date_to) {
                const to = new Date(filters.date_to);
                to.setHours(23, 59, 59);
                filtered = filtered.filter((l) => new Date(l.created_date) <= to);
            }

            setTotal(filtered.length);
            const start = page * PAGE_SIZE;
            setLogs(filtered.slice(start, start + PAGE_SIZE));
        } catch {
            setLogs([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, [page]);
    useEffect(() => { setPage(0); load(); }, [filters]);

    const totalPages = Math.ceil(total / PAGE_SIZE);
    const uniqueActions = useMemo(() => [...new Set(Object.keys(ACTION_LABELS))], []);
    const uniqueEntities = useMemo(() => [...new Set(["Product", "Order", "Coupon", "Category", "Collection", "Banner", "Setting", "User"])], []);

    return (
        <div>
            <div className="flex items-center gap-3 mb-6">
                <ShieldCheck className="w-6 h-6 text-[hsl(var(--gold))]" strokeWidth={1.5} />
                <h1 className="font-heading text-2xl tracking-[0.03em]">Central de Auditoria</h1>
            </div>

            {/* Filtros */}
            <div className="bg-background rounded-lg border border-border p-4 mb-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                        <label className="block text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-1">Ação</label>
                        <select value={filters.action} onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))} className="admin-field text-sm">
                            <option value="">Todas</option>
                            {uniqueActions.map((a) => <option key={a} value={a}>{ACTION_LABELS[a] || a}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-1">Entidade</label>
                        <select value={filters.entity_type} onChange={(e) => setFilters((f) => ({ ...f, entity_type: e.target.value }))} className="admin-field text-sm">
                            <option value="">Todas</option>
                            {uniqueEntities.map((e) => <option key={e} value={e}>{e}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-1">Administrador</label>
                        <input value={filters.admin_email} onChange={(e) => setFilters((f) => ({ ...f, admin_email: e.target.value }))} placeholder="E-mail" className="admin-field text-sm" />
                    </div>
                    <div>
                        <label className="block text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-1">Busca</label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <input value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} placeholder="Registro, detalhe..." className="admin-field text-sm pl-10" />
                        </div>
                    </div>
                    <div>
                        <label className="block text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-1">De</label>
                        <input type="date" value={filters.date_from} onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value }))} className="admin-field text-sm" />
                    </div>
                    <div>
                        <label className="block text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-1">Até</label>
                        <input type="date" value={filters.date_to} onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value }))} className="admin-field text-sm" />
                    </div>
                    <div className="flex items-end">
                        <button onClick={() => setFilters({ action: "", entity_type: "", admin_email: "", search: "", date_from: "", date_to: "" })} className="btn-ghost text-sm">
                            <Filter className="w-4 h-4" strokeWidth={1.5} /> Limpar filtros
                        </button>
                    </div>
                </div>
            </div>

            {/* Contador */}
            <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] text-muted-foreground font-numeric">{total} registro(s) · página {page + 1} de {totalPages || 1}</p>
            </div>

            {/* Tabela */}
            {loading ? (
                <div className="h-64 bg-background animate-pulse rounded-lg" />
            ) : logs.length === 0 ? (
                <div className="bg-background p-12 text-center rounded-lg border border-border">
                    <ShieldCheck className="w-10 h-10 text-muted-foreground/40 mx-auto mb-4" strokeWidth={1} />
                    <p className="text-sm text-muted-foreground">Nenhum registro de auditoria encontrado.</p>
                </div>
            ) : (
                <div className="bg-background rounded-lg border border-border overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                                <th className="py-3 px-4">Data/Hora</th>
                                <th className="py-3 px-4 hidden md:table-cell">Administrador</th>
                                <th className="py-3 px-4">Ação</th>
                                <th className="py-3 px-4 hidden lg:table-cell">Entidade</th>
                                <th className="py-3 px-4">Registro</th>
                                <th className="py-3 px-4 hidden xl:table-cell">Resumo</th>
                                <th className="py-3 px-4 text-right"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {logs.map((log) => (
                                <tr key={log.id} className="hover:bg-[hsl(var(--bone))]/50 transition-colors">
                                    <td className="py-2.5 px-4 text-muted-foreground font-numeric text-xs whitespace-nowrap">{new Date(log.created_date).toLocaleString("pt-BR")}</td>
                                    <td className="py-2.5 px-4 hidden md:table-cell text-muted-foreground text-xs truncate max-w-[160px]">{log.admin_email || "—"}</td>
                                    <td className="py-2.5 px-4"><span className="text-[10px] uppercase tracking-[0.1em] px-2 py-1 rounded bg-[hsl(var(--gold))]/10 text-[hsl(var(--gold))]">{ACTION_LABELS[log.action] || log.action}</span></td>
                                    <td className="py-2.5 px-4 hidden lg:table-cell text-muted-foreground text-xs">{log.entity_type || "—"}</td>
                                    <td className="py-2.5 px-4 font-medium truncate max-w-[180px]">{log.entity_name || "—"}</td>
                                    <td className="py-2.5 px-4 hidden xl:table-cell text-muted-foreground text-xs truncate max-w-[240px]">{log.details || "—"}</td>
                                    <td className="py-2.5 px-4 text-right">
                                        <button onClick={() => setDetail(log)} className="p-1.5 hover:bg-[hsl(var(--bone))] rounded" title="Ver detalhes">
                                            <Eye className="w-4 h-4 text-muted-foreground" strokeWidth={1.25} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Paginação */}
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-4">
                    <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="p-2 hover:bg-[hsl(var(--bone))] rounded disabled:opacity-30">
                        <ChevronLeft className="w-4 h-4" strokeWidth={1.5} />
                    </button>
                    <span className="text-sm text-muted-foreground font-numeric">{page + 1} / {totalPages}</span>
                    <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} className="p-2 hover:bg-[hsl(var(--bone))] rounded disabled:opacity-30">
                        <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
                    </button>
                </div>
            )}

            {/* Modal de detalhes */}
            {detail && (
                <AdminModal
                    open
                    onClose={() => setDetail(null)}
                    title={ACTION_LABELS[detail.action] || detail.action}
                    subtitle={detail.entity_name || detail.entity_type || ""}
                    size="lg"
                    icon={ShieldCheck}
                    footer={<button onClick={() => setDetail(null)} className="btn-ghost">Fechar</button>}
                >
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <Detail label="Data/Hora" value={new Date(detail.created_date).toLocaleString("pt-BR")} />
                            <Detail label="Administrador" value={detail.admin_email || "—"} />
                            <Detail label="Entidade" value={detail.entity_type || "—"} />
                            <Detail label="ID do registro" value={detail.entity_id || "—"} mono />
                            <Detail label="Ação" value={detail.action} />
                            <Detail label="Registro" value={detail.entity_name || "—"} />
                        </div>
                        {detail.details && (
                            <div>
                                <label className="block text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-1.5">Resumo</label>
                                <p className="text-sm bg-[hsl(var(--bone))] p-3 rounded">{detail.details}</p>
                            </div>
                        )}
                        {detail.before && (
                            <div>
                                <label className="block text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-1.5">Antes</label>
                                <pre className="text-xs bg-[hsl(var(--bone))] p-3 rounded overflow-x-auto max-h-48 font-mono">{JSON.stringify(detail.before, null, 2)}</pre>
                            </div>
                        )}
                        {detail.after && (
                            <div>
                                <label className="block text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-1.5">Depois</label>
                                <pre className="text-xs bg-[hsl(var(--bone))] p-3 rounded overflow-x-auto max-h-48 font-mono">{JSON.stringify(detail.after, null, 2)}</pre>
                            </div>
                        )}
                        <p className="text-[10px] text-muted-foreground">Dados sensíveis (senhas, tokens, chaves) são automaticamente mascarados como [REDACTED].</p>
                    </div>
                </AdminModal>
            )}
        </div>
    );
}

function Detail({ label, value, mono }) {
    return (
        <div>
            <label className="block text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-1">{label}</label>
            <p className={`text-sm ${mono ? "font-mono" : ""}`}>{value}</p>
        </div>
    );
}