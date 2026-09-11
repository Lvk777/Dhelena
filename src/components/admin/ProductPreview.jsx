import React, { useState } from "react";
import { Heart, Minus, Plus, Ruler, Truck, ChevronDown, ShoppingBag } from "lucide-react";
import StorefrontFrame, { DeviceToggle } from "@/components/admin/StorefrontFrame";

/**
 * ProductPreview — simulates the real ProductDetail page using form data.
 * Renders with the real storefront header, typography, colors, and layout.
 *
 * Props:
 *  - form: product form data (name, price, sale_price, images, colors, sizes, etc.)
 *  - deviceProp: "desktop" | "mobile" (if controlled by parent)
 */
const BADGE_LABELS = { novo: "Novo", destaque: "Destaque", maisVendido: "Mais vendido", ultimas: "Últimas peças", promocao: "Promoção", exclusivo: "Exclusivo" };

function formatBRL(v) {
    const n = Number(v) || 0;
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function ProductPreview({ form, device: deviceProp }) {
    const [internalDevice, setInternalDevice] = useState("desktop");
    const device = deviceProp || internalDevice;
    const isMobile = device === "mobile";
    const [activeImg, setActiveImg] = useState(0);
    const [openAcc, setOpenAcc] = useState("descricao");

    const images = form.images?.length ? form.images : [];
    const price = form.sale_price ? Number(form.sale_price) : Number(form.price) || 0;
    const installments = form.installments || 6;
    const installmentVal = price / installments;

    const activeBadges = form.badges ? Object.entries(form.badges).filter(([, v]) => v).map(([k]) => BADGE_LABELS[k]).filter(Boolean) : [];

    // Gallery images (duplicate if < 4 for thumbnail display)
    const gallery = images.length > 0 ? [...images, ...images].slice(0, 4) : [];

    return (
        <div className="space-y-3">
            {!deviceProp && <DeviceToggle device={device} onChange={setInternalDevice} />}

            <StorefrontFrame device={device}>
                {/* Breadcrumb */}
                <div className={`px-4 py-2.5 text-[9px] uppercase tracking-[0.16em] text-muted-foreground ${isMobile ? "" : "px-6 py-3"}`}>
                    <span>Início</span>
                    <span className="mx-1.5">/</span>
                    <span className="capitalize">{form.category || "Categoria"}</span>
                    <span className="mx-1.5">/</span>
                    <span className="text-foreground">{form.name || "Produto"}</span>
                </div>

                <div className={`grid ${isMobile ? "grid-cols-1" : "grid-cols-2"} gap-4 ${isMobile ? "p-3" : "p-6 gap-8"}`}>
                    {/* Gallery */}
                    <div className={`flex ${isMobile ? "flex-col-reverse" : "flex-row"} gap-3`}>
                        {/* Thumbnails */}
                        {gallery.length > 1 && (
                            <div className={`flex ${isMobile ? "flex-row" : "flex-col"} gap-2 ${isMobile ? "overflow-x-auto" : ""}`}>
                                {gallery.slice(0, 4).map((src, i) => (
                                    <button key={i} onClick={() => setActiveImg(i)}
                                        className={`shrink-0 ${isMobile ? "w-12 h-15" : "w-14 h-18"} overflow-hidden bg-bone border ${activeImg === i ? "border-[hsl(var(--gold))]" : "border-transparent"}`}
                                        style={isMobile ? { width: "48px", height: "60px" } : { width: "56px", height: "72px" }}>
                                        <img src={src} alt="" className="w-full h-full object-cover" />
                                    </button>
                                ))}
                            </div>
                        )}
                        {/* Main image */}
                        <div className="flex-1 relative overflow-hidden bg-bone" style={{ aspectRatio: "3/4" }}>
                            {gallery[activeImg] ? (
                                <img src={gallery[activeImg]} alt={form.name || "Produto"} className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-muted-foreground/30 text-xs">Sem imagem</div>
                            )}
                            {/* Badges */}
                            <div className="absolute top-2 left-2 flex flex-col gap-1">
                                {activeBadges.map(b => (
                                    <span key={b} className="text-[7px] uppercase tracking-[0.14em] bg-[hsl(var(--gold))] text-white px-2 py-0.5">{b}</span>
                                ))}
                                {form.badges?.ultimas && (
                                    <span className="text-[7px] uppercase tracking-[0.14em] bg-[hsl(var(--rose))] text-white px-2 py-0.5">Últimas peças</span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Product info */}
                    <div className={isMobile ? "" : "py-1"}>
                        {form.collection && <p className="text-[8px] uppercase tracking-[0.24em] text-muted-foreground">{form.collection}</p>}
                        <h1 className={`mt-1 font-heading tracking-[0.02em] ${isMobile ? "text-2xl" : "text-3xl"}`}>{form.name || "Nome do produto"}</h1>
                        {form.sku && <p className="mt-0.5 text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Código {form.sku}</p>}

                        {/* Price */}
                        <div className="mt-3">
                            {form.sale_price ? (
                                <div className="flex items-baseline gap-2">
                                    <span className="text-muted-foreground line-through text-sm">{formatBRL(form.price)}</span>
                                    <span className="font-heading text-2xl text-foreground">{formatBRL(form.sale_price)}</span>
                                </div>
                            ) : (
                                <span className="font-heading text-2xl text-foreground">{formatBRL(form.price)}</span>
                            )}
                            <p className="text-[10px] text-muted-foreground mt-1">ou {installments}x de {formatBRL(installmentVal)} sem juros</p>
                        </div>

                        {/* Colors */}
                        {form.colors?.length > 0 && (
                            <div className="mt-4">
                                <p className="text-[9px] uppercase tracking-[0.18em] mb-2">Cor: <span className="text-muted-foreground normal-case tracking-normal">{form.colors[0]?.name || "Padrão"}</span></p>
                                <div className="flex gap-1.5">
                                    {form.colors.map((c) => (
                                        <span key={c.id} className="w-6 h-6 rounded-full border-2 border-[hsl(var(--gold))]" style={{ background: c.hex }} title={c.name} />
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Sizes */}
                        {form.sizes?.length > 0 && (
                            <div className="mt-4">
                                <div className="flex items-center justify-between mb-2">
                                    <p className="text-[9px] uppercase tracking-[0.18em]">Tamanho</p>
                                    <span className="flex items-center gap-1 text-[8px] uppercase tracking-[0.14em] text-muted-foreground">
                                        <Ruler className="w-3 h-3" strokeWidth={1.25} /> Guia de medidas
                                    </span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {form.sizes.map((s, i) => (
                                        <span key={s} className={`min-w-[36px] h-8 border text-[10px] flex items-center justify-center ${i === 0 ? "border-foreground bg-foreground text-white" : "border-border text-muted-foreground"}`}>
                                            {s}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Quantity + Add to cart */}
                        <div className="mt-4 flex items-center gap-2">
                            <div className="flex items-center border border-border">
                                <span className="px-2 py-1.5"><Minus className="w-2.5 h-2.5" strokeWidth={1.5} /></span>
                                <span className="px-2 text-[10px]">1</span>
                                <span className="px-2 py-1.5"><Plus className="w-2.5 h-2.5" strokeWidth={1.5} /></span>
                            </div>
                            <button className="flex-1 bg-[hsl(var(--gold))] text-white text-[9px] uppercase tracking-[0.16em] py-2.5 flex items-center justify-center gap-1.5">
                                <ShoppingBag className="w-3 h-3" strokeWidth={1.5} /> Adicionar à sacola
                            </button>
                        </div>

                        <button className="w-full mt-2 border border-border py-2 text-[9px] uppercase tracking-[0.16em] flex items-center justify-center gap-1.5">
                            <Heart className="w-3 h-3" strokeWidth={1.5} /> Adicionar aos favoritos
                        </button>

                        {/* Shipping */}
                        <div className="mt-4 pt-3 border-t border-border">
                            <p className="text-[9px] uppercase tracking-[0.16em] flex items-center gap-1.5 mb-2">
                                <Truck className="w-3 h-3 text-[hsl(var(--gold))]" strokeWidth={1.25} /> Calcular frete
                            </p>
                            <div className="flex gap-1.5">
                                <div className="flex-1 border border-border px-2 py-1.5 text-[9px] text-muted-foreground">Digite seu CEP</div>
                                <span className="border border-border px-3 py-1.5 text-[9px] uppercase tracking-[0.12em]">Calcular</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Accordions */}
                <div className={`px-4 ${isMobile ? "" : "px-6"} pb-4 max-w-2xl`}>
                    {[
                        { id: "descricao", label: "Descrição", content: form.description },
                        { id: "detalhes", label: "Detalhes da peça", content: form.details },
                        { id: "composicao", label: "Composição", content: form.composition },
                        { id: "cuidados", label: "Cuidados", content: form.care },
                    ].filter(a => a.content).map(acc => (
                        <div key={acc.id} className="border-b border-border">
                            <button onClick={() => setOpenAcc(openAcc === acc.id ? null : acc.id)} className="w-full flex items-center justify-between py-2.5 text-left">
                                <span className="text-[9px] uppercase tracking-[0.18em]">{acc.label}</span>
                                <ChevronDown className={`w-3 h-3 transition-transform ${openAcc === acc.id ? "rotate-180" : ""}`} strokeWidth={1.25} />
                            </button>
                            {openAcc === acc.id && (
                                <p className="text-[10px] text-muted-foreground leading-relaxed pb-2.5 pr-4">{acc.content}</p>
                            )}
                        </div>
                    ))}
                    {!form.description && !form.details && !form.composition && !form.care && (
                        <div className="border-b border-border py-2.5">
                            <span className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground/50">Descrição</span>
                        </div>
                    )}
                </div>

                {/* Mobile sticky bar */}
                {isMobile && (
                    <div className="border-t border-border px-3 py-2 flex items-center gap-2 bg-background">
                        <div className="flex-1">
                            <p className="text-[10px] font-medium">{formatBRL(price)}</p>
                            <p className="text-[8px] text-muted-foreground">{installments}x sem juros</p>
                        </div>
                        <span className="flex-1 bg-[hsl(var(--gold))] text-white text-[9px] uppercase tracking-[0.14em] py-2 text-center">Adicionar</span>
                    </div>
                )}
            </StorefrontFrame>
        </div>
    );
}
