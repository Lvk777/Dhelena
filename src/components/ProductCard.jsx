import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Heart } from "lucide-react";
import { useStore } from "@/context/StoreContext";
import { COLOR_SWATCHES, formatBRL, isAvailable } from "@/data/products";

export default function ProductCard({ product, index = 0 }) {
    const { toggleFavorite, isFavorite } = useStore();
    const fav = isFavorite(product.id);
    const price = product.salePrice ?? product.price;
    const soldOut = !isAvailable(product);
    const [selectedColorId, setSelectedColorId] = useState(null);
    const selectedColor = product.colors.find((c) => c.id === selectedColorId);
    const primaryImage = selectedColor?.image || product.images[0];
    const hoverImage = selectedColor?.image || product.images[1] || primaryImage;

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
                        src={primaryImage}
                        alt={product.name}
                        loading="lazy"
                        className="absolute inset-0 w-full h-full object-cover transition-all duration-1000 ease-out group-hover:scale-[1.03] group-hover:opacity-0"
                    />
                    <img
                        src={hoverImage}
                        alt=""
                        aria-hidden="true"
                        loading="lazy"
                        className="absolute inset-0 w-full h-full object-cover opacity-0 transition-all duration-1000 ease-out group-hover:opacity-100 group-hover:scale-[1.03]"
                    />
                </Link>
                <div className="absolute top-3 left-3 flex flex-col gap-1.5">
                    {product.badges.novo && <Badge tone="rose">Novo</Badge>}
                    {product.badges.ultimas && <Badge tone="gold">Últimas peças</Badge>}
                    {product.badges.promocao && <Badge tone="sale">Promo</Badge>}
                </div>
                <button
                    onClick={() => toggleFavorite(product.id)}
                    className="absolute top-3 right-3 w-11 h-11 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center transition-all duration-300 hover:bg-background"
                    aria-label={`Favoritar ${product.name}`}
                    aria-pressed={fav}
                >
                    <Heart className={`w-4 h-4 transition-colors ${fav ? "fill-[hsl(var(--rose))] text-rose-ink" : "text-foreground/70"}`} strokeWidth={1.5} />
                </button>

                {soldOut && (
                    <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
                        <span className="text-[11px] uppercase tracking-[0.3em] text-foreground">Esgotado</span>
                    </div>
                )}
            </div>
            <div className="pt-4 text-center">
                <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">{product.collection}</p>
                <Link to={`/produto/${product.id}`} className="block mt-1.5">
                    <h3 className="text-base font-heading tracking-wide text-foreground hover:text-rose-ink transition-colors">{product.name}</h3>
                </Link>
                <div className="flex items-center justify-center gap-1.5 mt-2.5">
                    {product.colors.map((c) => (
                        <button
                            key={c.id}
                            type="button"
                            onClick={() => setSelectedColorId(c.id)}
                            aria-pressed={selectedColorId === c.id}
                            aria-label={c.name || COLOR_SWATCHES[c.id]?.name || c.id}
                            title={c.name || COLOR_SWATCHES[c.id]?.name}
                            className="w-8 h-8 inline-flex items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                        >
                            <span
                                className={`w-3 h-3 rounded-full border border-border ${selectedColorId === c.id ? "ring-1 ring-foreground ring-offset-2" : ""}`}
                                style={{ background: c.hex || COLOR_SWATCHES[c.id]?.hex }}
                            />
                        </button>
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
                    <p className="text-[11px] text-muted-foreground mt-1">Consulte as formas de pagamento no checkout</p>
                </div>
            </div>
        </div>
    );
}

function Badge({ children, tone }) {
    const tones = {
        rose: "bg-[hsl(var(--rose))] text-white",
        gold: "bg-[hsl(var(--gold))] text-charcoal",
        sale: "bg-[hsl(352_45%_58%)] text-white",
    };
    return <span className={`text-[9px] uppercase tracking-[0.18em] px-2.5 py-1 ${tones[tone]}`}>{children}</span>;
}
