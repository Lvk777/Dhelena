import React from "react";
import { Link } from "react-router-dom";
import { Heart } from "lucide-react";
import { useStore } from "@/context/StoreContext";
import { COLOR_SWATCHES, formatBRL, installmentValue, isAvailable } from "@/data/products";

export default function ProductCard({ product, index = 0 }) {
    const { toggleFavorite, isFavorite } = useStore();
    const fav = isFavorite(product.id);
    const price = product.salePrice ?? product.price;
    const soldOut = !isAvailable(product);

    return (
        <div
            className="group reveal"
            style={{ transitionDelay: `${(index % 4) * 80}ms` }}
            ref={(el) => {
                if (!el) return;
                const obs = new IntersectionObserver(([e]) => {
                    if (e.isIntersecting) { el.classList.add("is-visible"); obs.unobserve(el); }
                }, { threshold: 0.1 });
                obs.observe(el);
            }}
        >
            <div className="relative overflow-hidden bg-bone aspect-[3/4]">
                <Link to={`/produto/${product.id}`}>
                    <img
                        src={product.images[0]}
                        alt={product.name}
                        className="absolute inset-0 w-full h-full object-cover transition-all duration-1000 ease-out group-hover:scale-[1.03] group-hover:opacity-0"
                    />
                    <img
                        src={product.images[1] || product.images[0]}
                        alt={`${product.name} — detalhe`}
                        className="absolute inset-0 w-full h-full object-cover opacity-0 transition-all duration-1000 ease-out group-hover:opacity-100 group-hover:scale-[1.03]"
                    />
                </Link>

                {/* badges */}
                <div className="absolute top-3 left-3 flex flex-col gap-1.5">
                    {product.badges.novo && <Badge tone="gold">Novo</Badge>}
                    {product.badges.ultimas && <Badge tone="rose">Últimas peças</Badge>}
                    {product.badges.promocao && <Badge tone="sale">Promo</Badge>}
                </div>

                {/* favorite */}
                <button
                    onClick={() => toggleFavorite(product.id)}
                    className="absolute top-3 right-3 w-9 h-9 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center transition-all duration-300 hover:bg-background"
                    aria-label="Favoritar"
                >
                    <Heart className={`w-4 h-4 transition-colors ${fav ? "fill-[hsl(var(--rose))] text-[hsl(var(--rose))]" : "text-foreground/70"}`} strokeWidth={1.5} />
                </button>

                {soldOut && (
                    <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
                        <span className="text-[11px] uppercase tracking-[0.3em] text-foreground">Esgotado</span>
                    </div>
                )}
            </div>

            {/* info */}
            <div className="pt-4 text-center">
                <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">{product.collection}</p>
                <Link to={`/produto/${product.id}`} className="block mt-1.5">
                    <h3 className="text-base font-heading tracking-wide text-foreground hover:text-[hsl(var(--rose))] transition-colors">{product.name}</h3>
                </Link>

                {/* color swatches */}
                <div className="flex items-center justify-center gap-1.5 mt-2.5">
                    {product.colors.map((c) => (
                        <span key={c.id} className="w-3 h-3 rounded-full border border-border" style={{ background: c.hex || COLOR_SWATCHES[c.id]?.hex }} title={c.name || COLOR_SWATCHES[c.id]?.name} />
                    ))}
                </div>

                <div className="mt-3">
                    {product.salePrice ? (
                        <p className="text-sm">
                            <span className="text-muted-foreground line-through mr-2">{formatBRL(product.price)}</span>
                            <span className="font-medium text-foreground">{formatBRL(product.salePrice)}</span>
                        </p>
                    ) : (
                        <p className="text-sm font-medium text-foreground">{formatBRL(product.price)}</p>
                    )}
                    <p className="text-[11px] text-muted-foreground mt-1">ou {product.installments}x de {formatBRL(installmentValue(price, product.installments))}</p>
                </div>
            </div>
        </div>
    );
}

function Badge({ children, tone }) {
    const tones = {
        gold: "bg-[hsl(var(--gold))] text-white",
        rose: "bg-[hsl(var(--rose))] text-white",
        sale: "bg-charcoal text-bone",
    };
    return <span className={`text-[9px] uppercase tracking-[0.18em] px-2.5 py-1 ${tones[tone]}`}>{children}</span>;
}