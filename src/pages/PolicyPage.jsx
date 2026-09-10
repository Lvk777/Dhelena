import React from "react";
import { useReveal } from "@/hooks/useReveal";
import { usePublicSettings } from "@/context/PublicSettingsContext";
import useSEO from "@/lib/useSEO";

const POLICIES = {
    "trocas-e-devolucoes": {
        policyKey: "return_policy",
        title: "Trocas e Devoluções",
        description: "Política de troca e devolução da D'Helenas. Conheça prazos, condições e procedimentos.",
    },
    "politica-de-privacidade": {
        policyKey: "privacy_policy",
        title: "Política de Privacidade",
        description: "Como a D'Helenas coleta, usa e protege seus dados pessoais.",
    },
    "termos-de-uso": {
        policyKey: "terms_of_use",
        title: "Termos de Uso",
        description: "Termos e condições de uso do site e serviços da D'Helenas.",
    },
    "politica-de-entrega": {
        policyKey: "shipping_policy",
        title: "Política de Entrega",
        description: "Prazos, áreas de cobertura e condições de entrega da D'Helenas.",
    },
};

/**
 * Renders plain-text policy content safely (no HTML, no XSS).
 * Splits by double-newlines into paragraphs, single newlines into <br/>.
 */
function PolicyContent({ text }) {
    if (!text || !text.trim()) {
        return (
            <p className="text-center text-muted-foreground italic text-lg py-12">
                Este conteúdo está sendo atualizado.
            </p>
        );
    }

    const paragraphs = text.trim().split(/\n{2,}/);

    return (
        <div className="space-y-5">
            {paragraphs.map((para, i) => {
                const lines = para.split("\n");
                return (
                    <p key={i} className="text-foreground/85 leading-[1.9] text-[15px]">
                        {lines.map((line, j) => (
                            <React.Fragment key={j}>
                                {line}
                                {j < lines.length - 1 && <br />}
                            </React.Fragment>
                        ))}
                    </p>
                );
            })}
        </div>
    );
}

export default function PolicyPage({ slug }) {
    const config = POLICIES[slug];
    const { settings, loading } = usePublicSettings();
    const { ref, visible } = useReveal();

    useSEO({
        title: config.title,
        description: config.description,
        url: `/${slug}`,
    });

    const content = settings.policies?.[config.policyKey] || "";

    return (
        <div>
            {/* Header */}
            <section className="bg-[hsl(var(--bone))] py-16 sm:py-20 border-b border-border">
                <div className="container-boutique text-center">
                    <p className="eyebrow text-[hsl(var(--gold))]">D'Helenas</p>
                    <h1 className="mt-4 font-heading text-4xl sm:text-5xl lg:text-6xl tracking-[0.03em] text-foreground">
                        {config.title}
                    </h1>
                    <div className="flex justify-center mt-5">
                        <div className="gold-rule" />
                    </div>
                </div>
            </section>

            {/* Content */}
            <section className="py-16 sm:py-24">
                <div ref={ref} className={`container-boutique reveal ${visible ? "is-visible" : ""}`}>
                    <div className="max-w-2xl mx-auto">
                        {loading ? (
                            <div className="space-y-4">
                                {[...Array(4)].map((_, i) => (
                                    <div key={i} className="h-4 bg-[hsl(var(--bone))] rounded animate-pulse" style={{ width: `${85 - i * 10}%` }} />
                                ))}
                            </div>
                        ) : (
                            <PolicyContent text={content} />
                        )}
                    </div>
                </div>
            </section>
        </div>
    );
}
