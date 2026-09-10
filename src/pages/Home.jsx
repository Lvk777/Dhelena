import React, { useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Instagram } from "lucide-react";
import ProductCard from "@/components/ProductCard";
import NewsletterCmp from "@/components/Newsletter";
import { PromotionCampaignBanner } from "@/components/PromoComponents";
import { useReveal } from "@/hooks/useReveal";
import { useCatalog } from "@/context/CatalogContext";
import { LOOK_IMAGE, formatBRL } from "@/data/products";

export default function Home() {
    const { products, categories, banners, loading } = useCatalog();
    const hero = banners.find(b => b.position === "home_hero") || banners[0] || {};
    const concept = banners.find(b => b.position === "home_after_news") || banners[1] || {};
    const novidades = products.filter((p) => p.badges?.novo).slice(0, 8);
    const maisDesejados = products.filter((p) => p.badges?.maisVendido).slice(0, 4);
    const instImages = products.slice(0, 6).map((p) => p.images[0]).filter(Boolean);
    const carouselRef = useRef(null);

    const scrollCarousel = (dir) => {
        const el = carouselRef.current;
        if (!el) return;
        el.scrollBy({ left: dir * (el.clientWidth * 0.8), behavior: "smooth" });
    };

    if (loading) {
        return <div className="h-screen flex items-center justify-center"><div className="w-8 h-8 border-4 border-[hsl(var(--bone))] border-t-[hsl(var(--gold))] rounded-full animate-spin" /></div>;
    }

    return (
        <div>
            {/* HERO */}
            {hero.image && (
                <section className="relative h-[88vh] min-h-[560px] w-full overflow-hidden">
                    <img src={hero.image} alt="D'Helenas" className="absolute inset-0 w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-r from-black/30 via-black/10 to-transparent" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
                    <div className="relative h-full container-boutique flex items-center">
                        <div className="max-w-xl text-bone animate-fade-rise">
                            <p className="eyebrow text-[hsl(var(--gold))]">{hero.eyebrow}</p>
                            <h1 className="mt-5 font-heading text-6xl sm:text-7xl lg:text-8xl leading-[0.95] tracking-[0.04em]">{hero.title}</h1>
                            <p className="mt-5 font-heading text-2xl sm:text-3xl italic text-bone/90">{hero.subtitle}</p>
                            <p className="mt-4 text-sm sm:text-base text-bone/80 leading-relaxed max-w-md">{hero.text}</p>
                            <div className="mt-9 flex flex-wrap gap-3">
                                <Link to={hero.button_link || hero.primary_cta_link || "/novidades"} className="inline-flex items-center gap-2 bg-[hsl(var(--rose))] text-white text-[11px] uppercase tracking-[0.22em] px-8 py-4 transition-all duration-500 hover:bg-[hsl(var(--rose))]/85">
                                    {hero.button_text || hero.primary_cta_label || "Ver novidades"} <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
                                </Link>
                                <Link to={(!hero.secondary_cta_link || hero.secondary_cta_link === "/loja") ? "/colecoes" : hero.secondary_cta_link} className="inline-flex items-center gap-2 border border-bone/80 text-bone text-[11px] uppercase tracking-[0.22em] px-8 py-4 transition-all duration-500 hover:bg-bone hover:text-charcoal">
                                    {hero.secondary_cta_label || "Conhecer a coleção"}
                                </Link>
                            </div>
                        </div>
                    </div>
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-bone/70 text-[10px] uppercase tracking-[0.3em] animate-fade-in">Role para descobrir</div>
                </section>
            )}

            {/* PROMO CAMPAIGN BANNER */}
            <PromotionCampaignBanner />

            {/* NOVIDADES */}
            <Section title="Acabaram de chegar" eyebrow="Novidades" id="novidades">
                <div className="relative">
                    <div ref={carouselRef} className="flex gap-5 overflow-x-auto no-scrollbar snap-x snap-mandatory pb-4 -mx-5 px-5 sm:mx-0 sm:px-0">
                        {novidades.map((p, i) => (
                            <div key={p.id} className="snap-start shrink-0 w-[78%] sm:w-[42%] lg:w-[23%]">
                                <ProductCard product={p} index={i} />
                            </div>
                        ))}
                    </div>
                    <button onClick={() => scrollCarousel(-1)} className="hidden lg:flex absolute -left-4 top-[40%] w-11 h-11 -translate-y-1/2 items-center justify-center bg-background border border-border hover:border-[hsl(var(--gold))] transition-colors" aria-label="Anterior">‹</button>
                    <button onClick={() => scrollCarousel(1)} className="hidden lg:flex absolute -right-4 top-[40%] w-11 h-11 -translate-y-1/2 items-center justify-center bg-background border border-border hover:border-[hsl(var(--gold))] transition-colors" aria-label="Próximo">›</button>
                </div>
                <div className="text-center mt-10">
                    <Link to="/loja?filtro=novidades" className="btn-ghost link-underline">Ver todas as novidades →</Link>
                </div>
            </Section>

            {/* CATEGORIAS */}
            <section className="bg-[hsl(var(--blush))] py-20 sm:py-28">
                <div className="container-boutique">
                    <SectionHeading eyebrow="Explorar" title="Categorias" />
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-5 mt-12">
                        {categories.map((c, i) => (
                            <CategoryCard key={c.id} category={c} index={i} />
                        ))}
                    </div>
                </div>
            </section>

            {/* BANNER CONCEITUAL */}
            {concept.image && (
                <section className="relative h-[60vh] min-h-[420px] overflow-hidden">
                    <img src={concept.image} alt={concept.title} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                    <div className="absolute inset-0 bg-charcoal/35" />
                    <div className="relative h-full container-boutique flex items-center justify-center text-center">
                        <div className="max-w-2xl text-bone animate-fade-rise">
                            <div className="flex justify-center mb-6"><BridgeHeart /></div>
                            <p className="eyebrow text-[hsl(var(--gold))]">{concept.eyebrow}</p>
                            <h2 className="mt-4 font-heading text-5xl sm:text-6xl tracking-[0.03em]">{concept.title}</h2>
                            <p className="mt-5 text-base text-bone/85 leading-relaxed max-w-xl mx-auto">{concept.text}</p>
                            {concept.primary_cta_link && (
                                <Link to={concept.primary_cta_link} className="mt-8 inline-flex items-center gap-2 border border-[hsl(var(--gold))] text-[hsl(var(--gold))] text-[11px] uppercase tracking-[0.22em] px-8 py-4 transition-all duration-500 hover:bg-[hsl(var(--gold))] hover:text-white">
                                    {concept.primary_cta_label}
                                </Link>
                            )}
                        </div>
                    </div>
                </section>
            )}

            {/* MAIS DESEJADOS */}
            <Section title="Os favoritos da D'Helenas" eyebrow="Mais desejados">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-6 mt-12">
                    {maisDesejados.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
                </div>
            </Section>

            {/* LOOK COMPLETO */}
            <section className="bg-[hsl(var(--champagne))] py-20 sm:py-28">
                <div className="container-boutique grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
                    <div className="relative overflow-hidden aspect-[3/4] max-w-md mx-auto lg:mx-0 w-full">
                        <img src={LOOK_IMAGE} alt="Complete o look" className="w-full h-full object-cover" loading="lazy" />
                    </div>
                    <div>
                        <p className="eyebrow">Editorial</p>
                        <h2 className="mt-4 font-heading text-4xl sm:text-5xl tracking-[0.03em]">Complete o look</h2>
                        <div className="gold-rule mt-6" />
                        <p className="mt-6 text-muted-foreground leading-relaxed max-w-md">
                            Uma composição pensada para transitar com elegância — peças que se conectam como histórias que se cruzam.
                        </p>
                        <div className="mt-8 space-y-4">
                            {products.slice(0, 3).map((p) => <LookLine key={p.id} product={p} />)}
                        </div>
                        <Link to="/loja" className="btn-gold mt-9">Ver peças do look</Link>
                    </div>
                </div>
            </section>

            {/* MONTE SEU LOOK */}
            <section className="bg-background py-16 sm:py-20 border-y border-border">
                <div className="container-boutique text-center">
                    <p className="eyebrow">Personalize</p>
                    <h2 className="mt-3 font-heading text-3xl sm:text-4xl lg:text-5xl tracking-[0.03em]">Monte seu Look</h2>
                    <div className="flex justify-center mt-5"><div className="gold-rule" /></div>
                    <p className="mt-6 text-muted-foreground">Crie combinações do seu jeito.</p>
                    <Link to="/monte-seu-look" className="btn-gold mt-8 inline-block">Montar meu look</Link>
                </div>
            </section>

            {/* INSTAGRAM */}
            {instImages.length > 0 && (
                <Section title="Siga a D'Helenas" eyebrow="@dhelenas.oficial">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mt-12">
                        {instImages.map((src, i) => (
                            <a key={i} href="https://instagram.com" target="_blank" rel="noreferrer" className="group relative aspect-square overflow-hidden bg-bone">
                                <img src={src} alt="Instagram D'Helenas" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" loading="lazy" />
                                <div className="absolute inset-0 bg-charcoal/0 group-hover:bg-charcoal/30 transition-colors duration-500 flex items-center justify-center">
                                    <Instagram className="w-5 h-5 text-bone opacity-0 group-hover:opacity-100 transition-opacity duration-500" strokeWidth={1.25} />
                                </div>
                            </a>
                        ))}
                    </div>
                </Section>
            )}

            <NewsletterCmp />
        </div>
    );
}

function Section({ children, title, eyebrow, id, className = "" }) {
    const { ref, visible } = useReveal();
    return (
        <section id={id} className={`py-20 sm:py-28 ${className}`}>
            <div ref={ref} className={`container-boutique reveal ${visible ? "is-visible" : ""}`}>
                <SectionHeading eyebrow={eyebrow} title={title} />
                {children}
            </div>
        </section>
    );
}

function SectionHeading({ eyebrow, title }) {
    return (
        <div className="text-center">
            <p className="eyebrow">{eyebrow}</p>
            <h2 className="mt-3 font-heading text-3xl sm:text-4xl lg:text-5xl tracking-[0.03em] text-foreground">{title}</h2>
            <div className="flex justify-center mt-5"><div className="gold-rule" /></div>
        </div>
    );
}

function CategoryCard({ category, index }) {
    const { ref, visible } = useReveal();
    return (
        <div ref={ref} className={`reveal ${visible ? "is-visible" : ""}`} style={{ transitionDelay: `${index * 90}ms` }}>
            <Link to={`/loja?cat=${category.slug}`} className="group block relative overflow-hidden aspect-[3/4] bg-bone">
                <img src={category.image} alt={category.name} className="w-full h-full object-cover transition-transform duration-1000 ease-out group-hover:scale-105" loading="lazy" />
                <div className="absolute inset-0 bg-gradient-to-t from-charcoal/55 via-transparent to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5 text-center">
                    <h3 className="font-heading text-xl sm:text-2xl text-bone tracking-[0.04em]">{category.name}</h3>
                    <span className="block mt-1 text-[9px] uppercase tracking-[0.28em] text-bone/70 group-hover:text-[hsl(var(--gold))] transition-colors">Ver peças →</span>
                </div>
            </Link>
        </div>
    );
}

function LookLine({ product }) {
    return (
        <Link to={`/produto/${product.id}`} className="flex items-center gap-4 group">
            <div className="w-16 h-20 overflow-hidden bg-bone shrink-0">
                <img src={product.images[0]} alt={product.name} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
            </div>
            <div className="flex-1">
                <p className="text-sm font-medium group-hover:text-[hsl(var(--rose))] transition-colors">{product.name}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{formatBRL(product.salePrice || product.price)} · {product.installments}x sem juros</p>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-[hsl(var(--gold))] transition-colors" strokeWidth={1.25} />
        </Link>
    );
}

function BridgeHeart() {
    return (
        <svg width="56" height="40" viewBox="0 0 56 40" fill="none" className="text-[hsl(var(--gold))]">
            <path d="M2 38 Q28 -10 54 38" stroke="currentColor" strokeWidth="1" fill="none" />
            <path d="M28 22 C25 18, 19 18, 19 23 C19 28, 28 33, 28 33 C28 33, 37 28, 37 23 C37 18, 31 18, 28 22 Z" fill="currentColor" opacity="0.85" />
        </svg>
    );
}