import React from "react";
import { Tag, Truck, ShoppingCart, Layers, Home } from "lucide-react";
import StorefrontFrame, { DeviceToggle } from "@/components/admin/StorefrontFrame";

/**
 * PromotionPreview — context-aware promotion preview.
 * Shows how the promotion will appear in the real storefront based on its
 * application scope (home, product page, Monte seu Look, cart, etc.).
 *
 * Props:
 *  - form: promotion form data
 *  - device: "desktop" | "mobile" (if controlled by parent)
 */
export default function PromotionPreview({ form, device: deviceProp }) {
    const [internalDevice, setInternalDevice] = React.useState("desktop");
    const device = deviceProp || internalDevice;
    const isMobile = device === "mobile";

    // Determine where this promotion appears
    const promoType = form.promo_type || form.type;
    const hasCategory = !!form.applicable_category;
    const hasCollection = !!form.applicable_collection;
    const isSiteWide = !hasCategory && !hasCollection;
    const isLookDiscount = promoType === "look_discount";
    const isFreeShipping = promoType === "free_shipping" || form.free_shipping;

    // Page label and icon
    let pageLabel = "Home";
    let PageIcon = Home;
    if (hasCategory) { pageLabel = "Página de Produto"; PageIcon = Tag; }
    else if (hasCollection) { pageLabel = "Página de Coleção"; PageIcon = Layers; }
    else if (isLookDiscount) { pageLabel = "Monte seu Look"; PageIcon = Layers; }
    else if (isFreeShipping) { pageLabel = "Carrinho"; PageIcon = ShoppingCart; }

    const campaignColor = form.campaign_color || "#A5925A";

    return (
        <div className="space-y-3">
            {!deviceProp && <DeviceToggle device={device} onChange={setInternalDevice} />}

            {/* Context badge */}
            <div className="flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <PageIcon className="w-3 h-3" strokeWidth={1.5} />
                <span>Aparece em: <span className="text-foreground font-medium">{pageLabel}</span></span>
            </div>

            <StorefrontFrame device={device}>
                {/* ─── Monte seu Look page ─── */}
                {isLookDiscount && (
                    <LookPagePreview form={form} isMobile={isMobile} campaignColor={campaignColor} />
                )}

                {/* ─── Cart page ─── */}
                {isFreeShipping && !isLookDiscount && (
                    <CartPagePreview form={form} isMobile={isMobile} campaignColor={campaignColor} />
                )}

                {/* ─── Product page (category-specific) ─── */}
                {hasCategory && !isLookDiscount && !isFreeShipping && (
                    <ProductPagePreview form={form} isMobile={isMobile} campaignColor={campaignColor} />
                )}

                {/* ─── Collection page ─── */}
                {hasCollection && !hasCategory && !isLookDiscount && !isFreeShipping && (
                    <CollectionPagePreview form={form} isMobile={isMobile} campaignColor={campaignColor} />
                )}

                {/* ─── Home page (site-wide) ─── */}
                {isSiteWide && !isLookDiscount && !isFreeShipping && (
                    <HomePagePreview form={form} isMobile={isMobile} campaignColor={campaignColor} />
                )}
            </StorefrontFrame>

            {/* Hidden pages notice */}
            <div className="text-center text-[10px] text-muted-foreground/60">
                {isLookDiscount && "Não aparece em Home, Produto ou Carrinho"}
                {isFreeShipping && !isLookDiscount && "Não aparece em Home ou Produto"}
                {hasCategory && !isLookDiscount && !isFreeShipping && `Apenas produtos da categoria: ${form.applicable_category}`}
                {hasCollection && !hasCategory && !isLookDiscount && !isFreeShipping && `Apenas na coleção: ${form.applicable_collection}`}
                {isSiteWide && !isLookDiscount && !isFreeShipping && "Aparece em todas as páginas"}
            </div>
        </div>
    );
}

