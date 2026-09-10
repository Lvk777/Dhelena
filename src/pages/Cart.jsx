import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Minus, Plus, X, Tag, Truck, ArrowRight } from "lucide-react";
import { useStore } from "@/context/StoreContext";
import { useCatalog } from "@/context/CatalogContext";
import { useAuth } from "@/lib/AuthContext";
import { usePublicSettings } from "@/context/PublicSettingsContext";
import { COLOR_SWATCHES, formatBRL, stockFor } from "@/data/products";
import CheckoutAuthModal from "@/components/CheckoutAuthModal";

export default function Cart() {
    const { cart, removeFromCart, updateQty, showToast, couponCode, couponResult, couponLoading, applyCoupon: applyCouponCtx, clearCoupon } = useStore();
    const { products } = useCatalog();
    const { user } = useAuth();
    const { isFreeShipping } = usePublicSettings();
    const navigate = useNavigate();
    const [couponInput, setCouponInput] = useState("");
    const [cep, setCep] = useState("");
    const [frete, setFrete] = useState(null);
    const [authModalOpen, setAuthModalOpen] = useState(false);

    const handleCheckout = () => {
        if (user) navigate("/checkout");
        else setAuthModalOpen(true);
    };

    const lines = cart.map((i) => ({ ...i, product: products.find((p) => p.id === i.productId) })).filter((l) => l.product);
    const subtotal = lines.reduce((s, l) => s + (l.product.salePrice || l.product.price) * l.qty, 0);
    const discount = couponResult?.valid ? (couponResult.discount || 0) : 0;
    const freeShippingFromCoupon = couponResult?.valid && couponResult.freeShipping;
    const shipping = frete?.valor ?? (freeShippingFromCoupon || isFreeShipping(subtotal) || subtotal === 0 ? 0 : 29.9);
    const total = subtotal - discount + shipping;

    const handleApplyCoupon = async (e) => {
        e.preventDefault();
        const result = await applyCouponCtx(couponInput);
        if (result.valid) showToast("Cupom aplicado ✓");
        else showToast(result.error || "Cupom inválido", 'error');
    };

    const calcFrete = (e) => {
        e.preventDefault();
        if (cep.replace(/\D/g, "").length === 8) setFrete({ valor: 29.9, prazo: "5 a 7 dias úteis" });
    };

    if (lines.length === 0) {
        return (
            <div className="container-boutique py-32 text-center">
                <h1 className="font-heading text-4xl tracking-[0.03em]">Sua sacola</h1>
                <div className="flex justify-center mt-5"><div className="gold-rule" /></div>
                <p className="mt-8 text-muted-foreground">Sua sacola está vazia no momento.</p>
                <Link to="/loja" className="btn-gold mt-8">Explorar a coleção</Link>
            </div>
        );
    }

    return (
        <div className="container-boutique py-14">
            <h1 className="font-heading text-4xl sm:text-5xl tracking-[0.03em] text-center">Sua sacola</h1>
            <div className="flex justify-center mt-5"><div className="gold-rule" /></div>

            <div className="grid lg:grid-cols-3 gap-12 mt-12">
                {/* items */}
                <div className="lg:col-span-2 space-y-6">
                    {lines.map((l) => (
                        <div key={`${l.productId}-${l.colorId}-${l.size}`} className="flex gap-5 pb-6 border-b border-border">
                            <Link to={`/produto/${l.productId}`} className="shrink-0">
                                <img src={l.product.images[0]} alt={l.product.name} className="w-24 h-32 sm:w-28 sm:h-36 object-cover bg-bone" />
                            </Link>
                            <div className="flex-1 flex flex-col">
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
                                    <span className="text-base font-medium">{formatBRL((l.product.salePrice || l.product.price) * l.qty)}</span>
                                </div>
                            </div>
                        </div>
                    ))}
                    <Link to="/loja" className="btn-ghost link-underline">← Continuar comprando</Link>
                </div>

                {/* summary */}
                <div className="lg:col-span-1">
                    <div className="bg-[hsl(var(--bone))] p-7 space-y-5">
                        <h3 className="text-[11px] uppercase tracking-[0.24em]">Resumo do pedido</h3>

                        {/* coupon */}
                        <form onSubmit={handleApplyCoupon} className="flex gap-2">
                            <div className="flex-1 flex items-center gap-2 border border-border bg-background px-3">
                                <Tag className="w-4 h-4 text-muted-foreground" strokeWidth={1.25} />
                                <input value={couponInput} onChange={(e) => setCouponInput(e.target.value)} placeholder="Cupom de desconto" disabled={couponLoading} className="flex-1 py-3 text-sm bg-transparent focus:outline-none disabled:opacity-50" />
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
                            <div className="flex-1 flex items-center gap-2 border border-border bg-background px-3">
                                <Truck className="w-4 h-4 text-muted-foreground" strokeWidth={1.25} />
                                <input value={cep} onChange={(e) => setCep(e.target.value)} placeholder="Calcular frete (CEP)" className="flex-1 py-3 text-sm bg-transparent focus:outline-none" />
                            </div>
                            <button type="submit" className="btn-outline px-5">OK</button>
                        </form>

                        <div className="space-y-2.5 pt-4 border-t border-border text-sm">
                            <Row label="Subtotal" value={formatBRL(subtotal)} />
                            {discount > 0 && <Row label="Desconto" value={`- ${formatBRL(discount)}`} accent />}
                            <Row label="Frete" value={shipping === 0 ? "Grátis" : formatBRL(shipping)} />
                            <div className="flex justify-between pt-4 border-t border-border text-base font-medium">
                                <span>Total</span>
                                <span>{formatBRL(total)}</span>
                            </div>
                        </div>

                        <button onClick={handleCheckout} className="btn-gold w-full">Finalizar compra <ArrowRight className="w-4 h-4" strokeWidth={1.5} /></button>
                    </div>
                </div>
            </div>

            <CheckoutAuthModal open={authModalOpen} onClose={() => setAuthModalOpen(false)} />
        </div>
    );
}

function Row({ label, value, accent }) {
    return (
        <div className="flex justify-between">
            <span className="text-muted-foreground">{label}</span>
            <span className={accent ? "text-[hsl(var(--rose))]" : ""}>{value}</span>
        </div>
    );
}