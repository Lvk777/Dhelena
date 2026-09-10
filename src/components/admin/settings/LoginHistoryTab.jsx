import React, { useState, useEffect, useCallback } from "react";
import { Search, Filter, Archive, ShieldAlert, Loader2, X, ChevronDown } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { logAdminAction } from "@/lib/audit";

export default function LoginHistoryTab() {
    const [records, setRecords] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("");
    const [typeFilter, setTypeFilter] = useState("");
    const [period, setPeriod] = useState("30d");
    const [detailItem, setDetailItem] = useState(null);
    const [sessions, setSessions] = useState([]);
    const [sessionsLoading, setSessionsLoading] = useState(false);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (search) params.set("search", search);
            if (statusFilter) params.set("status", statusFilter);
            if (typeFilter) params.set("user_type", typeFilter);
            if (period) params.set("period", period);
            const res = await base44.custom.loginHistory(params.toString());
            setRecords(res || []);
        } catch (e) {
            console.error("Failed to load login history", e);
        } finally {
            setLoading(false);
        }
    }, [search, statusFilter, typeFilter, period]);

    const fetchSessions = useCallback(async () => {
        setSessionsLoading(true);
        try {
            const res = await base44.custom.activeSessions();
            setSessions(res || []);
        } catch (e) {
            console.error("Failed to load sessions", e);
        } finally {
            setSessionsLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);
    useEffect(() => { fetchSessions(); }, [fetchSessions]);

    const archive = async (id) => {
        try {
            await base44.custom.archiveLoginHistory(id);
            await logAdminAction("login_history_archived", "LoginHistory", id, "Login History", "Registro arquivado");
            fetchData();
        } catch (e) { console.error(e); }
    };

    const markSuspicious = async (id) => {
        try {
            await base44.custom.markLoginSuspicious(id);
            await logAdminAction("login_marked_suspicious", "LoginHistory", id, "Login History", "Marcado como suspeito");
            fetchData();
        } catch (e) { console.error(e); }
    };

    const revokeSession = async (sessionId) => {
        try {
            await base44.custom.revokeSession(sessionId);
            await logAdminAction("session_revoked", "Session", sessionId, "Session", "Sessão encerrada");
            fetchSessions();
        } catch (e) { console.error(e); }
    };

    const revokeOtherSessions = async (userId) => {
        try {
            await base44.custom.revokeUserSessions(userId);
            await logAdminAction("session_revoked", "Session", userId, "Session", "Sessões do usuário revogadas");
            fetchSessions();
        } catch (e) { console.error(e); }
    };

    const statusBadge = (status) => {
        const map = {
            success: "bg-accent/10 text-accent",
            failed: "bg-rose/10 text-rose",
            blocked: "bg-destructive/10 text-destructive",
        };
        return map[status] || "bg-muted text-muted-foreground";
    };

    const formatDate = (d) => {
        if (!d) return "—";
        const date = new Date(d);
        return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    };

    return (
        <div className="space-y-6">
            {/* Active Sessions */}
            <div className="bg-background border border-border rounded-lg overflow-hidden">
                <div className="px-5 py-4 border-b border-border">
                    <h3 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Sessões Ativas</h3>
                </div>
                {sessionsLoading ? (
                    <div className="p-5"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
                ) : sessions.length === 0 ? (
                    <p className="p-5 text-sm text-muted-foreground">Nenhuma sessão ativa.</p>
                ) : (
                    <div className="divide-y divide-border">
                        {sessions.map((s) => (
                            <div key={s.id} className="flex items-center gap-4 px-5 py-3">
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">{s.device_type} · {s.browser}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {[s.city, s.state, s.country].filter(Boolean).join(", ") || "Localização desconhecida"}
                                        {" · Última atividade: " + formatDate(s.last_activity)}
                                    </p>
                                </div>
                                <button onClick={() => revokeSession(s.id)} className="btn-ghost text-xs whitespace-nowrap">
                                    Encerrar
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Login History */}
            <div className="bg-background border border-border rounded-lg overflow-hidden">
                <div className="px-5 py-4 border-b border-border">
                    <h3 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-3">Histórico de Login</h3>
                    {/* Filters */}
                    <div className="flex flex-wrap gap-2">
                        <div className="relative flex-1 min-w-[200px]">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Buscar por e-mail..."
                                className="w-full pl-9 pr-3 py-2 text-xs bg-background border border-border rounded focus:outline-none focus:border-accent"
                            />
                        </div>
                        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                            className="px-3 py-2 text-xs bg-background border border-border rounded focus:outline-none focus:border-accent">
                            <option value="">Todos status</option>
                            <option value="success">Sucesso</option>
                            <option value="failed">Falha</option>
                            <option value="blocked">Bloqueado</option>
                        </select>
                        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
                            className="px-3 py-2 text-xs bg-background border border-border rounded focus:outline-none focus:border-accent">
                            <option value="">Todos tipos</option>
                            <option value="admin">Admin</option>
                            <option value="customer">Cliente</option>
                        </select>
                        <select value={period} onChange={(e) => setPeriod(e.target.value)}
                            className="px-3 py-2 text-xs bg-background border border-border rounded focus:outline-none focus:border-accent">
                            <option value="today">Hoje</option>
                            <option value="7d">7 dias</option>
                            <option value="30d">30 dias</option>
                            <option value="this_month">Este mês</option>
                        </select>
                    </div>
                </div>

                {loading ? (
                    <div className="p-5"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
                ) : records.length === 0 ? (
                    <p className="p-5 text-sm text-muted-foreground">Nenhum registro encontrado.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left border-b border-border text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                                    <th className="px-5 py-3 font-medium">Data/Hora</th>
                                    <th className="px-5 py-3 font-medium">E-mail</th>
                                    <th className="px-5 py-3 font-medium">Tipo</th>
                                    <th className="px-5 py-3 font-medium">Status</th>
                                    <th className="px-5 py-3 font-medium">IP</th>
                                    <th className="px-5 py-3 font-medium">Local</th>
                                    <th className="px-5 py-3 font-medium">Dispositivo</th>
                                    <th className="px-5 py-3 font-medium text-right">Ações</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {records.map((r) => (
                                    <tr key={r.id} className="hover:bg-[hsl(var(--bone))]/30 transition-colors">
                                        <td className="px-5 py-3 text-xs whitespace-nowrap">{formatDate(r.created_at)}</td>
                                        <td className="px-5 py-3 text-xs truncate max-w-[180px]">{r.email}</td>
                                        <td className="px-5 py-3">
                                            <span className={`text-[10px] uppercase px-2 py-0.5 rounded ${r.user_type === "admin" ? "bg-accent/10 text-accent" : "bg-muted text-muted-foreground"}`}>{r.user_type}</span>
                                        </td>
                                        <td className="px-5 py-3">
                                            <span className={`text-[10px] uppercase px-2 py-0.5 rounded ${statusBadge(r.status)}`}>{r.status}</span>
                                            {r.is_suspicious && <ShieldAlert className="inline w-3 h-3 text-destructive ml-1" />}
                                        </td>
                                        <td className="px-5 py-3 text-xs">{r.ip_address || "—"}</td>
                                        <td className="px-5 py-3 text-xs">{[r.city, r.state, r.country].filter(Boolean).join(", ") || "—"}</td>
                                        <td className="px-5 py-3 text-xs whitespace-nowrap">{r.device_type} · {r.browser}</td>
                                        <td className="px-5 py-3">
                                            <div className="flex justify-end gap-1">
                                                <button onClick={() => setDetailItem(r)} className="p-1.5 hover:bg-muted rounded transition-colors" title="Ver detalhes">
                                                    <Filter className="w-3.5 h-3.5" strokeWidth={1.25} />
                                                </button>
                                                <button onClick={() => archive(r.id)} className="p-1.5 hover:bg-muted rounded transition-colors" title="Arquivar">
                                                    <Archive className="w-3.5 h-3.5" strokeWidth={1.25} />
                                                </button>
                                                <button onClick={() => markSuspicious(r.id)} className="p-1.5 hover:bg-muted rounded transition-colors" title="Marcar suspeito">
                                                    <ShieldAlert className="w-3.5 h-3.5" strokeWidth={1.25} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Detail modal */}
            {detailItem && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-charcoal/50 backdrop-blur-sm" onClick={() => setDetailItem(null)}>
                    <div className="bg-background border border-border rounded-lg max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-heading text-lg">Detalhes do Login</h3>
                            <button onClick={() => setDetailItem(null)}><X className="w-4 h-4" /></button>
                        </div>
                        <dl className="space-y-2 text-sm">
                            {Object.entries(detailItem).filter(([k]) => k !== "user_agent").map(([k, v]) => (
                                <div key={k} className="flex justify-between gap-4">
                                    <dt className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}:</dt>
                                    <dd className="text-right">{String(v ?? "—")}</dd>
                                </div>
                            ))}
                        </dl>
                        {detailItem.user_agent && (
                            <div className="mt-3 pt-3 border-t border-border">
                                <p className="text-xs text-muted-foreground mb-1">User Agent:</p>
                                <p className="text-xs font-mono break-all text-muted-foreground">{detailItem.user_agent}</p>
                            </div>
                        )}
                        {detailItem.user_id && (
                            <button onClick={() => { revokeOtherSessions(detailItem.user_id); setDetailItem(null); }}
                                className="btn-ghost text-xs mt-4 w-full">
                                Revogar todas as sessões deste usuário
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
