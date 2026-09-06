import React, { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { Search, SlidersHorizontal, X, ChevronDown, ChevronRight, Package, AlertTriangle, Boxes, Layers, History, Settings2, Loader2, ArrowUpDown } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { totalStock } from "@/data/products";
import AdminConfirmDialog from "@/components/admin/AdminConfirmDialog";
import AdjustStockModal from "@/components/admin/inventory/AdjustStockModal";
import StockMovementHistory from "@/components/admin/inventory/StockMovementHistory";

const STATUS_FILTERS = [
    { value: "all", label: "Todos" },
    { value: "in", label: "Em estoque" },
    { value: "low", label: "Estoque baixo" },
    { value: "out", label: "Esgotados" },
];

export default function Inventory() {
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [collections, setCollections] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [showFilters, setShowFilters] = useState(false);
    const [filters, setFilters] = useState({ category: "all", collection: "all", status: "all", color: "all", size: "all" });
    const [expandedRows, setExpandedRows] = useState(new Set());
    const [adjustTarget, setAdjustTarget] = useState(null);
    const [showHistory, setShowHistory] = useState(false);
    const [historyProductId, setHistoryProductId] = useState(null);
    const [lowStockThreshold, setLowStockThreshold] = useState(3);
    const [showSettings, setShowSettings] = useState(false);

    const load = () => {
        setLoading(true);
        Promise.all([
            base44.entities.Product.list("-updated_date", 200).catch(() => []),
            base44.entities.Category.list("sort_order", 100).catch(() => []),
            base44.entities.Collection.list("sort_order", 100).catch(() => []),
            base44.entities.Setting.filter({ key: "store" }).catch(() => []),
        ]).then(([prods, cats, cols, settings]) => {
            setProducts(prods || []);
            setCategories(cats || []);
            setCollections(cols || []);
            const storeSetting = (settings || []).find((s) => s.key === "store");
            if (storeSetting?.value?.low_stock_threshold != null) setLowStockThreshold(storeSetting.value.low_stock_threshold);
        }).finally(() => setLoading(false));
    };

    useEffect(() => { load(); }, []);

    const allColors = useMemo(() => {
        const map = new Map();
        products.forEach((p) => (p.colors || []).forEach((c) => map.set(c.id, { id: c.id, name: c.name || c.id })));
        return Array.from(map.values());
    }, [products]);

    const allSizes = useMemo(() => {
        const set = new Set();
        products.forEach((p) => (p.sizes || []).forEach((s) => set.add(s)));
        return Array.from(set);
    }, [products]);

    const stats = useMemo(() => {
        let totalUnits = 0, inStock = 0, low = 0, out = 0;
        products.forEach((p) => {
            const ts = totalStock(p);
            totalUnits += ts;
            if (ts === 0) out++;
            else if (ts <= lowStockThreshold) low++;
            else inStock++;
        });
        return { totalUnits, inStock, low, out };
    }, [products, lowStockThreshold]);

    const filtered = useMemo(() => {
        let result = [...products];
        if (search.trim()) {
            const q = search.toLowerCase();
            result = result.filter((p) =>
                (p.name || "").toLowerCase().includes(q) ||
                (p.sku || "").toLowerCase().includes(q) ||
                (p.category || "").toLowerCase().includes(q) ||
                (p.colors || []).some((c) => (c.name || "").toLowerCase().includes(q))
            );
        }
        if (filters.category !== "all") result = result.filter((p) => p.category === filters.category);
        if (filters.collection !== "all") result = result.filter((p) => p.collection === filters.collection);
        if (filters.color !== "all") result = result.filter((p) => (p.colors || []).some((c) => c.id === filters.color));
        if (filters.size !== "all") result = result.filter((p) => (p.sizes || []).includes(filters.size));
        if (filters.status !== "all") {
            result = result.filter((p) => {
                const ts = totalStock(p);
                if (filters.status === "out") return ts === 0;
                if (filters.status === "low") return ts > 0 && ts <= lowStockThreshold;
                if (filters.status === "in") return ts > lowStockThreshold;
                return true;
            });
        }
        return result;
    }, [products, search, filters, lowStockThreshold]);

    const activeFilterCount = Object.values(filters).filter((v) => v !== "all").length;

    const toggleRow = (id) => {
        const next = new Set(expandedRows);
        if (next.has(id)) next.delete(id); else next.add(id);
        setExpandedRows(next);
    };

    const getStatusBadge = (qty) => {
        if (qty === 0) return { label: "Esgotado", cls: "bg-destructive/10 text-destructive" };
        if (qty <= lowStockThreshold) return { label: "Estoque baixo", cls: "bg-accent/10 text-accent" };
        return { label: "Em estoque", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" };
    };

    const openHistory = (productId) => {
        setHistoryProductId(productId);
        setShowHistory(true);
    };

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <h1 className="font-heading text-2xl tracking-[0.03em]">Estoque</h1>
                <div className="flex items-center gap-2">
                    <button onClick={() => openHistory(null)} className="btn-outline text-xs">
                        <History className="w-4 h-4" strokeWidth={1.5} /> Movimentações
                    </button>
                </div>
            </div>

            {/* Stats cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                <StatCard icon={Boxes} label="Total de unidades" value={stats.totalUnits} />
                <StatCard icon={Package} label="Produtos em estoque" value={stats.inStock} color="text-emerald-600 dark:text-emerald-400" />
                <StatCard icon={AlertTriangle} label="Estoque baixo" value={stats.low} color="text-accent" />
                <StatCard icon={AlertTriangle} label="Esgotados" value={stats.out} color="text-destructive" />
            </div>

            {/* Search + Filters */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Buscar produto, SKU, cor..."
                        className="admin-field pl-10"
                    />
                    {search && (
                        <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                            <X className="w-4 h-4" strokeWidth={1.5} />
                        </button>
                    )}
                </div>

                <div className="relative">
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={`flex items-center gap-2 px-4 py-2.5 text-sm border rounded-lg transition-colors ${showFilters || activeFilterCount > 0 ? "border-accent bg-accent/5 text-foreground" : "border-border text-foreground/70 hover:text-foreground"}`}
                    >
                        <SlidersHorizontal className="w-4 h-4" strokeWidth={1.5} /> Filtros
                        {activeFilterCount > 0 && <span className="bg-accent text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-numeric">{activeFilterCount}</span>}
                    </button>
                    {showFilters && (
                        <>
                            <div className="fixed inset-0 z-10" onClick={() => setShowFilters(false)} />
                            <div className="absolute z-20 top-full left-0 mt-2 w-80 max-w-[90vw] bg-background border border-border rounded-xl shadow-2xl p-4 animate-fade-in">
                                <div className="grid grid-cols-2 gap-3">
                                    <CompactSelect label="Categoria" value={filters.category} onChange={(v) => setFilters((f) => ({ ...f, category: v }))} options={[{ value: "all", label: "Todas" }, ...categories.map((c) => ({ value: c.slug, label: c.name }))]} />
                                    <CompactSelect label="Coleção" value={filters.collection} onChange={(v) => setFilters((f) => ({ ...f, collection: v }))} options={[{ value: "all", label: "Todas" }, ...collections.map((c) => ({ value: c.name, label: c.name }))]} />
                                    <CompactSelect label="Status" value={filters.status} onChange={(v) => setFilters((f) => ({ ...f, status: v }))} options={STATUS_FILTERS} />
                                    <CompactSelect label="Cor" value={filters.color} onChange={(v) => setFilters((f) => ({ ...f, color: v }))} options={[{ value: "all", label: "Todas" }, ...allColors.map((c) => ({ value: c.id, label: c.name }))]} />
                                    <CompactSelect label="Tamanho" value={filters.size} onChange={(v) => setFilters((f) => ({ ...f, size: v }))} options={[{ value: "all", label: "Todos" }, ...allSizes.map((s) => ({ value: s, label: s }))]} />
                                </div>
                                {activeFilterCount > 0 && (
                                    <button onClick={() => { setFilters({ category: "all", collection: "all", status: "all", color: "all", size: "all" }); }} className="text-[11px] uppercase tracking-[0.16em] text-rose hover:underline mt-3 w-full text-left">
                                        Limpar filtros
                                    </button>
                                )}
                            </div>
                        </>
                    )}
                </div>

                <div className="text-sm text-muted-foreground ml-auto font-numeric">
                    {loading ? "Carregando..." : `${filtered.length} ${filtered.length === 1 ? "produto" : "produtos"}`}
                </div>
            </div>

            {/* Active filter chips */}
            {activeFilterCount > 0 && (
                <div className="flex flex-wrap items-center gap-2 mb-4">
                    {filters.category !== "all" && <FilterChip label="Categoria" value={categories.find((c) => c.slug === filters.category)?.name} onRemove={() => setFilters((f) => ({ ...f, category: "all" }))} />}
                    {filters.collection !== "all" && <FilterChip label="Coleção" value={filters.collection} onRemove={() => setFilters((f) => ({ ...f, collection: "all" }))} />}
                    {filters.status !== "all" && <FilterChip label="Status" value={STATUS_FILTERS.find((s) => s.value === filters.status)?.label} onRemove={() => setFilters((f) => ({ ...f, status: "all" }))} />}
                    {filters.color !== "all" && <FilterChip label="Cor" value={allColors.find((c) => c.id === filters.color)?.name} onRemove={() => setFilters((f) => ({ ...f, color: "all" }))} />}
                    {filters.size !== "all" && <FilterChip label="Tamanho" value={filters.size} onRemove={() => setFilters((f) => ({ ...f, size: "all" }))} />}
                </div>
            )}

            {/* Content */}
            {loading ? (
                <div className="h-64 bg-background animate-pulse rounded-lg" />
            ) : filtered.length === 0 ? (
                <div className="bg-background rounded-lg border border-border p-12 text-center">
                    <Package className="w-10 h-10 text-muted-foreground/40 mx-auto mb-4" strokeWidth={1} />
                    <p className="text-sm text-muted-foreground">Nenhum produto encontrado.</p>
                </div>
            ) : (
                <>
                    {/* Desktop table */}
                    <div className="hidden md:block bg-background rounded-lg border border-border overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                                    <th className="py-3 px-3 w-8"></th>
                                    <th className="py-3 px-3">Produto</th>
                                    <th className="py-3 px-3">SKU</th>
                                    <th className="py-3 px-3 hidden lg:table-cell">Categoria</th>
                                    <th className="py-3 px-3 text-right">Estoque</th>
                                    <th className="py-3 px-3">Status</th>
                                    <th className="py-3 px-3 hidden lg:table-cell">Atualização</th>
                                    <th className="py-3 px-3 text-right">Ações</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {filtered.map((p) => {
                                    const ts = totalStock(p);
                                    const badge = getStatusBadge(ts);
                                    const isExpanded = expandedRows.has(p.id);
                                    return (
                                        <React.Fragment key={p.id}>
                                            <tr className="hover:bg-muted/30 transition-colors">
                                                <td className="py-2.5 px-3">
                                                    <button onClick={() => toggleRow(p.id)} className="p-1 hover:bg-muted rounded transition-colors">
                                                        {isExpanded ? <ChevronDown className="w-4 h-4" strokeWidth={1.5} /> : <ChevronRight className="w-4 h-4" strokeWidth={1.5} />}
                                                    </button>
                                                </td>
                                                <td className="py-2.5 px-3">
                                                    <div className="flex items-center gap-2">
                                                        {p.images?.[0] && <img src={p.images[0]} alt="" className="w-8 h-10 object-cover bg-bone rounded shrink-0" />}
                                                        <Link to={`/admin/produtos/${p.id}`} className="font-medium hover:text-accent transition-colors truncate max-w-[200px]">{p.name}</Link>
                                                    </div>
                                                </td>
                                                <td className="py-2.5 px-3 text-muted-foreground font-numeric">{p.sku || "—"}</td>
                                                <td className="py-2.5 px-3 hidden lg:table-cell text-muted-foreground">{p.category || "—"}</td>
                                                <td className="py-2.5 px-3 text-right font-numeric font-medium">{ts}</td>
                                                <td className="py-2.5 px-3">
                                                    <span className={`text-[10px] uppercase tracking-[0.1em] px-2 py-1 rounded ${badge.cls}`}>{badge.label}</span>
                                                </td>
                                                <td className="py-2.5 px-3 hidden lg:table-cell text-muted-foreground font-numeric text-xs whitespace-nowrap">
                                                    {p.updated_date ? new Date(p.updated_date).toLocaleDateString("pt-BR") : "—"}
                                                </td>
                                                <td className="py-2.5 px-3">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <button onClick={() => openHistory(p.id)} className="p-1.5 hover:bg-muted rounded transition-colors" title="Histórico"><History className="w-4 h-4" strokeWidth={1.25} /></button>
                                                        {p.colors?.length > 0 && p.colors[0]?.stock && Object.keys(p.colors[0].stock).length > 0 && (
                                                            <button
                                                                onClick={() => setAdjustTarget({ product: p, color: p.colors[0], size: Object.keys(p.colors[0].stock)[0], currentStock: p.colors[0].stock[Object.keys(p.colors[0].stock)[0]] })}
                                                                className="p-1.5 hover:bg-muted rounded transition-colors text-accent"
                                                                title="Ajustar estoque"
                                                            >
                                                                <ArrowUpDown className="w-4 h-4" strokeWidth={1.25} />
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                            {isExpanded && (p.colors || []).map((c) =>
                                                Object.entries(c.stock || {}).map(([size, qty]) => {
                                                    const vBadge = getStatusBadge(qty);
                                                    return (
                                                        <tr key={`${p.id}-${c.id}-${size}`} className="bg-muted/20 hover:bg-muted/40 transition-colors">
                                                            <td className="py-2 px-3"></td>
                                                            <td className="py-2 px-3 pl-8">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="w-3 h-3 rounded-full border border-border shrink-0" style={{ background: c.hex }} />
                                                                    <span className="text-xs text-muted-foreground">{c.name || c.id} · Tam {size}</span>
                                                                </div>
                                                            </td>
                                                            <td className="py-2 px-3"></td>
                                                            <td className="py-2 px-3 hidden lg:table-cell"></td>
                                                            <td className="py-2 px-3 text-right font-numeric">{qty}</td>
                                                            <td className="py-2 px-3"><span className={`text-[10px] uppercase tracking-[0.1em] px-1.5 py-0.5 rounded ${vBadge.cls}`}>{vBadge.label}</span></td>
                                                            <td className="py-2 px-3 hidden lg:table-cell"></td>
                                                            <td className="py-2 px-3">
                                                                <div className="flex justify-end">
                                                                    <button
                                                                        onClick={() => setAdjustTarget({ product: p, color: c, size, currentStock: qty })}
                                                                        className="p-1.5 hover:bg-background rounded transition-colors text-accent"
                                                                        title="Ajustar"
                                                                    >
                                                                        <ArrowUpDown className="w-4 h-4" strokeWidth={1.25} />
                                                                    </button>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile cards */}
                    <div className="md:hidden space-y-3">
                        {filtered.map((p) => {
                            const ts = totalStock(p);
                            const badge = getStatusBadge(ts);
                            const isExpanded = expandedRows.has(p.id);
                            return (
                                <div key={p.id} className="bg-background rounded-lg border border-border p-4">
                                    <div className="flex items-start justify-between gap-2 mb-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                            {p.images?.[0] && <img src={p.images[0]} alt="" className="w-10 h-12 object-cover bg-bone rounded shrink-0" />}
                                            <div className="min-w-0">
                                                <Link to={`/admin/produtos/${p.id}`} className="font-medium text-sm hover:text-accent truncate block">{p.name}</Link>
                                                <p className="text-[11px] text-muted-foreground font-numeric">{p.sku || "—"}</p>
                                            </div>
                                        </div>
                                        <span className={`text-[10px] uppercase tracking-[0.1em] px-2 py-1 rounded shrink-0 ${badge.cls}`}>{badge.label}</span>
                                    </div>
                                    <div className="flex items-center justify-between text-sm">
                                        <span className="text-muted-foreground">Total: <span className="font-numeric font-medium text-foreground">{ts}</span></span>
                                        <div className="flex gap-1">
                                            <button onClick={() => openHistory(p.id)} className="p-1.5 hover:bg-muted rounded" title="Histórico"><History className="w-4 h-4" strokeWidth={1.25} /></button>
                                            <button onClick={() => toggleRow(p.id)} className="p-1.5 hover:bg-muted rounded" title="Variações">
                                                {isExpanded ? <ChevronDown className="w-4 h-4" strokeWidth={1.5} /> : <ChevronRight className="w-4 h-4" strokeWidth={1.5} />}
                                            </button>
                                        </div>
                                    </div>
                                    {isExpanded && (
                                        <div className="mt-3 pt-3 border-t border-border space-y-2">
                                            {(p.colors || []).map((c) =>
                                                Object.entries(c.stock || {}).map(([size, qty]) => {
                                                    const vBadge = getStatusBadge(qty);
                                                    return (
                                                        <div key={`${c.id}-${size}`} className="flex items-center justify-between text-xs">
                                                            <div className="flex items-center gap-2">
                                                                <span className="w-3 h-3 rounded-full border border-border" style={{ background: c.hex }} />
                                                                <span className="text-muted-foreground">{c.name || c.id} · {size}</span>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-numeric">{qty}</span>
                                                                <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded ${vBadge.cls}`}>{vBadge.label}</span>
                                                                <button onClick={() => setAdjustTarget({ product: p, color: c, size, currentStock: qty })} className="p-1 text-accent">
                                                                    <ArrowUpDown className="w-3.5 h-3.5" strokeWidth={1.25} />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            {/* Adjust stock modal */}
            {adjustTarget && (
                <AdjustStockModal
                    product={adjustTarget.product}
                    color={adjustTarget.color}
                    size={adjustTarget.size}
                    currentStock={adjustTarget.currentStock}
                    onClose={() => setAdjustTarget(null)}
                    onAdjusted={() => { setAdjustTarget(null); load(); }}
                />
            )}

            {/* Movement history */}
            <StockMovementHistory open={showHistory} onClose={() => { setShowHistory(false); setHistoryProductId(null); }} productId={historyProductId} />
        </div>
    );
}

function StatCard({ icon: Icon, label, value, color = "text-foreground" }) {
    return (
        <div className="bg-background rounded-lg border border-border p-4">
            <div className="flex items-center gap-2 mb-2">
                <Icon className={`w-4 h-4 ${color}`} strokeWidth={1.5} />
                <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
            </div>
            <p className={`text-2xl font-numeric font-medium ${color}`}>{value}</p>
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

function FilterChip({ label, value, onRemove }) {
    return (
        <span className="inline-flex items-center gap-1.5 bg-accent/10 text-foreground text-xs px-2.5 py-1 rounded-full">
            <span className="text-muted-foreground">{label}:</span> {value}
            <button onClick={onRemove} className="hover:text-rose transition-colors"><X className="w-3 h-3" strokeWidth={2} /></button>
        </span>
    );
}