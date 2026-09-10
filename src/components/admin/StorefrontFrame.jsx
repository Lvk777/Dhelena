import React, { useState } from "react";
import { Search, Heart, ShoppingBag, Menu, Monitor, Smartphone, ArrowRight, Truck, Star, ChevronDown, Minus, Plus, Ruler, Check, X } from "lucide-react";

/**
 * StorefrontFrame — shared storefront chrome (announcement bar + header + footer)
 * used by all preview components so they look like the real published site.
 *
 * Props:
 *  - device: "desktop" | "mobile"
 *  - allowDeviceToggle: boolean
 *  - deviceProp: if provided, hides internal toggle (parent controls)
 *  - onDeviceChange: callback when device changes
 *  - children: page content
 *  - scrollable: boolean (if true, content scrolls inside the frame)
 */
export function useDeviceToggle(initialDevice = "desktop") {
    const [device, setDevice] = useState(initialDevice);
    return { device, setDevice };
}

export function DeviceToggle({ device, onChange }) {
    return (
        <div className="flex justify-center gap-1 mb-3">
            <button onClick={() => onChange("desktop")}
                className={`flex items-center gap-1 px-3 py-1.5 text-[10px] uppercase border transition-colors ${device === "desktop" ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:border-foreground/40"}`}>
                <Monitor className="w-3 h-3" /> Desktop
            </button>
            <button onClick={() => onChange("mobile")}
                className={`flex items-center gap-1 px-3 py-1.5 text-[10px] uppercase border transition-colors ${device === "mobile" ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:border-foreground/40"}`}>
                <Smartphone className="w-3 h-3" /> Mobile
            </button>
        </div>
    );
}

export default function StorefrontFrame({ device = "desktop", children, className = "" }) {
    const isMobile = device === "mobile";

    return (
        <div className={`mx-auto bg-background border border-border rounded-lg overflow-hidden shadow-lg ${isMobile ? "max-w-[375px]" : "max-w-full"} ${className}`}>
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

            {/* Page content */}
            {children}

            {/* Footer */}
            <div className="border-t border-border bg-bone px-4 py-3 text-center">
                <p className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground">D'Helenas · Boutique · 2026</p>
            </div>
        </div>
    );
}
