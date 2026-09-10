import React, { useState } from "react";
import { Search, Heart, ShoppingBag, Menu, ArrowRight, Monitor, Smartphone, Star, Truck } from "lucide-react";

/**
 * StorefrontPreview — simulates the real storefront using the same CSS classes
 * and design language. Renders a banner in the position it will appear.
 *
 * Props:
 *  - position: string (banner position key)
 *  - banner: { image, image_mobile, title, subtitle, eyebrow, text, button_text, button_link,
 *             secondary_cta_label, secondary_cta_link, campaign_color }
 *  - device: "desktop" | "mobile" (controlled by parent or internal state)
 *  - allowDeviceToggle: boolean
 *
 * Works WITHOUT CatalogContext/StoreContext — uses only the provided data.
 */
export default function StorefrontPreview({ position, banner, device: deviceProp, allowDeviceToggle = true }) {
    const [internalDevice, setInternalDevice] = useState("desktop");
    const device = deviceProp || internalDevice;
    const isMobile = device === "mobile";

    const img = isMobile ? (banner?.image_mobile || banner?.image) : banner?.image;
    const isHero = position === "home_hero" || position === "lookbook_top" || position === "collections_top" || position === "shop_top" || position === "about_top" || position === "contact_top";
    const isCompact = position?.includes("cart") || position?.includes("checkout") || position === "lookbook_sidebar";

    return (
        <div className="space-y-3">
            {allowDeviceToggle && !deviceProp && (
                <div className="flex justify-center gap-1">
                    <button onClick={() => setInternalDevice("desktop")}
                        className={`flex items-center gap-1 px-3 py-1.5 text-[10px] uppercase border ${device === "desktop" ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground"}`}>
                        <Monitor className="w-3 h-3" /> Desktop
                    </button>
                    <button onClick={() => setInternalDevice("mobile")}
                        className={`flex items-center gap-1 px-3 py-1.5 text-[10px] uppercase border ${device === "mobile" ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground"}`}>
                        <Smartphone className="w-3 h-3" /> Mobile
                    </button>
                </div>
            )}

            {/* Simulated storefront frame */}
            <div className={`mx-auto bg-background border border-border rounded-lg overflow-hidden shadow-lg ${isMobile ? "max-w-[375px]" : "max-w-full"}`}>
                {/* Top announcement bar */}
                <div className="bg-[hsl(var(--rose))] text-white text-[8px] tracking-[0.25em] uppercase text-center py-1.5 px-4">
                    Frete grátis acima de R$ 499
                </div>

                {/* Header */}
                <div className="border-b border-border bg-background">
                    <div className={`flex items-center justify-between px-3 ${isMobile ? "h-12" : "h-14"}`}>
                        {isMobile ? (
                            <>
                                <Menu className="w-4 h-4 text-foreground" strokeWidth={1.25} />
                                <span className="font-heading text-base tracking-[0.08em] text-foreground">D'Helenas</span>
                                <div className="flex gap-2">
                                    <Search className="w-4 h-4 text-foreground/70" strokeWidth={1.25} />
                                    <ShoppingBag className="w-4 h-4 text-foreground/70" strokeWidth={1.25} />
                                </div>
                            </>
                        ) : (
                            <>
                                <nav className="flex gap-3">
                                    {["Início", "Novidades", "Roupas", "Acessórios", "Coleções"].map(n => (
                                        <span key={n} className="text-[9px] uppercase tracking-[0.14em] text-foreground/70">{n}</span>
                                    ))}
                                </nav>
                                <span className="font-heading text-lg tracking-[0.08em] text-foreground">D'Helenas</span>
                                <div className="flex gap-3">
                                    <Search className="w-4 h-4 text-foreground/70" strokeWidth={1.25} />
                                    <Heart className="w-4 h-4 text-foreground/70" strokeWidth={1.25} />
                                    <ShoppingBag className="w-4 h-4 text-foreground/70" strokeWidth={1.25} />
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {/* Banner content based on position */}
                <BannerPreviewContent position={position} banner={banner} img={img} isMobile={isMobile} isHero={isHero} isCompact={isCompact} />

                {/* Below-banner content (simulated page sections) */}
                <BelowBannerContent position={position} isMobile={isMobile} />
            </div>
        </div>
    );
}

function BannerPreviewContent({ position, banner, img, isMobile, isHero, isCompact }) {
    if (!img) {
        return (
            <div className={`flex items-center justify-center bg-bone text-muted-foreground/40 text-xs ${isHero ? (isMobile ? "h-60" : "h-72") : "h-24"}`}>
                Sem imagem — o banner não aparecerá
            </div>
        );
    }

    // Compact (cart/checkout/sidebar) — thin strip
    if (isCompact) {
        return (
            <div className="relative overflow-hidden bg-charcoal h-28">
                <img src={img} alt={banner?.title || ""} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-r from-charcoal/60 to-transparent" />
                <div className="absolute inset-0 flex items-center px-4">
                    <div className="text-bone">
                        {banner?.eyebrow && <p className="text-[8px] uppercase tracking-[0.25em] text-[hsl(var(--gold))] mb-0.5">{banner.eyebrow}</p>}
                        {banner?.title && <h2 className="font-heading text-sm tracking-wide">{banner.title}</h2>}
                        {banner?.subtitle && <p className="font-heading text-[10px] italic text-bone/80">{banner.subtitle}</p>}
                        {banner?.button_text && (
                            <span className="inline-flex items-center gap-1 mt-1.5 bg-[hsl(var(--rose))] text-white text-[7px] uppercase tracking-[0.15em] px-3 py-1.5">
                                {banner.button_text} <ArrowRight className="w-2.5 h-2.5" strokeWidth={1.5} />
                            </span>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // Hero — full height
    const heroHeight = isMobile ? "h-64" : "h-80";

    // For product/look pages — medium height
    const mediumHeight = isMobile ? "h-48" : "h-56";
    const height = isHero ? heroHeight : mediumHeight;

    return (
        <div className={`relative ${height} overflow-hidden`}>
            <img src={img} alt={banner?.title || ""} className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 bg-charcoal/30" />
            <div className="relative h-full flex items-center justify-center text-center px-6">
                <div className="max-w-lg text-bone">
                    {banner?.eyebrow && <p className="text-[8px] uppercase tracking-[0.3em] text-[hsl(var(--gold))] mb-1.5">{banner.eyebrow}</p>}
                    {banner?.title && <h2 className={`font-heading tracking-[0.03em] ${isMobile ? "text-xl" : "text-3xl"}`}>{banner.title}</h2>}
                    {banner?.subtitle && <p className={`mt-1.5 font-heading italic text-bone/85 ${isMobile ? "text-sm" : "text-lg"}`}>{banner.subtitle}</p>}
                    {banner?.text && <p className={`mt-2 text-bone/80 ${isMobile ? "text-[10px]" : "text-xs"} max-w-sm mx-auto`}>{banner.text}</p>}
                    {banner?.button_text && (
                        <span className={`mt-4 inline-flex items-center gap-1.5 bg-[hsl(var(--rose))] text-white ${isMobile ? "text-[8px] px-4 py-2" : "text-[10px] px-6 py-2.5"} uppercase tracking-[0.2em]`}>
                            {banner.button_text} <ArrowRight className="w-3 h-3" strokeWidth={1.5} />
                        </span>
                    )}
                    {banner?.secondary_cta_label && (
                        <span className={`mt-3 ml-2 inline-flex items-center gap-1.5 border border-bone/70 text-bone ${isMobile ? "text-[8px] px-4 py-2" : "text-[10px] px-6 py-2.5"} uppercase tracking-[0.2em]`}>
                            {banner.secondary_cta_label}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}

function BelowBannerContent({ position, isMobile }) {
    // Show different simulated page sections depending on position
    if (position?.startsWith("home_")) {
        return (
            <div className="p-4 space-y-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground text-center">Novidades</p>
                <div className="grid grid-cols-4 gap-2">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="aspect-[3/4] bg-bone rounded">
                            <div className="w-full h-full flex items-center justify-center">
                                <span className="text-[8px] text-muted-foreground/30">Produto {i}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (position?.startsWith("product_")) {
        return (
            <div className="p-4">
                <div className="flex gap-3">
                    <div className="w-20 h-28 bg-bone rounded shrink-0" />
                    <div className="flex-1 space-y-1.5">
                        <div className="h-2.5 w-3/4 bg-muted rounded" />
                        <div className="h-2 w-1/2 bg-muted/60 rounded" />
                        <div className="h-3 w-1/3 bg-[hsl(var(--gold))]/30 rounded" />
                        <div className="flex gap-1 pt-1">
                            <div className="w-4 h-4 rounded-full bg-rose/30 border border-border" />
                            <div className="w-4 h-4 rounded-full bg-blue-400/30 border border-border" />
                            <div className="w-4 h-4 rounded-full bg-green-500/30 border border-border" />
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (position?.startsWith("cart") || position?.startsWith("checkout")) {
        return (
            <div className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                    <Truck className="w-3.5 h-3.5 text-muted-foreground" strokeWidth={1.5} />
                    <div className="h-2 w-24 bg-muted rounded" />
                </div>
                <div className="flex gap-2 items-center">
                    <div className="w-10 h-12 bg-bone rounded" />
                    <div className="flex-1 space-y-1">
                        <div className="h-2 w-3/4 bg-muted rounded" />
                        <div className="h-1.5 w-1/3 bg-muted/60 rounded" />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 space-y-2">
            <div className="h-2 w-full bg-muted/40 rounded" />
            <div className="h-2 w-2/3 bg-muted/40 rounded" />
        </div>
    );
}
