import React from "react";
import { Link } from "react-router-dom";
import { Heart } from "lucide-react";
import { useStore } from "@/context/StoreContext";
import { useCatalog } from "@/context/CatalogContext";
import ProductCard from "@/components/ProductCard";

export default function Favorites() {
    const { favorites } = useStore();
    const { products, loading } = useCatalog();
    const items = products.filter((p) => favorites.includes(p.id));

    return (
        <div className="container-boutique py-14">
            <h1 className="font-heading text-4xl sm:text-5xl tracking-[0.03em] text-center">Favoritos</h1>
            <div className="flex justify-center mt-5"><div className="gold-rule" /></div>

            {loading ? (
                <div className="py-24 text-center"><div className="w-8 h-8 border-4 border-[hsl(var(--bone))] border-t-[hsl(var(--gold))] rounded-full animate-spin mx-auto" /></div>
            ) : items.length === 0 ? (
                <div className="py-24 text-center">
                    <Heart className="w-10 h-10 text-muted-foreground/40 mx-auto" strokeWidth={1} />
                    <p className="mt-5 text-muted-foreground">Você ainda não favoritou nenhuma peça.</p>
                    <Link to="/loja" className="btn-outline mt-6">Explorar a coleção</Link>
                </div>
            ) : (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-6 mt-12">
                    {items.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
                </div>
            )}
        </div>
    );
}