import React, { useState, useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { Search, SlidersHorizontal, X, Copy, ChevronDown, ChevronLeft, ChevronRight, Eye, User, Package, Calendar, CreditCard, Truck, Check, AlertCircle, ShoppingCart } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { formatBRL, ORDER_STATUS, PAYMENT_LABELS, SHIPPING_LABELS } from "@/data/products";

const PAGE_SIZE = 20;
const normalize = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const STATUS_FILTERS = [
    { key: "all", label: "Todos" },
    { key: "recebido", label: "Pedido recebido" },
    { key: "pagamento_aprovado", label: "Pagamento aprovado" },
    { key: "em_separacao", label: "Em separação" },
    { key: "enviado", label: "Enviado" },
    { key: "em_transporte", label: "Em transporte" },
    { key: "saiu_entrega", label: "Saiu para entrega" },
    { key: "entregue", label: "Entregue" },
    { key: "cancelado", label: "Cancelado" },
];

const PAYMENT_FILTERS = [
    { key: "all", label: "Todos" },
    { key: "pix", label: "Pix" },
    { key: "credito", label: "Cartão de crédito" },
    { key: "debito", label: "Cartão de débito" },
];

const SHIPPING_FILTERS = [
    { key: "all", label: "Todas" },
    { key: "retirada", label: "Retirada" },
    { key: "entrega", label: "Entrega" },
];

const PERIOD_FILTERS = [
    { key: "all", label: "Todo período" },
    { key: "today", label: "Hoje" },
    { key: "yesterday", label: "Ontem" },
    { key: "7d", label: "Últimos 7 dias" },
    { key: "30d", label: "Últimos 30 dias" },
    { key: "month", label: "Este mês" },
    { key: "last_month", label: "Mês passado" },
    { key: "custom", label: "Personalizado" },
];

const SORT_OPTIONS = [
    { key: "recent", label: "Mais recentes" },
    { key: "old", label: "Mais antigos" },
    { key: "highValue", label: "Maior valor" },
    { key: "lowValue", label: "Menor valor" },
    { key: "customerAz", label: "Cliente A-Z" },
];

function getPeriodRange(period, dateFrom, dateTo) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    switch (period) {
        case "today": return { start: today, end: now };
        case "yesterday": { const y = new Date(today); y.setDate(y.getDate() - 1); return { start: y, end: new Date(today.getTime() - 1) }; }
        case "7d": { const s = new Date(today); s.setDate(s.getDate() - 7); return { start: s, end: now }; }
        case "30d": { const s = new Date(today); s.setDate(s.getDate() - 30); return { start: s, end: now }; }
        case "month": return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
        case "last_month": return { start: new Date(now.getFullYear(), now.getMonth() - 1, 1), end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59) };
        case "custom": return { start: dateFrom ? new Date(dateFrom) : null, end: dateTo ? new Date(dateTo + "T23:59:59") : null };
        default: return { start: null, end: null };
    }
}

