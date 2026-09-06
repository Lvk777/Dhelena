import React, { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { SlidersHorizontal, X, ChevronDown } from "lucide-react";
import ProductCard from "@/components/ProductCard";
import { useCatalog } from "@/context/CatalogContext";
import { COLOR_SWATCHES, isAvailable, SIZES_LIST } from "@/data/products";

const SORTS = [
    { id: "recentes", label: "Mais recentes" },
    { id: "vendas", label: "Mais vendidos" },
    { id: "menor", label: "Menor preço" },
    { id: "maior", label: "Maior preço" },
];

const PRICE_RANGES = [
    { id: "ate200", label: "Até R$ 200", min: 0, max: 200 },
    { id: "200-300", label: "R$ 200 — R$ 300", min: 200, max: 300 },
    { id: "300-400", label: "R$ 300 — R$ 400", min: 300, max: 400 },
    { id: "400+", label: "Acima de R$ 400", min: 400, max: Infinity },
];

export default function Shop() {
    const { products, categories, loading } = useCatalog();
    const [params, setParams] = useSearchParams();
    const [visibleCount, setVisibleCount] = useState(12);
    const [sort, setSort] = useState("recentes");
    const [filtersOpen, setFiltersOpen] = useState(false);

    const cat = params.get("cat") || "";
    const filtro = params.get("filtro") || "";
    const q = params.get("q") || "";

    const [selectedCats, setSelectedCats] = useState(cat ? [cat] : []);
    const [selectedSizes, setSelectedSizes] = useState([]);
    const [selectedColors, setSelectedColors] = useState([]);
    const [selectedPrices, setSelectedPrices] = useState([]);
    const [onlyAvailable, setOnlyAvailable] = useState(false);

    useEffect(() => { if (cat) setSelectedCats([cat]); }, [cat]);

    const setParam = (key, value) => {
        const next = new URLSearchParams(params);
        if (value) next.set(key, value); else next.delete(key);
        setParams(next, { replace: true });
    };

    const toggle = (list, setList, val) => {
        setList((prev) => (prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val]));
        setVisibleCount(12);
    };

    const filtered = useMemo(() => {
        let list = [...products];
        if (q) list = list.filter((p) => (p.name + p.description + p.collection).toLowerCase().includes(q.toLowerCase()));
        if (filtro === "novidades") list = list.filter((p) => p.badges?.novo);
        if (filtro === "maiores") list = list.filter((p) => p.badges?.maisVendido);
        if (selectedCats.length) list = list.filter((p) => selectedCats.includes(p.category));
        if (selectedSizes.length) list = list.filter((p) => p.colors.some((c) => selectedSizes.some((s) => c.stock[s] > 0)));
        if (selectedColors.length) list = list.filter((p) => p.colors.some((c) => selectedColors.includes(c.id)));
        if (selectedPrices.length) {
            list = list.filter((p) => {
                const price = p.salePrice ?? p.price;
                return selectedPrices.some((r) => {
                    const range = PRICE_RANGES.find((pr) => pr.id === r);
                    return range && price >= range.min && price <= range.max;
                });
            });
        }
        if (onlyAvailable) list = list.filter((p) => isAvailable(p));
        switch (sort) {
            case "vendas": list.sort((a, b) => b.soldCount - a.soldCount); break;
            case "menor": list.sort((a, b) => (a.salePrice ?? a.price) - (b.salePrice ?? b.price)); break;
            case "maior": list.sort((a, b) => (b.salePrice ?? b.price) - (a.salePrice ?? a.price)); break;
            default: break;
        }
        return list;
    }, [products, q, filtro, selectedCats, selectedSizes, selectedColors, selectedPrices, onlyAvailable, sort]);

    const visible = filtered.slice(0, visibleCount);
    const clearAll = () => { setSelectedCats([]); setSelectedSizes([]); setSelectedColors([]); setSelectedPrices([]); setOnlyAvailable(false); setParams({}, { replace: true }); };

    if (loading) return <div className="h-screen flex items-center justify-center"><div className="w-8 h-8 border-4 border-[hsl(var(--bone))] border-t-[hsl(var(--gold))] rounded-full animate-spin" /></div>;

    return (
        <div>
            <div className="bg-[hsl(var(--bone))] py-16 sm:py-20 text-center">
                <div className="container-boutique">
                    <p className="eyebrow">Boutique</p>
                    <h1 className="mt-3 font-heading text-5xl sm:text-6xl tracking-[0.03em]">Nossa coleção</h1>
                    <div className="flex justify-center mt-5"><div className="gold-rule" /></div>
                    <p className="mt-5 text-muted-foreground max-w-xl mx-auto leading-relaxed">Encontre peças para diferentes momentos, sempre com a essência D'Helenas.</p>
                </div>
            </div>

            <div className="container-boutique py-12">
                <div className="flex items-center justify-between gap-4 pb-6 border-b border-border">
                    <button onClick={() => setFiltersOpen(true)} className="lg:hidden flex items-center gap-2 text-[11px] uppercase tracking-[0.2em]"><SlidersHorizontal className="w-4 h-4" strokeWidth={1.25} /> Filtros</button>
                    <p className="hidden lg:block text-sm text-muted-foreground">{filtered.length} peças</p>
                    <div className="flex items-center gap-2">
                        <label className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground hidden sm:block">Ordenar</label>
                        <div className="relative">
                            <select value={sort} onChange={(e) => setSort(e.target.value)} className="appearance-none border border-border bg-background pl-4 pr-10 py-2.5 text-sm focus:outline-none focus:border-[hsl(var(--gold))] cursor-pointer">
                                {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                            </select>
                            <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" strokeWidth={1.25} />
                        </div>
                    </div>
                </div>

                <div className="flex gap-10 mt-8">
                    <aside className="hidden lg:block w-60 shrink-0">
                        <Filters categories={categories} selectedCats={selectedCats} setSelectedCats={(v) => { toggle(selectedCats, setSelectedCats, v); setParam("cat", ""); }} selectedSizes={selectedSizes} setSelectedSizes={(v) => toggle(selectedSizes, setSelectedSizes, v)} selectedColors={selectedColors} setSelectedColors={(v) => toggle(selectedColors, setSelectedColors, v)} selectedPrices={selectedPrices} setSelectedPrices={(v) => toggle(selectedPrices, setSelectedPrices, v)} onlyAvailable={onlyAvailable} setOnlyAvailable={setOnlyAvailable} onClear={clearAll} />
                    </aside>

                    <div className="flex-1">
                        {visible.length === 0 ? (
                            <div className="py-24 text-center"><p className="text-muted-foreground">Nenhuma peça encontrada com esses filtros.</p><button onClick={clearAll} className="btn-outline mt-6">Limpar filtros</button></div>
                        ) : (
                            <>
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5 sm:gap-6">
                                    {visible.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
                                </div>
                                {visibleCount < filtered.length && <div className="text-center mt-14"><button onClick={() => setVisibleCount((c) => c + 8)} className="btn-outline">Ver mais</button></div>}
                            </>
                        )}
                    </div>
                </div>
            </div>

            {filtersOpen && (
                <div className="fixed inset-0 z-[70] lg:hidden">
                    <div className="absolute inset-0 bg-charcoal/30 backdrop-blur-sm animate-fade-in" onClick={() => setFiltersOpen(false)} />
                    <div className="absolute right-0 top-0 h-full w-[88%] max-w-sm bg-background overflow-y-auto animate-fade-in">
                        <div className="flex items-center justify-between px-6 h-16 border-b border-border sticky top-0 bg-background"><h3 className="text-[11px] uppercase tracking-[0.24em]">Filtros</h3><button onClick={() => setFiltersOpen(false)} aria-label="Fechar"><X className="w-5 h-5" strokeWidth={1.25} /></button></div>
                        <div className="p-6">
                            <Filters categories={categories} selectedCats={selectedCats} setSelectedCats={(v) => toggle(selectedCats, setSelectedCats, v)} selectedSizes={selectedSizes} setSelectedSizes={(v) => toggle(selectedSizes, setSelectedSizes, v)} selectedColors={selectedColors} setSelectedColors={(v) => toggle(selectedColors, setSelectedColors, v)} selectedPrices={selectedPrices} setSelectedPrices={(v) => toggle(selectedPrices, setSelectedPrices, v)} onlyAvailable={onlyAvailable} setOnlyAvailable={setOnlyAvailable} onClear={clearAll} />
                            <button onClick={() => setFiltersOpen(false)} className="btn-gold w-full mt-8">Ver {filtered.length} peças</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function Filters({ categories, selectedCats, setSelectedCats, selectedSizes, setSelectedSizes, selectedColors, setSelectedColors, selectedPrices, setSelectedPrices, onlyAvailable, setOnlyAvailable, onClear }) {
    return (
        <div className="space-y-8">
            <div className="flex justify-between items-center"><h4 className="text-[11px] uppercase tracking-[0.22em]">Filtrar por</h4><button onClick={onClear} className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground">Limpar</button></div>
            <FilterGroup title="Categoria">{categories.map((c) => <Check key={c.id} label={c.name} checked={selectedCats.includes(c.slug)} onChange={() => setSelectedCats(c.slug)} />)}</FilterGroup>
            <FilterGroup title="Tamanho"><div className="flex flex-wrap gap-2">{SIZES_LIST.map((s) => <button key={s} onClick={() => setSelectedSizes(s)} className={`w-10 h-10 border text-xs transition-colors ${selectedSizes.includes(s) ? "border-[hsl(var(--gold))] bg-[hsl(var(--gold))] text-white" : "border-border hover:border-foreground"}`}>{s}</button>)}</div></FilterGroup>
            <FilterGroup title="Cor"><div className="space-y-2">{Object.entries(COLOR_SWATCHES).map(([id, c]) => <button key={id} onClick={() => setSelectedColors(id)} className="flex items-center gap-3 w-full text-left group"><span className={`w-5 h-5 rounded-full border ${selectedColors.includes(id) ? "ring-1 ring-offset-2 ring-[hsl(var(--gold))]" : "border-border"}`} style={{ background: c.hex }} /><span className={`text-sm ${selectedColors.includes(id) ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"}`}>{c.name}</span></button>)}</div></FilterGroup>
            <FilterGroup title="Faixa de preço">{PRICE_RANGES.map((r) => <Check key={r.id} label={r.label} checked={selectedPrices.includes(r.id)} onChange={() => setSelectedPrices(r.id)} />)}</FilterGroup>
            <FilterGroup title="Disponibilidade"><Check label="Somente disponíveis" checked={onlyAvailable} onChange={() => setOnlyAvailable(!onlyAvailable)} /></FilterGroup>
        </div>
    );
}

function FilterGroup({ title, children }) { return <div><h5 className="text-[11px] uppercase tracking-[0.22em] text-foreground mb-3">{title}</h5><div className="space-y-2">{children}</div></div>; }
function Check({ label, checked, onChange }) { return <button onClick={onChange} className="flex items-center gap-3 w-full text-left group"><span className={`w-4 h-4 border flex items-center justify-center transition-colors ${checked ? "border-[hsl(var(--gold))] bg-[hsl(var(--gold))]" : "border-border group-hover:border-foreground"}`}>{checked && <span className="w-2 h-2 bg-white" />}</span><span className={`text-sm ${checked ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"}`}>{label}</span></button>; }