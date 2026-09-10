import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { Heart, Minus, Plus, Ruler, Truck, ChevronDown, Check } from "lucide-react";
import SizeGuideModal from "@/components/SizeGuideModal";
import { useStore } from "@/context/StoreContext";
import { useCatalog } from "@/context/CatalogContext";
import { usePublicSettings } from "@/context/PublicSettingsContext";
import { COLOR_SWATCHES, formatBRL, installmentValue } from "@/data/products";
import ProductCard from "@/components/ProductCard";
import { track } from "@/lib/analytics";
import PositionBanner from "@/components/PositionBanner";
import useSEO from "@/lib/useSEO";

export default function ProductDetail() {
    const { id } = useParams();
    const { getProductById, getRelated, getCompleteLook, loading } = useCatalog();
    const product = getProductById(id);
    const { addToCart, toggleFavorite, isFavorite, setCartOpen } = useStore();
    const { freeShippingThreshold } = usePublicSettings();
    const [activeImg, setActiveImg] = useState(0);
    const [color, setColor] = useState(product?.colors[0]?.id);
    const [size, setSize] = useState(null);
    const [qty, setQty] = useState(1);
    const [openAcc, setOpenAcc] = useState("descricao");
    const [sizeGuideOpen, setSizeGuideOpen] = useState(false);
    const [cep, setCep] = useState("");
    const [frete, setFrete] = useState(null);

    // Dynamic SEO
    useSEO({
        title: product ? product.name : "Produto",
        description: product ? `${product.name} — ${product.description?.substring(0, 150) || "D'Helenas"}` : "D'Helenas — Moda feminina",
        image: product?.images?.[0],
        url: `/produto/${id}`,
    });

    useEffect(() => { if (product && !color) setColor(product.colors[0]?.id); }, [product, color]);

    // Track product view
    useEffect(() => { if (product) track('product_view', { product_id: product.id }); }, [product?.id]);

    if (loading && !product) {
        return <div className="h-screen flex items-center justify-center"><div className="w-8 h-8 border-4 border-[hsl(var(--bone))] border-t-[hsl(var(--gold))] rounded-full animate-spin" /></div>;
    }

    if (!product) {
        return (
            <div className="container-boutique py-32 text-center">
                <p className="text-muted-foreground">Produto não encontrado.</p>
                <Link to="/loja" className="btn-outline mt-6">Voltar à loja</Link>
            </div>
        );
    }

    const price = product.salePrice ?? product.price;
    const fav = isFavorite(product.id);
    const currentColor = product.colors.find((c) => c.id === color);
    const sizeStock = size ? currentColor?.stock[size] : 0;
    const related = getRelated(product) || [];
    const look = getCompleteLook(product) || [];

    const handleAdd = () => {
        if (!size) return;
        addToCart({ productId: product.id, colorId: color, size, qty }, sizeStock || undefined);
        setCartOpen(true);
    };

    const calcFrete = (e) => {
        e.preventDefault();
        if (cep.replace(/\D/g, "").length === 8) setFrete({ valor: 29.9, prazo: "5 a 7 dias úteis" });
        else setFrete({ erro: "CEP inválido" });
    };

    return (
        <div>
            <PositionBanner position="product_top" />
            {/* breadcrumb */}
            <div className="container-boutique py-5 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                <Link to="/" className="hover:text-foreground">Início</Link>
                <span className="mx-2">/</span>
                <Link to={`/loja?cat=${product.category}`} className="hover:text-foreground capitalize">{product.category}</Link>
                <span className="mx-2">/</span>
                <span className="text-foreground">{product.name}</span>
            </div>

            <div className="container-boutique pb-28 lg:pb-16">
                <div className="grid lg:grid-cols-2 gap-10 lg:gap-16">
                    {/* gallery */}
                    <div className="flex flex-col-reverse lg:flex-row gap-4">
                        {/* thumbs */}
                        <div className="flex lg:flex-col gap-3 lg:max-h-[560px] overflow-x-auto lg:overflow-y-auto no-scrollbar">
                            {product.images.concat(product.images).slice(0, 4).map((src, i) => (
                                <button
                                    key={i}
                                    onClick={() => setActiveImg(i)}
                                    className={`shrink-0 w-16 h-20 lg:w-20 lg:h-24 overflow-hidden bg-bone border ${activeImg === i ? "border-[hsl(var(--gold))]" : "border-transparent"}`}
                                >
                                    <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" />
                                </button>
                            ))}
                        </div>
                        {/* main */}
                        <div className="flex-1 relative overflow-hidden bg-bone aspect-[3/4] group">
                            <img
                                src={(product.images.concat(product.images))[activeImg]}
                                alt={product.name}
                                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                            />
                            <div className="absolute top-4 left-4 flex flex-col gap-1.5">
                                {product.badges.novo && <span className="text-[9px] uppercase tracking-[0.18em] bg-[hsl(var(--gold))] text-white px-2.5 py-1">Novo</span>}
                                {product.badges.ultimas && <span className="text-[9px] uppercase tracking-[0.18em] bg-[hsl(var(--rose))] text-white px-2.5 py-1">Últimas peças</span>}
                            </div>
                        </div>
                    </div>

                    {/* info */}
                    <div className="lg:py-2">
                        <p className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">{product.collection}</p>
                        <h1 className="mt-2 font-heading text-4xl sm:text-5xl tracking-[0.02em]">{product.name}</h1>
                        <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Código {product.sku}</p>

                        <div className="mt-6">
                            {product.salePrice ? (
                                <div className="flex items-baseline gap-3">
                                    <span className="text-muted-foreground line-through">{formatBRL(product.price)}</span>
                                    <span className="font-heading text-3xl text-foreground">{formatBRL(product.salePrice)}</span>
                                </div>
                            ) : (
                                <span className="font-heading text-3xl text-foreground">{formatBRL(product.price)}</span>
                            )}
                            <p className="text-sm text-muted-foreground mt-1.5">ou {product.installments}x de {formatBRL(installmentValue(price, product.installments))} sem juros</p>
                        </div>

                        {/* color */}
                        <div className="mt-8">
                            <p className="text-[11px] uppercase tracking-[0.2em] mb-3">Cor: <span className="text-muted-foreground normal-case tracking-normal">{currentColor?.name || COLOR_SWATCHES[color]?.name}</span></p>
                            <div className="flex gap-2.5">
                                {product.colors.map((c) => (
                                    <button
                                        key={c.id}
                                        onClick={() => { setColor(c.id); setSize(null); }}
                                        className={`w-9 h-9 rounded-full border-2 transition-all ${color === c.id ? "border-[hsl(var(--gold))]" : "border-border hover:border-foreground/40"}`}
                                        style={{ background: c.hex || COLOR_SWATCHES[c.id]?.hex }}
                                        aria-label={c.name || COLOR_SWATCHES[c.id]?.name}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* size */}
                        <div className="mt-6">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-[11px] uppercase tracking-[0.2em]">Tamanho</p>
                                <button onClick={() => setSizeGuideOpen(true)} className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground transition-colors">
                                    <Ruler className="w-3.5 h-3.5" strokeWidth={1.25} /> Guia de medidas
                                </button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {product.sizes.map((s) => {
                                    const st = currentColor?.stock[s] ?? 0;
                                    const disabled = st === 0;
                                    return (
                                        <button
                                            key={s}
                                            disabled={disabled}
                                            onClick={() => setSize(s)}
                                            className={`relative min-w-[52px] h-12 border text-sm transition-colors ${size === s ? "border-foreground bg-foreground text-white" : disabled ? "border-border text-muted-foreground/40 cursor-not-allowed line-through" : "border-border hover:border-foreground"}`}
                                        >
                                            {s}
                                        </button>
                                    );
                                })}
                            </div>
                            {size && sizeStock <= 3 && sizeStock > 0 && (
                                <p className="text-[11px] text-[hsl(var(--rose))] mt-2">Apenas {sizeStock} em estoque</p>
                            )}
                        </div>

                        {/* qty */}
                        <div className="mt-6 flex items-center gap-4">
                            <p className="text-[11px] uppercase tracking-[0.2em]">Quantidade</p>
                            <div className="flex items-center border border-border">
                                <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="px-3 py-2.5 hover:bg-bone" aria-label="Diminuir"><Minus className="w-3.5 h-3.5" strokeWidth={1.5} /></button>
                                <span className="px-4 text-sm">{qty}</span>
                                <button onClick={() => setQty((q) => Math.min(q + 1, sizeStock > 0 ? sizeStock : 1))} disabled={sizeStock <= 0} className="px-3 py-2.5 hover:bg-bone disabled:opacity-30" aria-label="Aumentar"><Plus className="w-3.5 h-3.5" strokeWidth={1.5} /></button>
                            </div>
                        </div>

                        {/* actions */}
                        <div className="mt-7 space-y-3">
                            <button
                                onClick={handleAdd}
                                disabled={!size}
                                className="btn-gold w-full text-sm py-5 disabled:opacity-40"
                            >
                                {size ? "Adicionar à sacola" : "Selecione um tamanho"}
                            </button>
                            <button
                                onClick={() => toggleFavorite(product.id)}
                                className="btn-outline w-full py-4"
                            >
                                <Heart className={`w-4 h-4 ${fav ? "fill-[hsl(var(--rose))] text-[hsl(var(--rose))]" : ""}`} strokeWidth={1.5} /> {fav ? "Remover dos favoritos" : "Adicionar aos favoritos"}
                            </button>
                        </div>

                        {/* frete */}
                        <div className="mt-8 pt-6 border-t border-border">
                            <p className="text-[11px] uppercase tracking-[0.2em] mb-3 flex items-center gap-2"><Truck className="w-4 h-4 text-[hsl(var(--gold))]" strokeWidth={1.25} /> Calcular frete</p>
                            <form onSubmit={calcFrete} className="flex gap-2">
                                <input
                                    value={cep}
                                    onChange={(e) => setCep(e.target.value)}
                                    placeholder="Digite seu CEP"
                                    className="flex-1 border border-border px-4 py-3 text-sm focus:outline-none focus:border-[hsl(var(--gold))]"
                                />
                                <button type="submit" className="btn-outline px-6">Calcular</button>
                            </form>
                            {frete && !frete.erro && (
                                <p className="text-sm text-muted-foreground mt-3 flex items-center gap-2"><Check className="w-4 h-4 text-[hsl(var(--gold))]" strokeWidth={1.5} /> {formatBRL(frete.valor)} · {frete.prazo}</p>
                            )}
                            {frete?.erro && <p className="text-sm text-[hsl(var(--rose))] mt-3">{frete.erro}</p>}
                        </div>
                    </div>
                </div>

                {/* accordions */}
                <div className="mt-16 max-w-3xl">
                    <Accordion id="descricao" title="Descrição" open={openAcc} setOpen={setOpenAcc}>{product.description}</Accordion>
                    <Accordion id="detalhes" title="Detalhes da peça" open={openAcc} setOpen={setOpenAcc}>{product.details}</Accordion>
                    <Accordion id="composicao" title="Composição" open={openAcc} setOpen={setOpenAcc}>{product.composition}</Accordion>
                    <Accordion id="cuidados" title="Cuidados" open={openAcc} setOpen={setOpenAcc}>{product.care}</Accordion>
                    <Accordion id="entrega" title="Entrega" open={openAcc} setOpen={setOpenAcc}>{`Enviamos para todo o Brasil${freeShippingThreshold ? `. Frete grátis acima de ${formatBRL(freeShippingThreshold)}` : ""}. Prazo de 3 a 10 dias úteis conforme a região.`}</Accordion>
                    <Accordion id="trocas" title="Trocas e devoluções" open={openAcc} setOpen={setOpenAcc}>Você tem até 30 dias para solicitar troca ou devolução. A primeira troca é por nossa conta.</Accordion>
                </div>

                {/* complete the look */}
                {look.length > 0 && (
                    <section className="mt-20">
                        <h2 className="font-heading text-3xl tracking-[0.03em] text-center">Complete o look</h2>
                        <div className="flex justify-center mt-4"><div className="gold-rule" /></div>
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6 mt-10">
                            {look.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
                        </div>
                    </section>
                )}

                {/* related */}
                {related.length > 0 && (
                    <section className="mt-20">
                        <h2 className="font-heading text-3xl tracking-[0.03em] text-center">Você também pode gostar</h2>
                        <div className="flex justify-center mt-4"><div className="gold-rule" /></div>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-6 mt-10">
                            {related.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
                        </div>
                    </section>
                )}
            </div>

            {/* mobile sticky bar */}
            <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-background border-t border-border px-4 py-3 flex items-center gap-3">
                <div className="flex-1">
                    <p className="text-sm font-medium">{formatBRL(price)}</p>
                    <p className="text-[11px] text-muted-foreground">{product.installments}x sem juros</p>
                </div>
                <button onClick={handleAdd} disabled={!size} className="btn-gold flex-1 py-3.5 disabled:opacity-40">
                    {size ? "Adicionar" : "Escolha o tamanho"}
                </button>
            </div>

            <SizeGuideModal open={sizeGuideOpen} onClose={() => setSizeGuideOpen(false)} guideId={product?.size_guide_id} customMeasurements={product?.custom_measurements} />
        </div>
    );
}

function Accordion({ id, title, open, setOpen, children }) {
    const isOpen = open === id;
    return (
        <div className="border-b border-border">
            <button onClick={() => setOpen(isOpen ? null : id)} className="w-full flex items-center justify-between py-5 text-left">
                <span className="text-[12px] uppercase tracking-[0.22em]">{title}</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`} strokeWidth={1.25} />
            </button>
            <div className={`overflow-hidden transition-all duration-500 ${isOpen ? "max-h-60 pb-5" : "max-h-0"}`}>
                <p className="text-sm text-muted-foreground leading-relaxed pr-6">{children}</p>
            </div>
        </div>
    );
}