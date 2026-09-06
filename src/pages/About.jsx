import React from "react";
import { Link } from "react-router-dom";
import { useReveal } from "@/hooks/useReveal";
import { ABOUT_IMAGE, HERO_IMAGE, CATEGORY_IMAGES } from "@/data/products";

export default function About() {
    return (
        <div>
            {/* hero */}
            <section className="relative h-[70vh] min-h-[460px] overflow-hidden">
                <img src={HERO_IMAGE} alt="D'Helenas" className="absolute inset-0 w-full h-full object-cover" />
                <div className="absolute inset-0 bg-charcoal/40" />
                <div className="relative h-full container-boutique flex items-center justify-center text-center text-bone">
                    <div className="max-w-2xl animate-fade-rise">
                        <p className="eyebrow text-[hsl(var(--gold))]">Método Ponte</p>
                        <h1 className="mt-5 font-heading text-5xl sm:text-6xl lg:text-7xl tracking-[0.03em]">D'Helenas</h1>
                        <p className="mt-4 font-heading text-2xl sm:text-3xl italic text-bone/90">Mais que moda. Uma ponte entre histórias.</p>
                    </div>
                </div>
            </section>

            {/* intro */}
            <RevealSection className="py-20 sm:py-28">
                <div className="max-w-2xl mx-auto text-center">
                    <p className="font-heading text-2xl sm:text-3xl leading-relaxed text-foreground italic">
                        "Mais que moda, conectamos mulheres, histórias e legados."
                    </p>
                    <div className="flex justify-center mt-8"><div className="gold-rule" /></div>
                    <p className="mt-8 text-muted-foreground leading-relaxed">
                        A D'Helenas nasce da crença de que a moda pode ser um fio que une gerações. Cada peça é escolhida para acompanhar mulheres em diferentes capítulos de suas vidas — celebrando estilo, elegância e personalidade.
                    </p>
                </div>
            </RevealSection>

            {/* NOSSA HISTÓRIA */}
            <EditorialBlock
                image={ABOUT_IMAGE}
                eyebrow="Nossa história"
                title="Onde tudo começou"
                text="Tudo começou com Lucilene — uma mulher que enxergou na moda uma forma de cuidar e conectar pessoas. A D'Helenas nasce desse desejo: criar um espaço onde cada peça seja uma ponte entre mulheres e os momentos que vivem. De mães para filhas, de amigas para amigas, cada escolha carrega a ideia de que a beleza se fortalece quando é compartilhada."
                reverse={false}
            />

            {/* NOSSO PROPÓSITO */}
            <EditorialBlock
                image={CATEGORY_IMAGES.blusas}
                eyebrow="Nosso propósito"
                title="Vestir é um ato de cuidado"
                text="Acreditamos que escolher uma peça é, antes de tudo, escolher como se quer habitar o mundo. Por isso curamos cada coleção com atenção aos detalhes, aos tecidos e aos caimentos — para que cada mulher se sinta vista, acolhida e única."
                reverse={true}
            />

            {/* MÉTODO PONTE */}
            <section className="bg-[hsl(var(--charcoal))] text-bone py-20 sm:py-28">
                <div className="container-boutique max-w-3xl mx-auto text-center">
                    <div className="flex justify-center mb-8">
                        <svg width="72" height="48" viewBox="0 0 72 48" fill="none" className="text-[hsl(var(--gold))]">
                            <path d="M2 46 Q36 -6 70 46" stroke="currentColor" strokeWidth="1" fill="none" />
                            <path d="M36 26 C32 20, 24 20, 24 28 C24 36, 36 42, 36 42 C36 42, 48 36, 48 28 C48 20, 40 20, 36 26 Z" fill="currentColor" opacity="0.85" />
                        </svg>
                    </div>
                    <p className="eyebrow text-[hsl(var(--gold))]">Método Ponte</p>
                    <h2 className="mt-4 font-heading text-4xl sm:text-5xl tracking-[0.03em]">A ponte que nos define</h2>
                    <p className="mt-6 text-bone/75 leading-relaxed">
                        O símbolo da D'Helenas é uma ponte sustentada por um coração. Ele representa a conexão entre mulheres de idades, histórias e estilos diferentes — e a ideia de que a beleza se fortalece quando é compartilhada. Nossa moda existe para construir essas pontes.
                    </p>
                </div>
            </section>

            {/* D'HELENAS */}
            <EditorialBlock
                image={CATEGORY_IMAGES.vestidos}
                eyebrow="D'Helenas"
                title="Uma boutique com alma"
                text="Mais do que uma loja, somos um espaço de pertencimento. Aqui, cada atendimento é uma conversa, cada peça uma escolha conjunta. Recebemos mulheres de todas as gerações e as convidamos a fazer parte de uma rede de afeto que se veste de elegância."
                reverse={false}
            />

            {/* CTA */}
            <section className="py-24 sm:py-32 text-center bg-[hsl(var(--bone))]">
                <div className="container-boutique max-w-xl">
                    <h2 className="font-heading text-4xl sm:text-5xl tracking-[0.03em]">Faça parte dessa história.</h2>
                    <div className="flex justify-center mt-5"><div className="gold-rule" /></div>
                    <Link to="/loja" className="btn-gold mt-9">Conheça nossa coleção</Link>
                </div>
            </section>
        </div>
    );
}

function EditorialBlock({ image, eyebrow, title, text, reverse }) {
    const { ref, visible } = useReveal();
    return (
        <section ref={ref} className={`py-20 sm:py-28 ${visible ? "is-visible" : ""} reveal`}>
            <div className="container-boutique grid lg:grid-cols-2 gap-10 lg:gap-20 items-center">
                <div className={`relative overflow-hidden aspect-[4/3] ${reverse ? "lg:order-2" : ""}`}>
                    <img src={image} alt={title} className="w-full h-full object-cover" />
                </div>
                <div className={`${reverse ? "lg:order-1" : ""}`}>
                    <p className="eyebrow">{eyebrow}</p>
                    <h2 className="mt-3 font-heading text-4xl sm:text-5xl tracking-[0.03em]">{title}</h2>
                    <div className="gold-rule mt-6" />
                    <p className="mt-6 text-muted-foreground leading-relaxed">{text}</p>
                </div>
            </div>
        </section>
    );
}

function RevealSection({ children, className = "" }) {
    const { ref, visible } = useReveal();
    return (
        <section ref={ref} className={`reveal ${visible ? "is-visible" : ""} ${className}`}>
            <div className="container-boutique">{children}</div>
        </section>
    );
}