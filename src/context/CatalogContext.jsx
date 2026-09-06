import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { COLOR_SWATCHES, SIZES_LIST } from "@/data/products";

const CatalogContext = createContext(null);

// Transform a DB product record into the frontend format the pages expect.
export const dbToProduct = (p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku || "",
    category: p.category || "",
    subcategory: p.subcategory || "",
    collection: p.collection || "",
    description: p.description || "",
    short_description: p.short_description || "",
    details: p.details || "",
    price: p.price || 0,
    salePrice: p.sale_price ?? null,
    cost: p.cost_price ?? 0,
    installments: p.installments ?? 6,
    images: p.images || [],
    colors: (p.colors || []).map((c) => ({
        id: c.id,
        name: c.name || COLOR_SWATCHES[c.id]?.name || c.id,
        hex: c.hex || COLOR_SWATCHES[c.id]?.hex || "#cccccc",
        image: c.image || "",
        stock: c.stock || {},
    })),
    sizes: p.sizes && p.sizes.length ? p.sizes : SIZES_LIST,
    badges: p.badges || { novo: false, destaque: false, maisVendido: false, promocao: false, ultimas: false, exclusivo: false },
    composition: p.composition || "",
    modeling: p.modeling || "",
    length: p.length || "",
    lining: p.lining || "",
    transparency: p.transparency || "",
    elasticity: p.elasticity || "",
    care: p.care || "",
    measurements: p.measurements || "",
    weight: p.weight ?? 0,
    package_height: p.package_height ?? 0,
    package_width: p.package_width ?? 0,
    package_length: p.package_length ?? 0,
    status: p.status || "published",
    rating: p.rating ?? 5,
    soldCount: p.sold_count ?? 0,
    created_date: p.created_date,
});

export function CatalogProvider({ children }) {
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [collections, setCollections] = useState([]);
    const [banners, setBanners] = useState([]);
    const [loading, setLoading] = useState(true);

    const loadAll = useCallback(async () => {
        setLoading(true);
        try {
            const [prodRes, catRes, colRes, banRes] = await Promise.all([
                base44.entities.Product.list("-created_date", 200).catch(() => []),
                base44.entities.Category.list("sort_order", 100).catch(() => []),
                base44.entities.Collection.list("sort_order", 100).catch(() => []),
                base44.entities.Banner.filter({ active: true }, "sort_order", 20).catch(() => []),
            ]);
            setProducts((prodRes || []).map(dbToProduct));
            setCategories(catRes || []);
            setCollections(colRes || []);
            setBanners(banRes || []);
        } catch (e) {
            console.error("Catalog load error:", e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadAll(); }, [loadAll]);

    // Only published products are shown in the public store
    const publishedProducts = products.filter((p) => p.status === "published");

    const getProductById = useCallback((id) => products.find((p) => p.id === id), [products]);

    const getRelated = useCallback((product, limit = 4) =>
        products.filter((p) => p.category === product?.category && p.id !== product?.id && p.status === "published").slice(0, limit),
        [products]);

    const getCompleteLook = useCallback((product) =>
        products.filter((p) => p.id !== product?.id && p.category !== product?.category && p.status === "published").slice(0, 3),
        [products]);

    return (
        <CatalogContext.Provider
            value={{
                products: publishedProducts,
                allProducts: products,
                categories,
                collections,
                banners,
                loading,
                reload: loadAll,
                getProductById,
                getRelated,
                getCompleteLook,
            }}
        >
            {children}
        </CatalogContext.Provider>
    );
}

export const useCatalog = () => {
    const ctx = useContext(CatalogContext);
    if (!ctx) throw new Error("useCatalog must be used within CatalogProvider");
    return ctx;
};