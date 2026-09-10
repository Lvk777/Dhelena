import React from "react";
import { Layers, ArrowRight } from "lucide-react";
import StorefrontFrame, { DeviceToggle } from "@/components/admin/StorefrontFrame";

/**
 * CollectionPreview — simulates the real Collections page for a single collection.
 * Renders with the real storefront header, typography, colors, and layout.
 *
 * Props:
 *  - form: collection form data (name, slug, description, image, banner_image)
 *  - device: "desktop" | "mobile" (if controlled by parent)
 */
export default function CollectionPreview({ form, device: deviceProp }) {
    const [internalDevice, setInternalDevice] = React.useState("desktop");
    const device = deviceProp || internalDevice;
    const isMobile = device === "mobile";

    return (
        <div className="space-y-3">
            {!deviceProp && <DeviceToggle device={device} onChange={setInternalDevice} />}

            <StorefrontFrame device={device}>
                {/* Collection banner (if exists) */}
                {form.banner_image && (
                    <div className="relative overflow-hidden" style={{ aspectRatio: isMobile ? "16/9" : "16/5" }}>
                        <img src={form.banner_image} alt={form.name} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-charcoal/25" />
                        <div className="absolute inset-0 flex items-center justify-center text-center px-6">
                            <div className="text-bone">
                                <p className="text-[8px] uppercase tracking-[0.28em] text-[hsl(var(--gold))] mb-1">Coleção</p>
                                <h2 className={`font-heading tracking-[0.03em] ${isMobile ? "text-xl" : "text-4xl"}`}>{form.name || "Nome da coleção"}</h2>
                            </div>
                        </div>
                    </div>
                )}

                {/* Header section (when no banner) */}
                {!form.banner_image && (
                    <div className="bg-bone py-8 text-center px-4">
                        <p className="text-[8px] uppercase tracking-[0.24em] text-muted-foreground">Curadoria</p>
                        <h1 className={`mt-2 font-heading tracking-[0.03em] ${isMobile ? "text-3xl" : "text-4xl"}`}>{form.name || "Nome da coleção"}</h1>
                        <div className="flex justify-center mt-2">
                            <div className="w-12 h-px bg-[hsl(var(--gold))]" />
                        </div>
                        {form.description && (
                            <p className={`mt-3 text-muted-foreground leading-relaxed ${isMobile ? "text-[10px] max-w-xs" : "text-xs max-w-md"} mx-auto`}>{form.description}</p>
                        )}
                    </div>
                )}

                {/* Cover image (when no banner, show cover as hero) */}
                {!form.banner_image && form.image && (
                    <div className="relative overflow-hidden" style={{ aspectRatio: "3/4", maxHeight: isMobile ? "320px" : "400px" }}>
                        <img src={form.image} alt={form.name} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-gradient-to-t from-charcoal/40 to-transparent" />
                        {form.description && (
                            <div className="absolute bottom-0 inset-x-0 p-4">
                                <p className={`text-bone/90 leading-relaxed ${isMobile ? "text-[10px]" : "text-xs"} max-w-md`}>{form.description}</p>
                            </div>
                        )}
                    </div>
                )}

                {/* Banner overlay text (when banner exists, show description below) */}
                {form.banner_image && form.description && (
                    <div className={`px-4 py-3 text-center`}>
                        <p className={`text-muted-foreground leading-relaxed ${isMobile ? "text-[10px]" : "text-xs"} max-w-md mx-auto`}>{form.description}</p>
                    </div>
                )}

                {/* Products grid (simulated) */}
                <div className={`px-4 py-4 ${isMobile ? "" : "px-6"}`}>
                    <div className="flex items-center justify-between mb-3">
                        <p className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Peças da coleção</p>
                        <span className="flex items-center gap-1 text-[8px] uppercase tracking-[0.14em] text-[hsl(var(--gold))]">
                            Ver tudo <ArrowRight className="w-2.5 h-2.5" strokeWidth={1.5} />
                        </span>
                    </div>
                    <div className={`grid ${isMobile ? "grid-cols-2" : "grid-cols-3"} gap-2`}>
                        {[1, 2, 3].map(i => (
                            <div key={i} className="aspect-[3/4] bg-bone rounded flex items-center justify-center">
                                <Layers className="w-5 h-5 text-muted-foreground/20" strokeWidth={1} />
                            </div>
                        ))}
                    </div>
                </div>

                {/* "Complete o look" section (simulated) */}
                <div className={`px-4 py-4 border-t border-border ${isMobile ? "" : "px-6"}`}>
                    <p className="text-center font-heading text-sm tracking-[0.03em] mb-2">Você também pode gostar</p>
                    <div className="flex justify-center mb-2">
                        <div className="w-8 h-px bg-[hsl(var(--gold))]" />
                    </div>
                    <div className={`grid ${isMobile ? "grid-cols-2" : "grid-cols-4"} gap-2`}>
                        {[1, 2, 3, 4].map(i => (
                            <div key={i} className="aspect-[3/4] bg-bone rounded" />
                        ))}
                    </div>
                </div>
            </StorefrontFrame>
        </div>
    );
}
