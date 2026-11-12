import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";

const PublicSettingsContext = createContext(null);

const DEFAULTS = {
    general: { store_name: "D'Helenas", trade_name: "", company_name: "", cnpj: "", email: "", phone: "", whatsapp: "", logo: "", logo_dark: "", public_address: "", business_hours: "", external_link_origins: [] },
    store: { top_bar_text: "", free_shipping_threshold: null, max_installments: null, interest_free_installments: null },
    shipping: { free_shipping_enabled: false, free_shipping_threshold: null, pickup_enabled: false, pickup_name: "Retirada", pickup_address: "", pickup_instructions: "", pickup_time: "" },
    social: { instagram: "", facebook: "", tiktok: "", whatsapp: "" },
    policies: { return_policy: "", privacy_policy: "", terms_of_use: "", shipping_policy: "" },
    maintenance: { maintenance_mode: false },
};

export function PublicSettingsProvider({ children }) {
    const [settings, setSettings] = useState(DEFAULTS);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const records = await base44.app.listPublicSettings();
            const data = /** @type {Record<string, any>} */ ({});
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
            const merged = /** @type {any} */ ({});
            for (const key of Object.keys(DEFAULTS)) {
                merged[key] = { ...DEFAULTS[key], ...(data[key] || {}) };
            }
            setSettings(merged);
            setError(false);
        } catch {
            // Maintenance state is unknown: do not open the storefront on defaults.
            setError(true);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // Helper: free shipping threshold (uses shipping config, falls back to store config)
    const configuredThreshold = Number(settings.shipping?.free_shipping_threshold);
    const freeShippingThreshold = settings.shipping?.free_shipping_enabled === true
        && Number.isFinite(configuredThreshold) && configuredThreshold > 0
        ? configuredThreshold : null;

    // Helper: is free shipping available for a given subtotal?
    const isFreeShipping = useCallback((subtotal) => {
        if (!settings.shipping?.free_shipping_enabled) return false;
        const threshold = freeShippingThreshold;
        return threshold != null && subtotal >= threshold;
    }, [settings.shipping, freeShippingThreshold]);

    return (
        <PublicSettingsContext.Provider value={{ settings, loading, error, reload: load, freeShippingThreshold, isFreeShipping }}>
            {children}
        </PublicSettingsContext.Provider>
    );
}

export const usePublicSettings = () => {
    const ctx = useContext(PublicSettingsContext);
    if (!ctx) throw new Error("usePublicSettings must be used within PublicSettingsProvider");
    return ctx;
};
