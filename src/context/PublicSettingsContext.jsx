import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";

const PublicSettingsContext = createContext(null);

const DEFAULTS = {
    general: { store_name: "D'Helenas", trade_name: "", email: "", phone: "", whatsapp: "", logo: "", logo_dark: "" },
    store: { top_bar_text: "Frete grátis acima de R$ 499 · Parcelamos em até 6x sem juros", free_shipping_threshold: 499, max_installments: 6, interest_free_installments: 6 },
    shipping: { free_shipping_enabled: true, free_shipping_threshold: 499, pickup_enabled: true, pickup_name: "Retirada no estoque" },
    social: { instagram: "", facebook: "", tiktok: "", whatsapp: "" },
    policies: { return_policy: "", privacy_policy: "", terms_of_use: "", shipping_policy: "" },
    maintenance: { maintenance_mode: false },
};

export function PublicSettingsProvider({ children }) {
    const [settings, setSettings] = useState(DEFAULTS);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        try {
            const records = await base44.entities.Setting.filter({ is_public: true });
            const data = {};
            (records || []).forEach((r) => {
                // DTO allowlist: extrair APENAS campos definidos em DEFAULTS para esta key
                // Evita vazar campos privados que possam ser adicionados futuramente ao mesmo registro
                const allowedFields = DEFAULTS[r.key];
                if (allowedFields && r.value) {
                    const filtered = {};
                    for (const field of Object.keys(allowedFields)) {
                        if (r.value[field] !== undefined) {
                            filtered[field] = r.value[field];
                        }
                    }
                    data[r.key] = filtered;
                }
            });
            const merged = {};
            for (const key of Object.keys(DEFAULTS)) {
                merged[key] = { ...DEFAULTS[key], ...(data[key] || {}) };
            }
            setSettings(merged);
        } catch {
            // keep defaults
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // Helper: free shipping threshold (uses shipping config, falls back to store config)
    const freeShippingThreshold = settings.shipping?.free_shipping_enabled
        ? (settings.shipping?.free_shipping_threshold ?? settings.store?.free_shipping_threshold ?? 499)
        : null;

    // Helper: is free shipping available for a given subtotal?
    const isFreeShipping = useCallback((subtotal) => {
        if (!settings.shipping?.free_shipping_enabled) return false;
        const threshold = freeShippingThreshold;
        return threshold != null && subtotal >= threshold;
    }, [settings.shipping, freeShippingThreshold]);

    return (
        <PublicSettingsContext.Provider value={{ settings, loading, reload: load, freeShippingThreshold, isFreeShipping }}>
            {children}
        </PublicSettingsContext.Provider>
    );
}

export const usePublicSettings = () => {
    const ctx = useContext(PublicSettingsContext);
    if (!ctx) throw new Error("usePublicSettings must be used within PublicSettingsProvider");
    return ctx;
};