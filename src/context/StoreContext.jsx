import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { track } from "@/lib/analytics";

const StoreContext = createContext(null);

const load = (key, fallback) => {
    try {
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : fallback;
    } catch {
        return fallback;
    }
};

export function StoreProvider({ children }) {
    const { user, isAuthenticated } = useAuth();
    const [cart, setCart] = useState(() => load("dh_cart", []));
    const [favorites, setFavorites] = useState(() => load("dh_favorites", []));
    const [toast, setToast] = useState(null);
    const [cartOpen, setCartOpen] = useState(false);
    const [couponCode, setCouponCode] = useState("");
    const [couponResult, setCouponResult] = useState(null);
    const [couponLoading, setCouponLoading] = useState(false);

    useEffect(() => { localStorage.setItem("dh_cart", JSON.stringify(cart)); }, [cart]);

    // Limpar cupom quando o carrinho muda (para evitar desconto stale)
    useEffect(() => {
        setCouponCode("");
        setCouponResult(null);
    }, [cart]);

    // Sync favorites with DB when auth state changes
    useEffect(() => {
        if (isAuthenticated && user) {
            const localFavs = load("dh_favorites", []);
            base44.entities.Favorite.list().then(async (recs) => {
                const dbIds = (recs || []).map((r) => r.product_id);
                const toAdd = localFavs.filter((id) => !dbIds.includes(id));
                if (toAdd.length > 0) {
                    await base44.entities.Favorite.bulkCreate(toAdd.map((product_id) => ({ product_id })));
                    localStorage.removeItem("dh_favorites");
                }
                setFavorites([...dbIds, ...toAdd]);
            }).catch(() => setFavorites(localFavs));
        } else {
            setFavorites(load("dh_favorites", []));
        }
    }, [isAuthenticated, user]);

    useEffect(() => {
        if (!isAuthenticated) {
            localStorage.setItem("dh_favorites", JSON.stringify(favorites));
        }
    }, [favorites, isAuthenticated]);

    const showToast = useCallback((message) => {
        setToast({ message, id: Date.now() });
        setTimeout(() => setToast(null), 2600);
    }, []);

    const addToCart = useCallback((item, maxQty) => {
        setCart((prev) => {
            const idx = prev.findIndex((i) => i.productId === item.productId && i.colorId === item.colorId && i.size === item.size);
            if (idx >= 0) {
                const next = [...prev];
                const newQty = maxQty != null ? Math.min(next[idx].qty + (item.qty || 1), maxQty) : next[idx].qty + (item.qty || 1);
                next[idx] = { ...next[idx], qty: newQty };
                return next;
            }
            const initialQty = maxQty != null ? Math.min(item.qty || 1, maxQty) : item.qty || 1;
            return [...prev, { ...item, qty: initialQty }];
        });
        track('add_to_cart', { product_id: item.productId });
        showToast("Adicionado à sacola ✓");
    }, [showToast]);

    const removeFromCart = useCallback((key) => {
        setCart((prev) => prev.filter((i) => !(i.productId === key.productId && i.colorId === key.colorId && i.size === key.size)));
    }, []);

    const updateQty = useCallback((key, qty, maxQty) => {
        if (qty <= 0) return removeFromCart(key);
        const capped = maxQty != null ? Math.min(qty, maxQty) : qty;
        setCart((prev) => prev.map((i) =>
            (i.productId === key.productId && i.colorId === key.colorId && i.size === key.size) ? { ...i, qty: capped } : i
        ));
    }, [removeFromCart]);

    const clearCart = useCallback(() => setCart([]), []);

    const toggleFavorite = useCallback((productId) => {
        if (!isAuthenticated) {
            showToast("Faça login para salvar seus favoritos ♡");
            return;
        }
        setFavorites((prev) => {
            if (prev.includes(productId)) {
                base44.entities.Favorite.filter({ product_id: productId }).then((recs) => {
                    recs.forEach((r) => base44.entities.Favorite.delete(r.id));
                });
                track('favorite', { product_id: productId });
                showToast("Removido dos favoritos");
                return prev.filter((id) => id !== productId);
            } else {
                base44.entities.Favorite.create({ product_id: productId });
                showToast("Adicionado aos favoritos ♡");
                return [...prev, productId];
            }
        });
    }, [isAuthenticated, showToast]);

    const isFavorite = useCallback((productId) => favorites.includes(productId), [favorites]);
    const cartCount = cart.reduce((s, i) => s + i.qty, 0);

    const applyCoupon = useCallback(async (code) => {
        if (!code || !code.trim()) return { valid: false, error: "Informe um cupom" };
        setCouponLoading(true);
        try {
            const res = await base44.functions.invoke('validateCoupon', {
                code,
                items: cart.map((i) => ({ productId: i.productId, qty: i.qty })),
            });
            const result = res.data || res;
            if (result.valid) {
                setCouponCode(result.code || code.toUpperCase().trim());
                setCouponResult(result);
                return result;
            }
            setCouponCode("");
            setCouponResult(null);
            return { valid: false, error: result.error || "Cupom inválido" };
        } catch (e) {
            setCouponCode("");
            setCouponResult(null);
            const msg = e.response?.data?.error || e.data?.error || e.message || "Cupom inválido";
            return { valid: false, error: msg };
        } finally {
            setCouponLoading(false);
        }
    }, [cart]);

    const clearCoupon = useCallback(() => {
        setCouponCode("");
        setCouponResult(null);
    }, []);

    return (
        <StoreContext.Provider
            value={{
                cart, favorites, cartCount, toast, cartOpen,
                setCartOpen, addToCart, removeFromCart, updateQty, clearCart,
                toggleFavorite, isFavorite, showToast,
                couponCode, couponResult, couponLoading, applyCoupon, clearCoupon,
            }}
        >
            {children}
        </StoreContext.Provider>
    );
}

export const useStore = () => {
    const ctx = useContext(StoreContext);
    if (!ctx) throw new Error("useStore must be used within StoreProvider");
    return ctx;
};