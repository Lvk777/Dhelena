import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Sparkles, Tag, Truck, ArrowRight, Check } from "lucide-react";

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
 * The discount percentage is the strongest visual element.
 */
export function PromotionCampaignBanner() {
    const promos = useActivePromotions();
    if (promos.length === 0) return null;
    const promo = promos[0];
    const color = promo.campaign_color || "#A5925A";
    const hasPercent = Number(promo.discount_percent) > 0;

    return (
        <section className="relative overflow-hidden" style={{ backgroundColor: color }}>
            {promo.banner_image && (
                <div className="absolute inset-0 opacity-15">
                    <img src={promo.banner_image} alt="" className="w-full h-full object-cover" />
                </div>
            )}
            <div className="relative container-boutique py-12 sm:py-16 text-center">
                {promo.title && (
                    <p className="text-[11px] uppercase tracking-[0.3em] text-white/75 mb-3">{promo.title}</p>
                )}
                {/* Percentage — the strongest visual element */}
                {hasPercent && (
                    <div className="flex items-baseline justify-center gap-2 mb-2">
                        <span className="font-heading text-7xl sm:text-8xl lg:text-9xl tracking-[0.02em] text-white leading-none">
                            {Number(promo.discount_percent)}
                        </span>
                        <span className="font-heading text-3xl sm:text-4xl text-white/80">% OFF</span>
                    </div>
                )}
                {/* Subtitle / campaign name */}
                <h2 className="font-heading text-2xl sm:text-3xl tracking-[0.03em] text-white italic">
                    {promo.subtitle || promo.name}
                </h2>
                {promo.short_text && (
                    <p className="mt-4 text-sm text-white/80 max-w-lg mx-auto leading-relaxed">{promo.short_text}</p>
                )}
                {promo.free_shipping && !hasPercent && (
                    <p className="mt-4 text-sm text-white/85">Frete grátis especial</p>
                )}
                <Link
                    to="/monte-seu-look"
                    className="inline-flex items-center gap-2 mt-8 bg-white/15 backdrop-blur-sm border border-white/40 text-white text-[11px] uppercase tracking-[0.22em] px-8 py-4 transition-all duration-500 hover:bg-white hover:text-charcoal"
                >
                    Aproveitar <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
                </Link>
            </div>
        </section>
    );
}

/**
 * Promotional card for Monte seu Look sidebar.
 * Shows progressive messages based on item count.
 */
export function PromotionLookCard({ promo, currentCount }) {
    if (!promo) return null;
    const color = promo.campaign_color || "#A5925A";
    const minItems = promo.min_items || 3;
    const discountPercent = Number(promo.discount_percent) || 0;
    const hasDiscount = discountPercent > 0 || Number(promo.discount_fixed) > 0;
    const qualified = currentCount >= minItems;
    const remaining = minItems - currentCount;

    // Progressive message
    let progressMessage = "";
    if (currentCount === 0) {
        progressMessage = `Adicione ${minItems} peças para ganhar ${discountPercent}% OFF`;
    } else if (remaining > 1) {
        progressMessage = `Faltam ${remaining} peças`;
    } else if (remaining === 1) {
        progressMessage = `Falta 1 peça`;
    } else {
        progressMessage = `Seu desconto de ${discountPercent}% foi ativado`;
    }

    return (
        <div
            className="relative overflow-hidden rounded-lg p-5 mb-4"
            style={{ backgroundColor: color + "12", border: `1px solid ${color}40` }}
        >
            {promo.title && (
                <p className="text-[10px] uppercase tracking-[0.25em] font-medium mb-1.5" style={{ color }}>
                    {promo.title}
                </p>
            )}
            <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4" style={{ color }} strokeWidth={1.5} />
                {hasDiscount && (
                    <span className="font-heading text-2xl tracking-[0.02em]" style={{ color }}>
                        {discountPercent}% OFF
                    </span>
                )}
                {promo.free_shipping && !hasDiscount && (
                    <span className="font-heading text-lg tracking-[0.03em]" style={{ color }}>
                        Frete Grátis
                    </span>
                )}
            </div>
            {promo.subtitle && (
                <p className="text-[11px] font-medium mb-1" style={{ color }}>
                    {promo.subtitle}
                </p>
            )}
            {/* Progress message */}
            <div className="mt-3 pt-3 border-t" style={{ borderColor: color + "20" }}>
                <p className="text-[11px] font-medium flex items-center gap-1.5" style={{ color: qualified ? color : undefined }}>
                    {qualified ? <Check className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {progressMessage}
                </p>
            </div>
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

/**
 * Small elegant seal for product cards.
 */
export function PromotionSeal({ promo }) {
    if (!promo) return null;
    const color = promo.campaign_color || "#A5925A";
    const discount = Number(promo.discount_percent) || 0;
    return (
        <div
            className="absolute top-2 left-2 z-10 flex flex-col items-center justify-center px-2 py-1"
            style={{ backgroundColor: color, color: "#fff" }}
        >
            {discount > 0 && <span className="text-[10px] font-bold leading-none">{discount}% OFF</span>}
            {promo.title && <span className="text-[7px] uppercase tracking-[0.1em] leading-tight mt-0.5">{promo.title}</span>}
        </div>
    );
}