export default function AdminOrders() {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [showFilters, setShowFilters] = useState(false);
    const [filters, setFilters] = useState({ status: "all", payment: "all", shipping: "all", period: "all", dateFrom: "", dateTo: "", minValue: "", maxValue: "" });
    const [sort, setSort] = useState("recent");
    const [page, setPage] = useState(1);
    const [hoveredCustomer, setHoveredCustomer] = useState(null);
    const [copiedId, setCopiedId] = useState(null);
    const filterRef = useRef(null);

    const load = () => {
        setLoading(true);
        base44.entities.Order.list("-created_date", 500)
            .then(setOrders)
            .catch(() => { })
            .finally(() => setLoading(false));
    };
    useEffect(() => { load(); }, []);

    // Debounce search
    useEffect(() => {
        const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 350);
        return () => clearTimeout(t);
    }, [search]);

    // Close filter panel on outside click
    useEffect(() => {
        const onClick = (e) => { if (filterRef.current && !filterRef.current.contains(e.target)) setShowFilters(false); };
        document.addEventListener("mousedown", onClick);
        return () => document.removeEventListener("mousedown", onClick);
    }, []);

    const filtered = useMemo(() => {
        let result = [...orders];

        // Search
        if (debouncedSearch.trim()) {
            const q = normalize(debouncedSearch);
            result = result.filter((o) =>
                normalize(o.order_number).includes(q) ||
                normalize(o.customer_name).includes(q) ||
                normalize(o.customer_email).includes(q) ||
                normalize(o.customer_cpf).includes(q) ||
                normalize(o.customer_phone).includes(q)
            );
        }

        // Status filter
        if (filters.status !== "all") result = result.filter((o) => o.status === filters.status);

        // Payment filter
        if (filters.payment !== "all") result = result.filter((o) => o.payment_method === filters.payment);

        // Shipping filter
        if (filters.shipping !== "all") {
            if (filters.shipping === "retirada") result = result.filter((o) => o.shipping_method === "retirada");
            else result = result.filter((o) => o.shipping_method !== "retirada");
        }

        // Period filter
        const range = getPeriodRange(filters.period, filters.dateFrom, filters.dateTo);
        if (range.start) result = result.filter((o) => new Date(o.created_date) >= range.start);
        if (range.end) result = result.filter((o) => new Date(o.created_date) <= range.end);

        // Value filter
        if (filters.minValue) result = result.filter((o) => o.total >= parseFloat(filters.minValue));
        if (filters.maxValue) result = result.filter((o) => o.total <= parseFloat(filters.maxValue));

        // Sort
        switch (sort) {
            case "recent": result.sort((a, b) => new Date(b.created_date) - new Date(a.created_date)); break;
            case "old": result.sort((a, b) => new Date(a.created_date) - new Date(b.created_date)); break;
            case "highValue": result.sort((a, b) => b.total - a.total); break;
            case "lowValue": result.sort((a, b) => a.total - b.total); break;
            case "customerAz": result.sort((a, b) => (a.customer_name || "").localeCompare(b.customer_name || "")); break;
        }

        return result;
    }, [orders, debouncedSearch, filters, sort]);

    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const activeFilterCount = Object.entries(filters).filter(([k, v]) => {
        if (k === "dateFrom" || k === "dateTo") return filters.period === "custom" && v;
        if (k === "minValue" || k === "maxValue") return v;
        return v !== "all";
    }).length;

    const clearFilters = () => {
        setFilters({ status: "all", payment: "all", shipping: "all", period: "all", dateFrom: "", dateTo: "", minValue: "", maxValue: "" });
        setPage(1);
    };

    const removeFilter = (key) => {
        setFilters((f) => ({ ...f, [key]: key === "dateFrom" || key === "dateTo" || key === "minValue" || key === "maxValue" ? "" : "all" }));
        setPage(1);
    };

    const copyOrderNumber = (e, num) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(num);
        setCopiedId(num);
        setTimeout(() => setCopiedId(null), 2000);
    };

    return (
        <div>
            <h1 className="font-heading text-2xl tracking-[0.03em] mb-6">Pedidos</h1>

            {/* Search bar */}
            <div className="relative mb-4">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" strokeWidth={1.5} />
                <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar pedido, cliente, CPF, telefone ou e-mail..."
                    className="admin-field pl-12 py-3.5 text-sm h-12"
                />
                {search && (
                    <button onClick={() => setSearch("")} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        <X className="w-4 h-4" strokeWidth={1.5} />
                    </button>
                )}
            </div>

            {/* Filters + Sort row */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
                <div className="relative" ref={filterRef}>
                    <button onClick={() => setShowFilters(!showFilters)} className={`flex items-center gap-2 px-4 py-2.5 text-sm border rounded-lg transition-colors ${showFilters || activeFilterCount > 0 ? "border-accent bg-accent/5 text-foreground" : "border-border text-foreground/70 hover:text-foreground"}`}>
                        <SlidersHorizontal className="w-4 h-4" strokeWidth={1.5} /> Filtros
                        {activeFilterCount > 0 && <span className="bg-accent text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center">{activeFilterCount}</span>}
                    </button>
                    {showFilters && (
                        <div className="absolute z-30 top-full left-0 mt-2 w-[480px] max-w-[90vw] bg-background border border-border rounded-xl shadow-2xl p-5 animate-fade-in">
                            <div className="grid grid-cols-2 gap-3">
                                <CompactSelect label="Status" value={filters.status} onChange={(v) => setFilters(s => ({ ...s, status: v }))} options={STATUS_FILTERS} />
                                <CompactSelect label="Pagamento" value={filters.payment} onChange={(v) => setFilters(s => ({ ...s, payment: v }))} options={PAYMENT_FILTERS} />
                                <CompactSelect label="Entrega" value={filters.shipping} onChange={(v) => setFilters(s => ({ ...s, shipping: v }))} options={SHIPPING_FILTERS} />
                                <CompactSelect label="Período" value={filters.period} onChange={(v) => setFilters(s => ({ ...s, period: v }))} options={PERIOD_FILTERS} />
                                <CompactInput label="Valor mínimo (R$)" type="number" value={filters.minValue} onChange={(v) => setFilters(s => ({ ...s, minValue: v }))} placeholder="0" />
                                <CompactInput label="Valor máximo (R$)" type="number" value={filters.maxValue} onChange={(v) => setFilters(s => ({ ...s, maxValue: v }))} placeholder="∞" />
                            </div>
                            {filters.period === "custom" && (
                                <div className="grid grid-cols-2 gap-3 mt-3">
                                    <input type="date" value={filters.dateFrom} onChange={(e) => setFilters(s => ({ ...s, dateFrom: e.target.value }))} className="admin-field py-2 text-xs" />
                                    <input type="date" value={filters.dateTo} onChange={(e) => setFilters(s => ({ ...s, dateTo: e.target.value }))} className="admin-field py-2 text-xs" />
                                </div>
                            )}
                            <div className="flex gap-2 mt-4 pt-4 border-t border-border">
                                <button onClick={clearFilters} className="btn-ghost flex-1 text-xs">Limpar</button>
                                <button onClick={() => setShowFilters(false)} className="btn-gold flex-1 text-xs">Aplicar filtros</button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Sort */}
                <div className="relative">
                    <select value={sort} onChange={(e) => setSort(e.target.value)} className="admin-field cursor-pointer py-2.5 pr-10 text-sm appearance-none">
                        {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" strokeWidth={1.5} />
                </div>

                <div className="ml-auto text-sm text-muted-foreground">
                    {loading ? "Carregando..." : `${filtered.length} ${filtered.length === 1 ? "pedido encontrado" : "pedidos encontrados"}`}
                </div>
            </div>

            {/* Active filter chips */}
            {activeFilterCount > 0 && (
                <div className="flex flex-wrap items-center gap-2 mb-4">
                    {filters.status !== "all" && <Chip label="Status" value={ORDER_STATUS[filters.status]?.label} onRemove={() => removeFilter("status")} />}
                    {filters.payment !== "all" && <Chip label="Pagamento" value={PAYMENT_LABELS[filters.payment] || filters.payment} onRemove={() => removeFilter("payment")} />}
                    {filters.shipping !== "all" && <Chip label="Entrega" value={SHIPPING_FILTERS.find(f => f.key === filters.shipping)?.label} onRemove={() => removeFilter("shipping")} />}
                    {filters.period !== "all" && <Chip label="Período" value={PERIOD_FILTERS.find(f => f.key === filters.period)?.label} onRemove={() => removeFilter("period")} />}
                    {filters.minValue && <Chip label="Valor mín." value={formatBRL(parseFloat(filters.minValue))} onRemove={() => removeFilter("minValue")} />}
                    {filters.maxValue && <Chip label="Valor máx." value={formatBRL(parseFloat(filters.maxValue))} onRemove={() => removeFilter("maxValue")} />}
                    <button onClick={clearFilters} className="text-[11px] uppercase tracking-[0.16em] text-rose hover:underline ml-1">Limpar tudo</button>
                </div>
            )}

            {/* Content */}
            {loading ? (
                <div className="h-64 bg-background animate-pulse rounded-lg" />
            ) : filtered.length === 0 ? (
                <div className="bg-background rounded-lg border border-border p-12 text-center">
                    <ShoppingCart className="w-10 h-10 text-muted-foreground/40 mx-auto mb-4" strokeWidth={1} />
                    <p className="text-sm text-muted-foreground mb-4">Nenhum pedido encontrado com esses filtros.</p>
                    {activeFilterCount > 0 && <button onClick={clearFilters} className="btn-outline">Limpar filtros</button>}
                </div>
            ) : (
                <>
                    {/* Desktop table */}
                    <div className="hidden md:block bg-background rounded-lg border border-border overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                    <th className="py-3 px-4">Pedido</th>
                                    <th className="py-3 px-4">Cliente</th>
                                    <th className="py-3 px-4">Data</th>
                                    <th className="py-3 px-4 text-center">Itens</th>
                                    <th className="py-3 px-4">Total</th>
                                    <th className="py-3 px-4">Pagamento</th>
                                    <th className="py-3 px-4">Entrega</th>
                                    <th className="py-3 px-4">Status</th>
                                    <th className="py-3 px-4 text-right">Ações</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {paginated.map((o) => (
                                    <tr key={o.id} className="hover:bg-muted/40 transition-colors">
                                        <td className="py-3 px-4">
                                            <Link to={`/admin/pedidos/${o.id}`} className="font-medium hover:text-accent transition-colors">{o.order_number}</Link>
                                        </td>
                                        <td className="py-3 px-4 relative">
                                            <div className="relative inline-block" onMouseEnter={() => setHoveredCustomer(o.id)} onMouseLeave={() => setHoveredCustomer(null)}>
                                                <span className="cursor-help hover:text-accent transition-colors">{o.customer_name}</span>
                                                {hoveredCustomer === o.id && (
                                                    <div className="absolute z-30 top-full left-0 mt-1 w-56 bg-background border border-border rounded-lg shadow-xl p-3 text-xs space-y-1">
                                                        <p className="font-medium text-sm">{o.customer_name}</p>
                                                        <p className="text-muted-foreground">{o.customer_email}</p>
                                                        <p className="text-muted-foreground">{o.customer_phone}</p>
                                                        {o.customer_cpf && <p className="text-muted-foreground">CPF: {o.customer_cpf}</p>}
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        <td className="py-3 px-4 text-muted-foreground whitespace-nowrap font-numeric">{new Date(o.created_date).toLocaleDateString("pt-BR")}</td>
                                        <td className="py-3 px-4 text-center text-muted-foreground font-numeric">{(o.items || []).length}</td>
                                        <td className="py-3 px-4 font-medium font-numeric">{formatBRL(o.total)}</td>
                                        <td className="py-3 px-4 text-muted-foreground">{PAYMENT_LABELS[o.payment_method] || o.payment_method || "—"}</td>
                                        <td className="py-3 px-4 text-muted-foreground">{SHIPPING_LABELS[o.shipping_method] || o.shipping_method || "—"}</td>
                                        <td className="py-3 px-4">
                                            <span className="text-[10px] uppercase tracking-[0.12em] px-2 py-1 rounded bg-muted">{ORDER_STATUS[o.status]?.label || o.status}</span>
                                        </td>
                                        <td className="py-3 px-4">
                                            <div className="flex items-center justify-end gap-1">
                                                <Link to={`/admin/pedidos/${o.id}`} className="p-1.5 hover:bg-muted rounded transition-colors" title="Ver pedido"><Eye className="w-4 h-4" strokeWidth={1.25} /></Link>
                                                <button onClick={(e) => copyOrderNumber(e, o.order_number)} className="p-1.5 hover:bg-muted rounded transition-colors" title="Copiar número">
                                                    {copiedId === o.order_number ? <Check className="w-4 h-4 text-accent" strokeWidth={1.5} /> : <Copy className="w-4 h-4" strokeWidth={1.25} />}
                                                </button>
                                                <Link to="/admin/clientes" className="p-1.5 hover:bg-muted rounded transition-colors" title="Abrir cliente"><User className="w-4 h-4" strokeWidth={1.25} /></Link>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile cards */}
                    <div className="md:hidden space-y-3">
                        {paginated.map((o) => (
                            <div key={o.id} className="bg-background rounded-lg border border-border p-4">
                                <div className="flex items-start justify-between gap-2 mb-2">
                                    <Link to={`/admin/pedidos/${o.id}`} className="font-medium text-sm hover:text-accent">{o.order_number}</Link>
                                    <span className="text-[10px] uppercase tracking-[0.12em] px-2 py-1 rounded bg-muted">{ORDER_STATUS[o.status]?.label || o.status}</span>
                                </div>
                                <p className="text-sm font-medium">{o.customer_name}</p>
                                <p className="text-[11px] text-muted-foreground">{o.customer_email} · {o.customer_phone}</p>
                                <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                                    <div className="text-[11px] text-muted-foreground">
                                        {new Date(o.created_date).toLocaleDateString("pt-BR")} · {(o.items || []).length} {((o.items || []).length) === 1 ? "item" : "itens"}
                                    </div>
                                    <span className="font-medium text-sm">{formatBRL(o.total)}</span>
                                </div>
                                <div className="flex items-center gap-2 mt-3">
                                    <Link to={`/admin/pedidos/${o.id}`} className="flex-1 text-center text-[11px] uppercase tracking-[0.16em] py-2 border border-border rounded">Ver pedido</Link>
                                    <button onClick={(e) => copyOrderNumber(e, o.order_number)} className="p-2 border border-border rounded">
                                        {copiedId === o.order_number ? <Check className="w-4 h-4 text-accent" strokeWidth={1.5} /> : <Copy className="w-4 h-4" strokeWidth={1.25} />}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-2 mt-6">
                            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-2 border border-border rounded-lg disabled:opacity-30 hover:bg-muted transition-colors">
                                <ChevronLeft className="w-4 h-4" strokeWidth={1.5} />
                            </button>
                            <span className="text-sm text-muted-foreground px-3 font-numeric">
                                Página {page} de {totalPages}
                            </span>
                            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-2 border border-border rounded-lg disabled:opacity-30 hover:bg-muted transition-colors">
                                <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

function CompactSelect({ label, value, onChange, options }) {
    return (
        <div>
            <label className="block text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1">{label}</label>
            <select value={value} onChange={(e) => onChange(e.target.value)} className="admin-field py-2 text-xs cursor-pointer">
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
        </div>
    );
}

function CompactInput({ label, value, onChange, type = "text", placeholder }) {
    return (
        <div>
            <label className="block text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1">{label}</label>
            <input type={type} value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="admin-field py-2 text-xs" />
        </div>
    );
}

function Chip({ label, value, onRemove }) {
    return (
        <span className="inline-flex items-center gap-2 bg-accent/10 text-foreground text-xs px-3 py-1.5 rounded-full">
            <span className="text-muted-foreground">{label}:</span> {value}
            <button onClick={onRemove} className="hover:text-rose transition-colors"><X className="w-3 h-3" strokeWidth={2} /></button>
        </span>
    );
}