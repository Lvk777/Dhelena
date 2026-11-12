import React from "react";
import { Link } from "react-router-dom";

export default function Newsletter() {
    return (
        <section className="py-20 sm:py-28 bg-[hsl(var(--rose-deep))] text-on-dark">
            <div className="container-boutique text-center max-w-xl mx-auto">
                <p className="text-[11px] uppercase tracking-[0.32em] text-on-dark/90">D'Helenas</p>
                <h2 className="mt-4 font-heading text-4xl sm:text-5xl tracking-[0.03em]">Vamos conversar</h2>
                <p className="mt-4 text-on-dark/90 leading-relaxed">Tem alguma dúvida sobre a boutique ou seus pedidos? Entre em contato com a nossa equipe.</p>
                <Link to="/contato" className="inline-flex min-h-11 items-center justify-center mt-8 px-8 py-4 border border-on-dark text-on-dark text-sm hover:bg-on-dark hover:text-charcoal transition-colors">
                    Ir para contato
                </Link>
            </div>
        </section>
    );
}