// ─── Promotion banner strip (shared component) ─────────────────────
function PromoBanner({ form, campaignColor, isMobile }) {
    return (
        <div className="relative overflow-hidden" style={{ aspectRatio: isMobile ? "4/3" : "16/5" }}>
            {form.banner_image ? (
                <img src={form.banner_image} alt="" className="absolute inset-0 w-full h-full object-cover" />
            ) : (
                <div className="absolute inset-0" style={{ backgroundColor: campaignColor + "15" }} />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-charcoal/60 to-transparent" />
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 text-bone">
                {form.title && (
                    <h3 className={`font-heading tracking-wide ${isMobile ? "text-lg" : "text-2xl"}`} style={{ color: campaignColor }}>
                        {form.title}
                    </h3>
                )}
                {form.subtitle && <p className={`font-heading italic text-bone/85 mt-1 ${isMobile ? "text-xs" : "text-sm"}`}>{form.subtitle}</p>}
                {form.short_text && <p className={`mt-2 text-bone/70 ${isMobile ? "text-[9px]" : "text-[10px]"}`}>{form.short_text}</p>}
                {/* Discount badge */}
                {Number(form.discount_percent) > 0 && (
                    <span className="mt-2 inline-block text-[8px] uppercase tracking-[0.18em] px-3 py-1 text-white" style={{ backgroundColor: campaignColor }}>
                        {form.discount_percent}% OFF
                    </span>
                )}
                {Number(form.discount_fixed) > 0 && (
                    <span className="mt-2 inline-block text-[8px] uppercase tracking-[0.18em] px-3 py-1 text-white" style={{ backgroundColor: campaignColor }}>
                        R$ {form.discount_fixed} OFF
                    </span>
                )}
            </div>
        </div>
    );
}

// ─── Home page preview ─────────────────────────────────────────────
function HomePagePreview({ form, isMobile, campaignColor }) {
    return (
        <>
            {/* Hero banner */}
            <PromoBanner form={form} campaignColor={campaignColor} isMobile={isMobile} />
            {/* Novidades section */}
            <div className="p-4 space-y-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground text-center">Novidades</p>
                <div className={`grid ${isMobile ? "grid-cols-2" : "grid-cols-4"} gap-2`}>
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="aspect-[3/4] bg-bone rounded" />
                    ))}
                </div>
            </div>
            {/* Between categories */}
            <div className="p-4 space-y-2">
                <div className="h-2 w-full bg-muted/40 rounded" />
                <div className="h-2 w-2/3 bg-muted/40 rounded mx-auto" />
            </div>
        </>
    );
}

// ─── Product page preview ──────────────────────────────────────────
function ProductPagePreview({ form, isMobile, campaignColor }) {
    return (
        <>
            {/* Promo banner at top */}
            <PromoBanner form={form} campaignColor={campaignColor} isMobile={isMobile} />
            {/* Product layout */}
            <div className={`grid ${isMobile ? "grid-cols-1" : "grid-cols-2"} gap-4 p-4`}>
                <div className="aspect-[3/4] bg-bone rounded" />
                <div className="space-y-2">
                    <div className="h-3 w-3/4 bg-muted rounded" />
                    <div className="h-2 w-1/3 bg-muted/60 rounded" />
                    <div className="h-4 w-1/4 rounded" style={{ backgroundColor: campaignColor + "30" }} />
                    <div className="flex gap-1 pt-1">
                        <div className="w-4 h-4 rounded-full border border-border" style={{ backgroundColor: campaignColor + "40" }} />
                        <div className="w-4 h-4 rounded-full bg-rose/30 border border-border" />
                    </div>
                    <div className="flex gap-1 pt-1">
                        <div className="w-8 h-7 border border-border rounded" />
                        <div className="w-8 h-7 border border-border rounded" />
                    </div>
                </div>
            </div>
        </>
    );
}

// ─── Collection page preview ──────────────────────────────────────
function CollectionPagePreview({ form, isMobile, campaignColor }) {
    return (
        <>
            {/* Promo banner at top */}
            <PromoBanner form={form} campaignColor={campaignColor} isMobile={isMobile} />
            <div className="p-4 space-y-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground text-center">Peças da coleção</p>
                <div className={`grid ${isMobile ? "grid-cols-2" : "grid-cols-3"} gap-2`}>
                    {[1, 2, 3].map(i => (
                        <div key={i} className="aspect-[3/4] bg-bone rounded" />
                    ))}
                </div>
            </div>
        </>
    );
}

