import React, { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Minus, Plus, X, Tag, Truck, ArrowRight } from "lucide-react";
import { useStore } from "@/context/StoreContext";
import { useCatalog } from "@/context/CatalogContext";
import { useAuth } from "@/lib/AuthContext";
import { usePublicSettings } from "@/context/PublicSettingsContext";
import { COLOR_SWATCHES, formatBRL, stockFor } from "@/data/products";
import CheckoutAuthModal from "@/components/CheckoutAuthModal";
import { useActivePromotions, PromotionStrip } from "@/components/PromoComponents";
import PositionBanner from "@/components/PositionBanner";
import { base44 } from "@/api/base44Client";
import { selectedDeliveryCost, shippingContextKey } from "@/lib/shippingSelection";

export default function Cart() {
    const { cart, clearCart, removeFromCart, updateQty, showToast, couponCode, couponResult, couponLoading, applyCoupon: applyCouponCtx, clearCoupon } = useStore();
    const { products, loading: catalogLoading } = useCatalog();
    const { user } = useAuth();
    const { isFreeShipping } = usePublicSettings();
    const navigate = useNavigate();
    const [couponInput, setCouponInput] = useState("");
    const [cep, setCep] = useState("");
    const [frete, setFrete] = useState(null);
    const [shippingOptions, setShippingOptions] = useState([]);
    const [shippingLoading, setShippingLoading] = useState(false);
    const [shippingError, setShippingError] = useState("");
    const quoteVersion = useRef(0);
    const [authModalOpen, setAuthModalOpen] = useState(false);
    const promos = useActivePromotions();
    const activePromo = promos[0] || null;

    const lines = cart.map((i) => ({ ...i, product: products.find((p) => p.id === i.productId) })).filter((l) => l.product);
    const invalidLines = lines.filter((line) => !Number.isInteger(line.qty) || line.qty <= 0
        || stockFor(line.product, line.colorId, line.size) < line.qty);
    const handleCheckout = () => {
        if (invalidLines.length || lines.length !== cart.length) { showToast("Revise os itens sem estoque antes de continuar", "error"); return; }
        if (user) navigate("/checkout");
        else setAuthModalOpen(true);
    };
    const subtotal = lines.reduce((s, l) => s + (l.product.salePrice || l.product.price) * l.qty, 0);
    const discount = couponResult?.valid ? (couponResult.discount || 0) : 0;
    const freeShippingFromCoupon = couponResult?.valid && couponResult.freeShipping;
    const quoteKey = shippingContextKey(cep, cart, couponCode);
    const shipping = selectedDeliveryCost(frete, quoteKey, freeShippingFromCoupon || isFreeShipping(subtotal - discount));
    const total = subtotal - discount + (shipping ?? 0);

    useEffect(() => {
        quoteVersion.current += 1;
        setFrete(null);
        setShippingOptions([]);
        setShippingError("");
        setShippingLoading(false);
    }, [quoteKey]);

    const handleApplyCoupon = async (e) => {
        e.preventDefault();
        const result = await applyCouponCtx(couponInput);
        if (result.valid) showToast("Cupom aplicado ✓");
        else showToast(result.error || "Cupom inválido", 'error');
    };

    const calcFrete = async (e) => {
        e.preventDefault();
        const postalCode = cep.replace(/\D/g, "");
        if (postalCode.length !== 8) { setShippingError("Informe um CEP válido com 8 dígitos."); return; }
        setShippingLoading(true);
        setShippingError("");
        setFrete(null);
        const version = ++quoteVersion.current;
        try {
            const result = await base44.functions.invoke("calculateShipping", {
                to_postal_code: postalCode,
                items: cart.map(({ productId, qty }) => ({ productId, qty })),
            });
            if (quoteVersion.current !== version) return;
            const options = (result.options || []).filter((option) => option.id != null && Number.isFinite(Number(option.price)) && Number(option.price) >= 0);
            setShippingOptions(options);
            if (!options.length) setShippingError("Nenhuma opção de entrega disponível para este CEP.");
        } catch (error) {
            if (quoteVersion.current !== version) return;
            setShippingOptions([]);
            setShippingError(error.response?.data?.error || error.message || "Não foi possível calcular o frete.");
        } finally { if (quoteVersion.current === version) setShippingLoading(false); }
    };

    if (lines.length === 0) {
        return (
            <div className="container-boutique py-32 text-center">
                <h1 className="font-heading text-4xl tracking-[0.03em]">Sua sacola</h1>
                <div className="flex justify-center mt-5"><div className="gold-rule" /></div>
                <p className="mt-8 text-muted-foreground">{catalogLoading ? "Carregando sua sacola..." : cart.length ? "Os itens da sacola não estão mais disponíveis." : "Sua sacola está vazia no momento."}</p>
                {!catalogLoading && cart.length > 0 && <button type="button" onClick={clearCart} className="btn-outline mt-6">Limpar sacola</button>}
                <Link to="/loja" className="btn-gold mt-8">Explorar a coleção</Link>
            </div>
        );
    }

    return (
        <div>
        <PositionBanner position="cart_top" variant="compact" />
        <div className="container-boutique py-14">
            <h1 className="font-heading text-4xl sm:text-5xl tracking-[0.03em] text-center">Sua sacola</h1>
            <div className="flex justify-center mt-5"><div className="gold-rule" /></div>

            {activePromo && (
                <div className="mt-6">
                    <PromotionStrip promo={activePromo} />
                </div>
            )}

            <div className="grid lg:grid-cols-3 gap-12 mt-12">
                {/* items */}
                <div className="lg:col-span-2 space-y-6 min-w-0">
                    {lines.map((l) => (
                        <div key={`${l.productId}-${l.colorId}-${l.size}`} className="flex gap-5 pb-6 border-b border-border">
                            <Link to={`/produto/${l.productId}`} className="shrink-0">
                                <img src={l.product.images[0]} alt={l.product.name} className="w-24 h-32 sm:w-28 sm:h-36 object-cover bg-bone" />
                            </Link>
                            <div className="flex-1 flex flex-col min-w-0">
                                <div className="flex justify-between gap-4">
                                    <div>
                                        <Link to={`/produto/${l.productId}`} className="text-base font-medium hover:text-[hsl(var(--rose))] transition-colors">{l.product.name}</Link>
                                        <p className="text-[11px] text-muted-foreground mt-1 uppercase tracking-[0.14em]">Cód. {l.product.sku}</p>
                                        <p className="text-sm text-muted-foreground mt-2">{l.product.colors.find((c) => c.id === l.colorId)?.name || COLOR_SWATCHES[l.colorId]?.name} · Tam {l.size}</p>
                                    </div>
                                    <button onClick={() => removeFromCart({ productId: l.productId, colorId: l.colorId, size: l.size })} className="text-muted-foreground hover:text-foreground" aria-label="Remover"><X className="w-4 h-4" strokeWidth={1.25} /></button>
                                </div>
                                <div className="flex items-center justify-between mt-auto pt-4">
                                    <div className="flex items-center border border-border">
                                        <button onClick={() => updateQty({ productId: l.productId, colorId: l.colorId, size: l.size }, l.qty - 1)} className="px-3 py-2 hover:bg-bone" aria-label="Diminuir"><Minus className="w-3.5 h-3.5" strokeWidth={1.5} /></button>
                                        <span className="px-4 text-sm">{l.qty}</span>
                                        <button onClick={() => updateQty({ productId: l.productId, colorId: l.colorId, size: l.size }, l.qty + 1, stockFor(l.product, l.colorId, l.size))} className="px-3 py-2 hover:bg-bone" aria-label="Aumentar"><Plus className="w-3.5 h-3.5" strokeWidth={1.5} /></button>
                                    </div>
                                    <span className="text-base font-medium whitespace-nowrap">{formatBRL((l.product.salePrice || l.product.price) * l.qty)}</span>
                                </div>
                            </div>
                        </div>
                    ))}
                    <Link to="/loja" className="btn-ghost link-underline">← Continuar comprando</Link>
                </div>

                {/* summary */}
                <div className="lg:col-span-1 min-w-0">
                    <div className="bg-[hsl(var(--bone))] p-7 space-y-5">
                        <h3 className="text-[11px] uppercase tracking-[0.24em]">Resumo do pedido</h3>

                        {/* coupon */}
                        <form onSubmit={handleApplyCoupon} className="flex gap-2">
                            <div className="flex-1 min-w-0 flex items-center gap-2 border border-border bg-background px-3">
                                <Tag className="w-4 h-4 text-muted-foreground" strokeWidth={1.25} />
                                <input value={couponInput} onChange={(e) => setCouponInput(e.target.value)} placeholder="Cupom de desconto" disabled={couponLoading} className="flex-1 min-w-0 py-3 text-sm bg-transparent focus:outline-none disabled:opacity-50" />
                            </div>
                            <button type="submit" disabled={couponLoading} className="btn-outline px-5 disabled:opacity-50">{couponLoading ? "..." : "Aplicar"}</button>
                        </form>
                        {couponResult?.valid && (
                            <div className="flex items-center justify-between -mt-2">
                                <p className="text-[11px] text-[hsl(var(--gold))]">
                                    Cupom {couponCode} aplicado {couponResult.type === 'percent' ? `(${couponResult.value}% off)` : couponResult.type === 'fixed' ? `(R$ off)` : '(frete grátis)'}
                                </p>
                                <button onClick={() => { clearCoupon(); setCouponInput(""); }} className="text-[11px] text-muted-foreground hover:text-foreground underline">Remover</button>
                            </div>
                        )}

                        {/* shipping */}
                        <form onSubmit={calcFrete} className="flex gap-2">
                            <div className="flex-1 min-w-0 flex items-center gap-2 border border-border bg-background px-3">
                                <Truck className="w-4 h-4 text-muted-foreground" strokeWidth={1.25} />
                                <input value={cep} onChange={(e) => { quoteVersion.current += 1; setCep(e.target.value); setFrete(null); setShippingOptions([]); setShippingLoading(false); }} placeholder="Calcular frete (CEP)" inputMode="numeric" aria-label="CEP para calcular frete" className="flex-1 min-w-0 py-3 text-sm bg-transparent focus:outline-none" />
                            </div>
                            <button type="submit" disabled={shippingLoading} className="btn-outline px-5 disabled:opacity-50">{shippingLoading ? "..." : "OK"}</button>
                        </form>
                        {shippingError && <p role="alert" className="text-xs text-destructive">{shippingError}</p>}
                        {shippingOptions.length > 0 && <div role="radiogroup" aria-label="Opções de frete" className="space-y-2">
                            {shippingOptions.map((option) => <button key={option.id} type="button" role="radio" aria-checked={String(frete?.quoteId) === String(option.id) && shipping !== null}
                                onClick={() => setFrete({ method: "melhor_envio", quoteId: option.id, cost: Number(option.price), contextKey: quoteKey })} className={`w-full text-left border p-3 text-sm min-h-11 ${String(frete?.quoteId) === String(option.id) && shipping !== null ? "border-[hsl(var(--gold))] bg-background" : "border-border"}`}>
                                {option.company} · {option.name} · {freeShippingFromCoupon || isFreeShipping(subtotal - discount) ? "Grátis" : formatBRL(option.price)}
                            </button>)}
                        </div>}

                        <div className="space-y-2.5 pt-4 border-t border-border text-sm">
                            <Row label="Subtotal" value={formatBRL(subtotal)} />
                            {discount > 0 && <Row label="Desconto" value={`- ${formatBRL(discount)}`} accent />}
                            <Row label="Frete" value={shipping === null ? "Informe seu CEP para calcular" : shipping === 0 ? "Grátis" : formatBRL(shipping)} />
                            <div className="flex justify-between pt-4 border-t border-border text-base font-medium">
                                <span>{shipping === null ? "Total parcial" : "Total estimado"}</span>
                                <span>{formatBRL(total)}</span>
                            </div>
                        </div>

                        {(invalidLines.length > 0 || lines.length !== cart.length) && <p role="alert" className="text-xs text-destructive">Há itens indisponíveis ou sem estoque suficiente. Ajuste a sacola para continuar.</p>}
                        <button onClick={handleCheckout} disabled={invalidLines.length > 0 || lines.length !== cart.length} className="btn-gold w-full disabled:opacity-50">Finalizar compra <ArrowRight className="w-4 h-4" strokeWidth={1.5} /></button>
                    </div>
                </div>
            </div>

            <CheckoutAuthModal open={authModalOpen} onClose={() => setAuthModalOpen(false)} />
        </div>
        </div>
    );
}

function Row({ label, value, accent = false }) {
    return (
        <div className="flex justify-between">
            <span className="text-muted-foreground">{label}</span>
            <span className={accent ? "text-[hsl(var(--rose))]" : ""}>{value}</span>
        </div>
    );
}
