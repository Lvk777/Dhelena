import React, { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { X, Plus, Trash2, ShoppingBag, Check, Sparkles, Shirt } from "lucide-react";
import { useCatalog } from "@/context/CatalogContext";
import { useStore } from "@/context/StoreContext";
import { formatBRL } from "@/data/products";
import { useActivePromotions, PromotionLookCard, PromotionStrip } from "@/components/PromoComponents";
import PositionBanner from "@/components/PositionBanner";

const LOOK_SECTIONS = [
    { id: "vestido", label: "Vestidos", categories: ["vestidos", "conjuntos"] },
    { id: "parte-cima", label: "Parte de Cima", categories: ["blusas"] },
    { id: "parte-baixo", label: "Parte de Baixo", categories: ["calcas", "calças"] },
    { id: "bolsa", label: "Bolsas", categories: ["bolsas"] },
    { id: "acessorios", label: "Acessórios", categories: ["acessorios"] },
];

export default function MonteSeuLook() {
    const { products } = useCatalog();
    const { addToCart, setCartOpen, showToast } = useStore();

    const [lookItems, setLookItems] = useState([]);
    const [activeSection, setActiveSection] = useState(null);
    const [configProduct, setConfigProduct] = useState(null);
    const [selColor, setSelColor] = useState(null);
    const [selSize, setSelSize] = useState(null);
    const [mobileTab, setMobileTab] = useState("products");
    const [lookAdded, setLookAdded] = useState(false);

    // Fetch active look promotions
    const allPromos = useActivePromotions();
    const promotion = allPromos[0] || null;

    // Filter sections with products
    const sections = useMemo(() => {
        return LOOK_SECTIONS.filter(s =>
            products.some(p => s.categories.some(c => c.toLowerCase() === p.category?.toLowerCase()))
        ).map(s => ({
            ...s,
            items: products.filter(p => s.categories.some(c => c.toLowerCase() === p.category?.toLowerCase())),
        }));
    }, [products]);

    useEffect(() => {
        if (sections.length > 0 && !activeSection) setActiveSection(sections[0].id);
    }, [sections, activeSection]);

    const currentSection = sections.find(s => s.id === activeSection);

    // ── Look discount calculation ────────────────────────────
    // ⚠️ FRONTEND DEMO ONLY — must be validated server-side in production.
    // When the backend is deployed, the look discount should be recalculated
    // by the backend before order creation. See: backend/src/orderService.js
    const subtotal = lookItems.reduce((sum, item) => {
        return sum + Number(item.product.salePrice ?? item.product.price);
    }, 0);

    const lookDiscount = useMemo(() => {
        if (!promotion || lookItems.length < promotion.min_items) return 0;
        if (Number(promotion.discount_percent) > 0) {
            return (subtotal * Number(promotion.discount_percent)) / 100;
        }
        return Number(promotion.discount_fixed) || 0;
    }, [lookItems, promotion, subtotal]);

    const total = subtotal - lookDiscount;

    // ── Handlers ──────────────────────────────────────────────
    const openConfig = (product) => {
        setConfigProduct(product);
        setSelColor(product.colors[0]?.id || null);
        // Auto-select size when product has only one (e.g. "Único")
        setSelSize(product.sizes.length === 1 ? product.sizes[0] : null);
    };

    const handleAddToLook = () => {
        if (!configProduct || !selColor || !selSize) return;
        const exists = lookItems.find(i => i.productId === configProduct.id);
        if (exists) {
            // Replace existing piece from same product
            setLookItems(prev => prev.map(i =>
                i.productId === configProduct.id
                    ? { ...i, colorId: selColor, size: selSize }
                    : i
            ));
        } else {
            setLookItems(prev => [...prev, {
                productId: configProduct.id,
                product: configProduct,
                colorId: selColor,
                size: selSize,
            }]);
        }
        setConfigProduct(null);
        setSelColor(null);
        setSelSize(null);
        setMobileTab("look");
        showToast("Peça adicionada ao look ✓");
    };

    const handleRemoveItem = (productId) => {
        setLookItems(prev => prev.filter(i => i.productId !== productId));
    };

    const handleAddLookToCart = () => {
        if (lookItems.length === 0) return;
        lookItems.forEach(item => {
            const color = item.product.colors.find(c => c.id === item.colorId);
            const isUnique = item.size.toLowerCase() === "único" || item.size.toLowerCase() === "unico";
            const stock = isUnique
                ? Object.values(color?.stock || {}).reduce((a, b) => a + (Number(b) || 0), 0)
                : (color?.stock[item.size] || 0);
            addToCart({ productId: item.productId, colorId: item.colorId, size: item.size, qty: 1 }, stock || undefined);
        });
        setLookAdded(true);
        showToast("Look adicionado à sua sacola.");
    };

    const handleContinueShopping = () => {
        setLookItems([]);
        setLookAdded(false);
        setMobileTab("products");
    };

    const handleClearLook = () => {
        setLookItems([]);
        showToast("Look limpo");
    };

    return (
        <div className="min-h-screen bg-[hsl(var(--bone))]">
            <PositionBanner position="lookbook_top" />
            {/* Hero */}
            <div className="bg-background py-12 sm:py-16 text-center border-b border-border">
                <div className="container-boutique">
                    <Sparkles className="w-6 h-6 text-[hsl(var(--gold))] mx-auto mb-3" strokeWidth={1.25} />
                    <h1 className="font-heading text-4xl sm:text-5xl tracking-[0.03em]">Monte seu Look</h1>
                    <p className="text-muted-foreground mt-3 text-sm">Crie combinações do seu jeito.</p>
                    {promotion && <PromotionStrip promo={promotion} />}
                </div>
            </div>

            {/* Mobile tabs */}
            <div className="lg:hidden sticky top-0 z-30 bg-background border-b border-border flex">
                <button
                    onClick={() => setMobileTab("products")}
                    className={`flex-1 py-3 text-[11px] uppercase tracking-[0.18em] ${mobileTab === "products" ? "border-b-2 border-[hsl(var(--gold))] text-foreground" : "text-muted-foreground"}`}
                >
                    Produtos
                </button>
                <button
                    onClick={() => setMobileTab("look")}
                    className={`flex-1 py-3 text-[11px] uppercase tracking-[0.18em] ${mobileTab === "look" ? "border-b-2 border-[hsl(var(--gold))] text-foreground" : "text-muted-foreground"}`}
                >
                    Meu Look ({lookItems.length})
                </button>
            </div>

            <div className="container-boutique py-6 lg:py-10">
                <div className="grid lg:grid-cols-[1fr_1fr_360px] gap-6 lg:gap-8">
                    {/* ─── Left: Categories + Products ─── */}
                    <div className={`${mobileTab === "products" ? "block" : "hidden"} lg:block`}>
                        {/* Section tabs */}
                        <div className="flex flex-wrap gap-2 mb-5">
                            {sections.map(s => (
                                <button
                                    key={s.id}
                                    onClick={() => setActiveSection(s.id)}
                                    className={`px-4 py-2 text-[11px] uppercase tracking-[0.15em] border transition-colors ${
                                        activeSection === s.id
                                            ? "border-foreground bg-foreground text-white"
                                            : "border-border text-foreground/70 hover:border-foreground"
                                    }`}
                                >
                                    {s.label} ({s.items.length})
                                </button>
                            ))}
                        </div>

                        {/* Product grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
                            {currentSection?.items.map(p => {
                                const inLook = lookItems.find(i => i.productId === p.id);
                                return (
                                    <div key={p.id} className="group bg-background border border-border overflow-hidden">
                                        <div className="aspect-[3/4] overflow-hidden bg-bone relative">
                                            <img src={p.images[0]} alt={p.name} className="w-full h-full object-cover" />
                                            {inLook && (
                                                <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-[hsl(var(--gold))] text-white flex items-center justify-center">
                                                    <Check className="w-3.5 h-3.5" strokeWidth={2} />
                                                </span>
                                            )}
                                        </div>
                                        <div className="p-2.5">
                                            <p className="text-[11px] font-medium truncate">{p.name}</p>
                                            <p className="text-[11px] text-muted-foreground whitespace-nowrap">{formatBRL(Number(p.salePrice ?? p.price))}</p>
                                            <button
                                                onClick={() => openConfig(p)}
                                                className="w-full mt-2 py-1.5 text-[10px] uppercase tracking-[0.12em] border border-border hover:border-foreground transition-colors"
                                            >
                                                {inLook ? "Trocar" : "Adicionar"}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* ─── Center: Look Composition ─── */}
                    <div className={`${mobileTab === "look" ? "block" : "hidden"} lg:block`}>
                        <h2 className="font-heading text-2xl tracking-[0.03em] mb-4">Composição do Look</h2>
                        {lookItems.length === 0 ? (
                            <div className="border-2 border-dashed border-border py-20 text-center">
                                <Shirt className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" strokeWidth={1} />
                                <p className="text-sm text-muted-foreground">Seu look está vazio.</p>
                                <button onClick={() => setMobileTab("products")} className="text-[11px] uppercase tracking-[0.15em] text-[hsl(var(--gold))] mt-3 lg:hidden">
                                    Escolher peças
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {lookItems.map(item => {
                                    const color = item.product.colors.find(c => c.id === item.colorId);
                                    return (
                                        <div key={item.productId} className="flex gap-3 bg-background border border-border p-3">
                                            <img src={item.product.images[0]} alt="" className="w-16 h-20 object-cover bg-bone" />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium truncate">{item.product.name}</p>
                                                <p className="text-[11px] text-muted-foreground">
                                                    {color?.name} · Tam {item.size}
                                                </p>
                                                <p className="text-sm mt-1 whitespace-nowrap">{formatBRL(Number(item.product.salePrice ?? item.product.price))}</p>
                                            </div>
                                            <button onClick={() => openConfig(item.product)} className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground">Trocar</button>
                                            <button onClick={() => handleRemoveItem(item.productId)} className="text-muted-foreground hover:text-[hsl(var(--rose))]">
                                                <X className="w-4 h-4" strokeWidth={1.25} />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* ─── Right: Summary ─── */}
                    <div className={`${mobileTab === "look" ? "block" : "hidden"} lg:block`}>
                        <div className="bg-background border border-border p-6 lg:sticky lg:top-6">
                            {promotion && <PromotionLookCard promo={promotion} currentCount={lookItems.length} />}
                            <h3 className="font-heading text-lg tracking-[0.04em] mb-5">Resumo</h3>
                            <div className="space-y-3 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Subtotal ({lookItems.length} {lookItems.length === 1 ? "peça" : "peças"})</span>
                                    <span className="whitespace-nowrap">{formatBRL(subtotal)}</span>
                                </div>
                                {lookDiscount > 0 && (
                                    <div className="flex justify-between text-[hsl(var(--gold))]">
                                        <span>Desconto do look</span>
                                        <span className="whitespace-nowrap">- {formatBRL(lookDiscount)}</span>
                                    </div>
                                )}
                                {promotion && lookItems.length < promotion.min_items && (
                                    <p className="text-[11px] text-muted-foreground pt-1">
                                        Adicione mais {promotion.min_items - lookItems.length} peça(s) para ganhar {Number(promotion.discount_percent)}% OFF
                                    </p>
                                )}
                                <div className="border-t border-border pt-4 flex justify-between font-medium text-base">
                                    <span>Total</span>
                                    <span className="whitespace-nowrap">{formatBRL(total)}</span>
                                </div>
                            </div>

                            {lookAdded ? (
                                <div className="text-center py-6 mt-5">
                                    <div className="w-12 h-12 rounded-full bg-[hsl(var(--gold))] mx-auto flex items-center justify-center mb-4">
                                        <Check className="w-6 h-6 text-white" strokeWidth={1.5} />
                                    </div>
                                    <p className="text-sm text-foreground mb-6">Look adicionado à sua sacola.</p>
                                    <button onClick={() => setCartOpen(true)} className="btn-gold w-full py-3.5 text-sm mb-2">Ver sacola</button>
                                    <button onClick={handleContinueShopping} className="btn-outline w-full py-3 text-sm">Continuar comprando</button>
                                </div>
                            ) : (
                                <>
                                    <button
                                        onClick={handleAddLookToCart}
                                        disabled={lookItems.length === 0}
                                        className="btn-gold w-full mt-5 py-3.5 text-sm disabled:opacity-40 flex items-center justify-center gap-2"
                                    >
                                        <ShoppingBag className="w-4 h-4" strokeWidth={1.5} /> Adicionar look à sacola
                                    </button>
                                    <button
                                        onClick={handleClearLook}
                                        disabled={lookItems.length === 0}
                                        className="btn-outline w-full mt-2 py-3 text-sm disabled:opacity-40 flex items-center justify-center gap-2"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} /> Limpar look
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* ─── Config Modal (color/size selection) ─── */}
            {configProduct && (
                <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4">
                    <div className="absolute inset-0 bg-charcoal/40 backdrop-blur-sm" onClick={() => setConfigProduct(null)} />
                    <div className="relative bg-background shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto animate-fade-in">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                            <h3 className="font-heading text-lg tracking-[0.04em]">{configProduct.name}</h3>
                            <button onClick={() => setConfigProduct(null)} className="text-muted-foreground hover:text-foreground">
                                <X className="w-5 h-5" strokeWidth={1.25} />
                            </button>
                        </div>
                        <div className="p-5">
                            {/* color */}
                            <p className="text-[11px] uppercase tracking-[0.2em] mb-3">Cor</p>
                            <div className="flex flex-wrap gap-2.5 mb-5">
                                {configProduct.colors.map(c => (
                                    <button
                                        key={c.id}
                                        onClick={() => { setSelColor(c.id); setSelSize(null); }}
                                        className={`w-9 h-9 rounded-full border-2 transition-all ${selColor === c.id ? "border-[hsl(var(--gold))]" : "border-border hover:border-foreground/40"}`}
                                        style={{ background: c.hex || "#ccc" }}
                                        aria-label={c.name}
                                    />
                                ))}
                            </div>
                            {/* size — hidden when product has only one size (auto-selected) */}
                            {configProduct.sizes.length > 1 && (
                                <div className="mb-5">
                                    <p className="text-[11px] uppercase tracking-[0.2em] mb-3">Tamanho</p>
                                    <div className="flex flex-wrap gap-2">
                                        {configProduct.sizes.map(s => {
                                            const color = configProduct.colors.find(c => c.id === selColor);
                                            const perSizeStock = color?.stock[s] ?? 0;
                                            const isUnique = s.toLowerCase() === "único" || s.toLowerCase() === "unico";
                                            const stock = isUnique
                                                ? Object.values(color?.stock || {}).reduce((a, b) => a + (Number(b) || 0), 0)
                                                : perSizeStock;
                                            const disabled = stock === 0;
                                            return (
                                                <button
                                                    key={s}
                                                    disabled={disabled}
                                                    onClick={() => setSelSize(s)}
                                                    className={`min-w-[48px] h-11 border text-sm transition-colors ${selSize === s ? "border-foreground bg-foreground text-white" : disabled ? "border-border text-muted-foreground/40 cursor-not-allowed line-through" : "border-border hover:border-foreground"}`}
                                                >
                                                    {s}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                            <button
                                onClick={handleAddToLook}
                                disabled={!selColor || !selSize}
                                className="btn-gold w-full py-4 text-sm disabled:opacity-40 flex items-center justify-center gap-2"
                            >
                                <Plus className="w-4 h-4" strokeWidth={1.5} /> Adicionar ao look
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
