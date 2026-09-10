import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useCatalog } from "@/context/CatalogContext";

/**
 * Renders a banner at a specific position on public pages.
 * - Filters banners by position and active status (already filtered by CatalogContext).
 * - Respects display_mode: "priority" shows only the top banner, "carousel" shows all.
 * - Falls back to desktop image when mobile image is missing.
 */
export default function PositionBanner({ position, variant = "full" }) {
    const { banners } = useCatalog();

    const positionBanners = banners
        .filter((b) => b.position === position)
        .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    if (positionBanners.length === 0) return null;

    // Priority mode: show only the highest priority banner
    const display = positionBanners[0].display_mode === "carousel" ? positionBanners : [positionBanners[0]];

    if (variant === "compact") {
        // Compact variant for cart/checkout top — thin banner strip
        const b = display[0];
        return (
            <div className="relative overflow-hidden bg-charcoal">
                <img src={b.image_mobile || b.image} alt={b.title || ""} className="w-full h-32 sm:h-40 object-cover" />
                <div className="absolute inset-0 bg-gradient-to-r from-charcoal/60 to-transparent" />
                <div className="absolute inset-0 flex items-center container-boutique">
                    <div className="text-bone">
                        {b.eyebrow && <p className="text-[10px] uppercase tracking-[0.3em] text-gold mb-1">{b.eyebrow}</p>}
                        {b.title && <h2 className="font-heading text-xl sm:text-2xl tracking-wide">{b.title}</h2>}
                        {b.subtitle && <p className="font-heading text-sm italic text-bone/80 mt-0.5">{b.subtitle}</p>}
                        {b.button_text && (
                            <Link to={b.button_link || "#"} className="inline-flex items-center gap-1.5 mt-3 bg-rose text-white text-[10px] uppercase tracking-[0.2em] px-5 py-2.5">
                                {b.button_text} <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.5} />
                            </Link>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // Full variant — for lookbook/product top
    const b = display[0];
    return (
        <section className="relative h-[40vh] min-h-[280px] overflow-hidden">
            <img src={b.image} alt={b.title || ""} className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 bg-charcoal/30" />
            <div className="relative h-full container-boutique flex items-center justify-center text-center">
                <div className="max-w-2xl text-bone">
                    {b.eyebrow && <p className="eyebrow text-gold">{b.eyebrow}</p>}
                    {b.title && <h2 className="mt-3 font-heading text-4xl sm:text-5xl tracking-[0.03em]">{b.title}</h2>}
                    {b.subtitle && <p className="mt-3 font-heading text-xl italic text-bone/85">{b.subtitle}</p>}
                    {b.text && <p className="mt-4 text-sm text-bone/80 max-w-md mx-auto">{b.text}</p>}
                    {b.button_text && (
                        <Link to={b.button_link || "#"} className="mt-6 inline-flex items-center gap-2 bg-rose text-white text-[11px] uppercase tracking-[0.22em] px-8 py-4 transition-all duration-500 hover:bg-rose/85">
                            {b.button_text} <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
                        </Link>
                    )}
                    {b.secondary_cta_label && (
                        <Link to={b.secondary_cta_link || "#"} className="mt-6 ml-3 inline-flex items-center gap-2 border border-bone/70 text-bone text-[11px] uppercase tracking-[0.22em] px-8 py-4 transition-all duration-500 hover:bg-bone hover:text-charcoal">
                            {b.secondary_cta_label}
                        </Link>
                    )}
                </div>
            </div>
        </section>
    );
}
