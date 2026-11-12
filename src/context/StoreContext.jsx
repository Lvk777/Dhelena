import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
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
    const account = user?.id || null;
    const currentAccount = useRef(account);
    currentAccount.current = account;
    const favoriteFlight = useRef(false);
    const [cart, setCart] = useState(() => load("dh_cart", []));
    const [favorites, setFavorites] = useState([]);
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
        let active = true;
        setFavorites([]); setCouponCode(''); setCouponResult(null);
        // An unscoped cache must never import another customer's favorites.
        localStorage.removeItem('dh_favorites');
        if (isAuthenticated && account) base44.entities.Favorite.list().then(recs => {
            if (active && currentAccount.current === account) setFavorites((recs || []).map(r => r.product_id));
        }).catch(() => { if (active) setToast({ message: 'Não foi possível consultar seus favoritos.', type: 'error', id: Date.now() }); });
        return () => { active = false; };
    }, [isAuthenticated, account]);

    const showToast = useCallback((message, type = 'success') => {
        setToast({ message, type, id: Date.now() });
        setTimeout(() => setToast(null), 2600);
    }, []);

    const addToCart = useCallback((item, maxQty) => {
        if (maxQty != null && maxQty <= 0) return;
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
        if (maxQty != null && maxQty <= 0) return removeFromCart(key);
        const capped = maxQty != null ? Math.min(qty, maxQty) : qty;
        setCart((prev) => prev.map((i) =>
            (i.productId === key.productId && i.colorId === key.colorId && i.size === key.size) ? { ...i, qty: capped } : i
        ));
    }, [removeFromCart]);

    const clearCart = useCallback(() => setCart([]), []);

    const toggleFavorite = useCallback(async (productId) => {
        if (!isAuthenticated) {
            showToast("Faça login para salvar seus favoritos ♡");
            return;
        }
        if (favoriteFlight.current) return;
        favoriteFlight.current = true;
        try {
            if (favorites.includes(productId)) {
                const recs = await base44.entities.Favorite.filter({ product_id: productId });
                if (currentAccount.current !== account) return;
                for (const rec of recs) { if (currentAccount.current !== account) return; await base44.entities.Favorite.delete(rec.id); }
                if (currentAccount.current === account) { setFavorites(prev => prev.filter(id => id !== productId)); showToast('Removido dos favoritos'); }
            } else {
                await base44.entities.Favorite.create({ product_id: productId });
                if (currentAccount.current === account) { setFavorites(prev => [...prev, productId]); showToast('Adicionado aos favoritos ♡'); }
            }
            track('favorite', { product_id: productId });
        } catch { if (currentAccount.current === account) showToast('Não foi possível atualizar os favoritos.', 'error'); }
        finally { favoriteFlight.current = false; }
    }, [isAuthenticated, account, favorites, showToast]);

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
