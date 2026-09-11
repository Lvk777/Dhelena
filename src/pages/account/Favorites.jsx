import React from "react";
import { Link } from "react-router-dom";
import { Heart } from "lucide-react";
import { useStore } from "@/context/StoreContext";
import { useCatalog } from "@/context/CatalogContext";
import ProductCard from "@/components/ProductCard";

export default function AccountFavorites() {
    const { favorites } = useStore();
    const { products } = useCatalog();
    const favProducts = products.filter((p) => favorites.includes(p.id));

    return (
        <div>
            <h1 className="font-heading text-3xl tracking-[0.03em] mb-6">Meus favoritos</h1>

            {favProducts.length === 0 ? (
                <div className="bg-[hsl(var(--bone))] p-12 text-center">
                    <Heart className="w-10 h-10 text-muted-foreground/40 mx-auto mb-4" strokeWidth={1} />
                    <p className="text-sm text-muted-foreground">Você ainda não favoritou nenhuma peça.</p>
                    <Link to="/loja" className="btn-outline mt-5 inline-flex">Explorar a coleção</Link>
                </div>
            ) : (
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-5">
                    {favProducts.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
                </div>
            )}
        </div>
    );
}