// ─── Monte seu Look page preview ───────────────────────────────────
function LookPagePreview({ form, isMobile, campaignColor }) {
    return (
        <>
            {/* Hero */}
            <div className="relative overflow-hidden" style={{ aspectRatio: isMobile ? "4/3" : "16/6" }}>
                {form.banner_image ? (
                    <img src={form.banner_image} alt="" className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                    <div className="absolute inset-0" style={{ backgroundColor: campaignColor + "15" }} />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-charcoal/60 to-transparent" />
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 text-bone">
                    <p className="text-[8px] uppercase tracking-[0.28em] text-[hsl(var(--gold))] mb-1">Monte seu look</p>
                    {form.title && <h3 className={`font-heading tracking-wide ${isMobile ? "text-lg" : "text-2xl"}`} style={{ color: campaignColor }}>{form.title}</h3>}
                    {form.subtitle && <p className={`font-heading italic text-bone/85 mt-1 ${isMobile ? "text-xs" : "text-sm"}`}>{form.subtitle}</p>}
                    {Number(form.discount_percent) > 0 && (
                        <span className="mt-2 inline-block text-[8px] uppercase tracking-[0.18em] px-3 py-1 text-white" style={{ backgroundColor: campaignColor }}>
                            {form.discount_percent}% OFF com {form.min_items || 3}+ peças
                        </span>
                    )}
                </div>
            </div>
            {/* Look builder area */}
            <div className="p-4">
                <div className={`grid ${isMobile ? "grid-cols-1" : "grid-cols-3"} gap-2`}>
                    {[1, 2, 3].map(i => (
                        <div key={i} className="aspect-[3/4] bg-bone rounded flex items-center justify-center">
                            <Layers className="w-5 h-5 text-muted-foreground/20" strokeWidth={1} />
                        </div>
                    ))}
                </div>
                {/* Summary bar */}
                <div className="mt-3 p-3 rounded border border-border bg-muted/20 flex items-center justify-between">
                    <span className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">3 peças selecionadas</span>
                    <span className="text-[10px] font-medium" style={{ color: campaignColor }}>
                        {Number(form.discount_percent) > 0 ? `${form.discount_percent}% OFF` : "Frete grátis"}
                    </span>
                </div>
            </div>
        </>
    );
}

// ─── Cart page preview ─────────────────────────────────────────────
function CartPagePreview({ form, isMobile, campaignColor }) {
    return (
        <div className="p-4 space-y-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Carrinho</p>
            {/* Free shipping notice */}
            <div className="flex items-center gap-2 p-2.5 rounded" style={{ backgroundColor: campaignColor + "15" }}>
                <Truck className="w-4 h-4" style={{ color: campaignColor }} strokeWidth={1.5} />
                <span className="text-[10px]" style={{ color: campaignColor }}>
                    {form.free_shipping ? "Frete grátis aplicado!" : `Desconto de ${form.discount_percent || 0}% aplicado!`}
                </span>
            </div>
            {/* Cart items */}
            <div className="space-y-2">
                {[1, 2].map(i => (
                    <div key={i} className="flex gap-2 items-center p-2 border border-border rounded">
                        <div className="w-10 h-12 bg-bone rounded shrink-0" />
                        <div className="flex-1 space-y-1">
                            <div className="h-2 w-3/4 bg-muted rounded" />
                            <div className="h-1.5 w-1/3 bg-muted/60 rounded" />
                        </div>
                        <div className="h-3 w-12 rounded" style={{ backgroundColor: campaignColor + "30" }} />
                    </div>
                ))}
            </div>
            {/* Summary */}
            <div className="p-3 rounded border border-border bg-muted/20 space-y-1.5">
                <div className="flex justify-between text-[10px]">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>R$ 599,80</span>
                </div>
                <div className="flex justify-between text-[10px]">
                    <span style={{ color: campaignColor }}>Desconto</span>
                    <span style={{ color: campaignColor }}>
                        {Number(form.discount_percent) > 0 ? `- R$ ${(599.8 * form.discount_percent / 100).toFixed(2)}` : "Frete grátis"}
                    </span>
                </div>
                <div className="flex justify-between text-[10px] font-medium border-t border-border pt-1.5">
                    <span>Total</span>
                    <span>R$ {Number(form.discount_percent) > 0 ? (599.8 * (1 - form.discount_percent / 100)).toFixed(2) : "599,80"}</span>
                </div>
            </div>
        </div>
    );
}
