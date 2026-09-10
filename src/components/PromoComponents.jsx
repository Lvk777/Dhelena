import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Sparkles, Tag, Truck, ArrowRight } from "lucide-react";

export function useActivePromotions() {
    const [promos, setPromos] = useState([]);
    useEffect(() => {
        fetch("/api/look-promotions")
            .then(r => r.ok ? r.json() : [])
            .then(data => setPromos(data || []))
            .catch(() => {});
    }, []);
    return promos;
}

/**
 * Full-width campaign banner for Home page.
 * Uses the highest priority active promotion.
 */
export function PromotionCampaignBanner() {
    const promos = useActivePromotions();
    if (promos.length === 0) return null;
    const promo = promos[0];
    const color = promo.campaign_color || "#A5925A";

    return (
        <section className="relative overflow-hidden" style={{ backgroundColor: color }}>
            {promo.banner_image && (
                <div className="absolute inset-0 opacity-20">
                    <img src={promo.banner_image} alt="" className="w-full h-full object-cover" />
                </div>
            )}
            <div className="relative container-boutique py-10 sm:py-14 text-center">
                {promo.title && (
                    <p className="text-[11px] uppercase tracking-[0.3em] text-white/80 mb-2">{promo.title}</p>
                )}
                <h2 className="font-heading text-3xl sm:text-5xl tracking-[0.03em] text-white">
                    {promo.subtitle || promo.name}
                </h2>
                {promo.short_text && (
                    <p className="mt-3 text-sm text-white/85 max-w-lg mx-auto">{promo.short_text}</p>
                )}
                {!promo.short_text && (
                    <p className="mt-3 text-sm text-white/85">
                        {promo.min_items > 1 ? `${promo.min_items}+ peças · ` : ""}
                        {Number(promo.discount_percent) > 0 ? `${Number(promo.discount_percent)}% OFF` : ""}
                        {promo.free_shipping ? " · Frete grátis" : ""}
                    </p>
                )}
                <Link
                    to="/monte-seu-look"
                    className="inline-flex items-center gap-2 mt-6 bg-white/15 backdrop-blur-sm border border-white/40 text-white text-[11px] uppercase tracking-[0.22em] px-8 py-4 transition-all duration-500 hover:bg-white hover:text-charcoal"
                >
                    Aproveitar <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
                </Link>
            </div>
        </section>
    );
}

/**
 * Compact promotional card for Monte seu Look sidebar.
 */
export function PromotionLookCard({ promo, currentCount }) {
    if (!promo) return null;
    const color = promo.campaign_color || "#A5925A";
    const hasDiscount = Number(promo.discount_percent) > 0 || Number(promo.discount_fixed) > 0;
    const qualified = currentCount >= (promo.min_items || 0);

    return (
        <div
            className="relative overflow-hidden rounded-lg p-5 mb-4"
            style={{ backgroundColor: color + "15", border: `1px solid ${color}40` }}
        >
            {promo.title && (
                <p className="text-[10px] uppercase tracking-[0.25em] font-medium mb-1" style={{ color }}>
                    {promo.title}
                </p>
            )}
            <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4" style={{ color }} strokeWidth={1.5} />
                <p className="font-heading text-lg tracking-[0.03em]" style={{ color }}>
                    {promo.subtitle || promo.name}
                </p>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
                {promo.short_text || `${promo.min_items}+ peças: ${Number(promo.discount_percent)}% OFF`}
                {promo.free_shipping && " · Frete grátis"}
            </p>
            {!qualified && promo.min_items > 0 && (
                <div className="mt-3 pt-3 border-t" style={{ borderColor: color + "20" }}>
                    <p className="text-[11px] font-medium" style={{ color }}>
                        Faltam {promo.min_items - currentCount} peça(s) para o desconto
                    </p>
                </div>
            )}
            {qualified && hasDiscount && (
                <div className="mt-3 pt-3 border-t" style={{ borderColor: color + "20" }}>
                    <p className="text-[11px] font-medium flex items-center gap-1.5" style={{ color }}>
                        <Tag className="w-3.5 h-3.5" /> Desconto ativo neste look!
                    </p>
                </div>
            )}
        </div>
    );
}

/**
 * Thin promo strip for cart/checkout top.
 */
export function PromotionStrip({ promo }) {
    if (!promo) return null;
    const color = promo.campaign_color || "#A5925A";
    return (
        <div className="flex items-center justify-center gap-2 py-2 px-4 text-center" style={{ backgroundColor: color + "12", borderBottom: `1px solid ${color}30` }}>
            {promo.free_shipping ? <Truck className="w-3.5 h-3.5" style={{ color }} /> : <Sparkles className="w-3.5 h-3.5" style={{ color }} />}
            <span className="text-[11px] font-medium" style={{ color }}>
                {promo.title ? `${promo.title} — ` : ""}{promo.short_text || `${promo.min_items}+ peças: ${Number(promo.discount_percent)}% OFF`}
            </span>
        </div>
    );
}
