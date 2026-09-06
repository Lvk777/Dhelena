import React from "react";
import { Link } from "react-router-dom";
import { X, Plus, Minus, ShoppingBag } from "lucide-react";
import { useStore } from "@/context/StoreContext";
import { useCatalog } from "@/context/CatalogContext";
import { COLOR_SWATCHES, formatBRL, stockFor } from "@/data/products";

export default function CartDrawer() {
    const { cart, cartOpen, setCartOpen, removeFromCart, updateQty } = useStore();
    const { products } = useCatalog();

    const lines = cart.map((item) => {
        const product = products.find((p) => p.id === item.productId);
        return { ...item, product };
    }).filter((l) => l.product);

    const subtotal = lines.reduce((s, l) => s + (l.product.salePrice || l.product.price) * l.qty, 0);

    return (
        <>
            {cartOpen && (
                <div className="fixed inset-0 z-[70]">
                    <div className="absolute inset-0 bg-charcoal/30 backdrop-blur-sm animate-fade-in" onClick={() => setCartOpen(false)} />
                    <div className="absolute right-0 top-0 h-full w-full max-w-md bg-background shadow-2xl flex flex-col animate-fade-in">
                        {/* header */}
                        <div className="flex items-center justify-between px-6 h-16 border-b border-border">
                            <h3 className="text-[11px] uppercase tracking-[0.24em]">Sua sacola ({lines.length})</h3>
                            <button onClick={() => setCartOpen(false)} aria-label="Fechar"><X className="w-5 h-5" strokeWidth={1.25} /></button>
                        </div>

                        {lines.length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-4">
                                <ShoppingBag className="w-10 h-10 text-muted-foreground/40" strokeWidth={1} />
                                <p className="text-sm text-muted-foreground">Sua sacola está vazia.</p>
                                <Link to="/loja" onClick={() => setCartOpen(false)} className="btn-outline">Explorar coleção</Link>
                            </div>
                        ) : (
                            <>
                                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
                                    {lines.map((l, idx) => (
                                        <div key={`${l.productId}-${l.colorId}-${l.size}`} className="flex gap-4 animate-fade-rise" style={{ animationDelay: `${idx * 60}ms` }}>
                                            <Link to={`/produto/${l.productId}`} onClick={() => setCartOpen(false)} className="shrink-0">
                                                <img src={l.product.images[0]} alt={l.product.name} className="w-20 h-28 object-cover bg-bone" />
                                            </Link>
                                            <div className="flex-1 flex flex-col">
                                                <div className="flex justify-between gap-2">
                                                    <div>
                                                        <p className="text-sm font-medium">{l.product.name}</p>
                                                        <p className="text-[11px] text-muted-foreground mt-0.5">
                                                            {l.product.colors.find((c) => c.id === l.colorId)?.name || COLOR_SWATCHES[l.colorId]?.name} · Tam {l.size}
                                                        </p>
                                                    </div>
                                                    <button onClick={() => removeFromCart({ productId: l.productId, colorId: l.colorId, size: l.size })} className="text-muted-foreground hover:text-foreground" aria-label="Remover">
                                                        <X className="w-4 h-4" strokeWidth={1.25} />
                                                    </button>
                                                </div>
                                                <div className="flex items-center justify-between mt-auto pt-3">
                                                    <div className="flex items-center border border-border">
                                                        <button onClick={() => updateQty({ productId: l.productId, colorId: l.colorId, size: l.size }, l.qty - 1)} className="px-2 py-1.5 hover:bg-bone" aria-label="Diminuir"><Minus className="w-3 h-3" strokeWidth={1.5} /></button>
                                                        <span className="px-3 text-sm">{l.qty}</span>
                                                        <button onClick={() => updateQty({ productId: l.productId, colorId: l.colorId, size: l.size }, l.qty + 1, stockFor(l.product, l.colorId, l.size))} className="px-2 py-1.5 hover:bg-bone" aria-label="Aumentar"><Plus className="w-3 h-3" strokeWidth={1.5} /></button>
                                                    </div>
                                                    <span className="text-sm font-medium">{formatBRL((l.product.salePrice || l.product.price) * l.qty)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* footer */}
                                <div className="border-t border-border px-6 py-5 space-y-4">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">Subtotal</span>
                                        <span className="font-medium">{formatBRL(subtotal)}</span>
                                    </div>
                                    <p className="text-[11px] text-muted-foreground">Frete e descontos calculados na finalização.</p>
                                    <Link to="/sacola" onClick={() => setCartOpen(false)} className="btn-gold w-full">Finalizar compra</Link>
                                    <button onClick={() => setCartOpen(false)} className="btn-ghost w-full">Continuar comprando</button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}