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
                        <p className="eyebrow text-[hsl(var(--gold))]">Nossa História</p>
                        <h1 className="mt-5 font-heading text-5xl sm:text-6xl lg:text-7xl tracking-[0.03em]">D'Helenas</h1>
                        <p className="mt-4 font-heading text-2xl sm:text-3xl italic text-bone/90">Onde tudo começou: Helena.</p>
                    </div>
                </div>
            </section>

            {/* ABERTURA */}
            <RevealSection className="py-20 sm:py-28">
                <div className="max-w-2xl mx-auto text-center">
                    <p className="font-heading text-2xl sm:text-3xl leading-relaxed text-foreground italic">
                        "Toda história tem um ponto de partida. A nossa começa com uma mulher chamada Helena."
                    </p>
                    <div className="flex justify-center mt-8"><div className="gold-rule" /></div>
                </div>
            </RevealSection>

            {/* HELENA */}
            <EditorialBlock
                image={ABOUT_IMAGE}
                eyebrow="Nossa história"
                title="Onde tudo começou"
                text="Uma mulher idônea, trabalhadora, forte e, acima de tudo, humana. Alguém que acreditava que a vida era feita de relações: de amor, carinho, respeito, afeto e da capacidade de construir pontes entre as pessoas. Helena nos ensinou, pelo exemplo, que nada se constrói sozinho."
                reverse={false}
            />

            {/* OS ENSINAMENTOS */}
            <section className="bg-[hsl(var(--blush))] py-20 sm:py-28">
                <div className="container-boutique max-w-2xl mx-auto text-center">
                    <p className="eyebrow">Os ensinamentos</p>
                    <h2 className="mt-3 font-heading text-3xl sm:text-4xl tracking-[0.03em] text-foreground">Helena nos ensinou</h2>
                    <div className="flex justify-center mt-5"><div className="gold-rule" /></div>
                    <div className="mt-10 space-y-4">
                        <p className="font-heading text-xl sm:text-2xl text-foreground italic">É preciso trabalhar.</p>
                        <p className="font-heading text-xl sm:text-2xl text-foreground italic">É preciso acreditar.</p>
                        <p className="font-heading text-xl sm:text-2xl text-foreground italic">É preciso recomeçar.</p>
                        <p className="font-heading text-xl sm:text-2xl text-foreground italic">É preciso estender a mão.</p>
                        <p className="font-heading text-xl sm:text-2xl text-[hsl(var(--rose))] italic">E, principalmente, é preciso cuidar das relações que construímos ao longo do caminho.</p>
                    </div>
                    <p className="mt-10 text-muted-foreground leading-relaxed">
                        Sua história foi marcada por trabalho, coragem, desafios e muitos recomeços. E foi justamente desses caminhos que nasceu um legado que atravessou gerações.
                    </p>
                </div>
            </section>

            {/* NASCE A D'HELENAS */}
            <EditorialBlock
                image={CATEGORY_IMAGES.vestidos}
                eyebrow="Um novo capítulo"
                title="Assim nasceu a D'Helenas"
                text="Hoje, nós, Juliane e Lucilene, suas netas, decidimos transformar esse legado em um novo capítulo. Mais do que uma marca. Um legado. A D'Helenas nasceu como uma homenagem à nossa avó, mas foi criada para olhar para o futuro. Queremos levar adiante aquilo que Helena nos ensinou: que podemos construir algo bonito quando unimos propósito, trabalho, relações e coragem para recomeçar."
                reverse={true}
            />

            {/* MÉTODO PONTE */}
            <section className="bg-[hsl(var(--rose-deep))] text-bone py-20 sm:py-28">
                <div className="container-boutique max-w-3xl mx-auto text-center">
                    <div className="flex justify-center mb-8">
                        <svg width="72" height="48" viewBox="0 0 72 48" fill="none" className="text-[hsl(var(--gold))]">
                            <path d="M2 46 Q36 -6 70 46" stroke="currentColor" strokeWidth="1" fill="none" />
                            <path d="M36 26 C32 20, 24 20, 24 28 C24 36, 36 42, 36 42 C36 42, 48 36, 48 28 C48 20, 40 20, 36 26 Z" fill="currentColor" opacity="0.85" />
                        </svg>
                    </div>
                    <p className="eyebrow text-[hsl(var(--gold))]">Método PONTE®</p>
                    <h2 className="mt-4 font-heading text-4xl sm:text-5xl tracking-[0.03em]">Por isso, nossa marca carrega o Método PONTE®</h2>
                    <p className="mt-6 text-bone/75 leading-relaxed">
                        Para nós, uma ponte representa exatamente aquilo em que acreditamos: conectar pessoas, histórias, sonhos e possibilidades.
                    </p>
                    <div className="mt-12 grid grid-cols-1 sm:grid-cols-5 gap-6">
                        <PonteLetter letter="P" word="Propósito" />
                        <PonteLetter letter="O" word="Organização" />
                        <PonteLetter letter="N" word="Networking" />
                        <PonteLetter letter="T" word="Transformação" />
                        <PonteLetter letter="E" word="Expansão Sustentável" />
                    </div>
                </div>
            </section>

            {/* A MODA COMO CONEXÃO */}
            <EditorialBlock
                image={CATEGORY_IMAGES.blusas}
                eyebrow="A moda como forma de conexão"
                title="Vestir é se reconhecer"
                text={'A D\'Helenas nasceu para vestir mulheres, mas nosso propósito vai além da roupa. Queremos que cada peça escolhida carregue uma sensação. A sensação de se olhar no espelho e pensar: "Eu gosto de quem eu sou." Queremos oferecer moda, estilo e acessórios que acompanhem mulheres em seus diferentes momentos — no trabalho, nos encontros, nas conquistas, nos recomeços e nas celebrações. Porque acreditamos que vestir-se também é uma forma de expressão, autoestima e identidade.'}
                reverse={false}
            />

            {/* DUAS NETAS */}
            <section className="bg-[hsl(var(--champagne))] py-20 sm:py-28">
                <div className="container-boutique max-w-2xl mx-auto text-center">
                    <p className="eyebrow">Duas netas. Uma história. Um propósito.</p>
                    <h2 className="mt-3 font-heading text-3xl sm:text-4xl tracking-[0.03em] text-foreground">Transformar saudade em propósito</h2>
                    <div className="flex justify-center mt-5"><div className="gold-rule" /></div>
                    <p className="mt-8 text-muted-foreground leading-relaxed">
                        Somos diferentes em nossas trajetórias, personalidades e experiências. Mas compartilhamos algo muito maior: a história que recebemos.
                    </p>
                    <div className="mt-10 space-y-3">
                        <p className="font-heading text-lg sm:text-xl text-foreground italic">Transformar saudade em propósito.</p>
                        <p className="font-heading text-lg sm:text-xl text-foreground italic">Transformar história em futuro.</p>
                        <p className="font-heading text-lg sm:text-xl text-[hsl(var(--rose))] italic">E transformar o nome Helena em uma marca que carregue consigo os valores que ela deixou: honestidade, trabalho, coragem, amor, respeito e conexão.</p>
                    </div>
                    <p className="mt-10 text-muted-foreground leading-relaxed">
                        Juliane e Lucilene decidiram transformar a lembrança da avó em movimento.
                    </p>
                </div>
            </section>

            {/* FECHAMENTO */}
            <RevealSection className="py-20 sm:py-28">
                <div className="max-w-2xl mx-auto text-center">
                    <h2 className="font-heading text-4xl sm:text-5xl tracking-[0.03em] text-foreground">D'Helenas</h2>
                    <p className="mt-4 font-heading text-xl sm:text-2xl italic text-[hsl(var(--rose))]">De Helena para nós. De nós para outras mulheres.</p>
                    <div className="flex justify-center mt-6"><div className="gold-rule" /></div>
                    <p className="mt-8 text-muted-foreground leading-relaxed">
                        Cada produto que chega até você carrega um pouco dessa história. E cada mulher que escolhe a D'Helenas passa a fazer parte dela. Porque, no fim, é isso que uma ponte faz: ela conecta histórias.
                    </p>
                    <p className="mt-8 font-heading text-lg text-foreground tracking-wide">
                        D'Helenas — Moda que conecta. Histórias que permanecem.
                    </p>
                    <p className="mt-2 text-[10px] uppercase tracking-[0.32em] text-[hsl(var(--gold))]">Método PONTE®</p>
                </div>
            </RevealSection>

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

function PonteLetter({ letter, word }) {
    return (
        <div className="text-center">
            <span className="block font-heading text-4xl sm:text-5xl text-[hsl(var(--gold))]">{letter}</span>
            <span className="block mt-2 text-[10px] uppercase tracking-[0.18em] text-bone/70">{word}</span>
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
