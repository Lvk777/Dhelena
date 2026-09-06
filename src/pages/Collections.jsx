import React from "react";
import { Link } from "react-router-dom";
import { useCatalog } from "@/context/CatalogContext";
import { CATEGORY_IMAGES } from "@/data/products";

export default function Collections() {
    const { collections, products, loading } = useCatalog();
    const fallbackImages = [CATEGORY_IMAGES.vestidos, CATEGORY_IMAGES.conjuntos, CATEGORY_IMAGES.acessorios];

    if (loading) return <div className="h-screen flex items-center justify-center"><div className="w-8 h-8 border-4 border-[hsl(var(--bone))] border-t-[hsl(var(--gold))] rounded-full animate-spin" /></div>;

    return (
        <div>
            <div className="bg-[hsl(var(--bone))] py-16 sm:py-20 text-center">
                <div className="container-boutique">
                    <p className="eyebrow">Curadoria</p>
                    <h1 className="mt-3 font-heading text-5xl sm:text-6xl tracking-[0.03em]">Coleções</h1>
                    <div className="flex justify-center mt-5"><div className="gold-rule" /></div>
                    <p className="mt-5 text-muted-foreground max-w-xl mx-auto leading-relaxed">
                        Cada coleção é um capítulo da história D'Helenas — pensada para atravessar gerações.
                    </p>
                </div>
            </div>

            <div className="container-boutique py-16 space-y-16">
                {collections.map((col, i) => {
                    const items = products.filter((p) => p.collection === col.name).slice(0, 3);
                    const img = col.image || fallbackImages[i] || fallbackImages[0];
                    return (
                        <div key={col.id} className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
                            <div className={`relative overflow-hidden aspect-[4/3] ${i % 2 ? "lg:order-2" : ""}`}>
                                <img src={img} alt={col.name} className="w-full h-full object-cover" />
                                <div className="absolute inset-0 bg-charcoal/15" />
                            </div>
                            <div className={i % 2 ? "lg:order-1" : ""}>
                                <p className="eyebrow">Coleção {String(i + 1).padStart(2, "0")}</p>
                                <h2 className="mt-3 font-heading text-4xl sm:text-5xl tracking-[0.03em]">{col.name}</h2>
                                <div className="gold-rule mt-5" />
                                <p className="mt-6 text-muted-foreground leading-relaxed max-w-md">{col.description}</p>
                                <div className="mt-8 space-y-3">
                                    {items.map((p) => (
                                        <Link key={p.id} to={`/produto/${p.id}`} className="flex items-center gap-3 group">
                                            <img src={p.images[0]} alt={p.name} className="w-12 h-16 object-cover bg-bone" />
                                            <div>
                                                <p className="text-sm font-medium group-hover:text-[hsl(var(--rose))] transition-colors">{p.name}</p>
                                                <p className="text-[11px] text-muted-foreground">{p.category}</p>
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                                <Link to={`/loja`} className="btn-ghost mt-8 link-underline">Ver peças desta coleção →</Link>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}