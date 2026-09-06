import React, { useState } from "react";
import { useStore } from "@/context/StoreContext";

export default function Newsletter() {
    const { showToast } = useStore();
    const [email, setEmail] = useState("");

    const submit = (e) => {
        e.preventDefault();
        if (!email.trim()) return;
        showToast("Inscrição confirmada. Bem-vinda à D'Helenas ♡");
        setEmail("");
    };

    return (
        <section className="py-20 sm:py-28 bg-[hsl(var(--rose-deep))] text-bone">
            <div className="container-boutique text-center max-w-xl mx-auto">
                <p className="text-[11px] uppercase tracking-[0.32em] text-[hsl(var(--gold))]">Newsletter</p>
                <h2 className="mt-4 font-heading text-4xl sm:text-5xl tracking-[0.03em]">Faça parte da D'Helenas</h2>
                <p className="mt-4 text-bone/70 leading-relaxed">Receba novidades, lançamentos e condições especiais.</p>
                <form onSubmit={submit} className="mt-8 flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
                    <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Seu melhor e-mail"
                        className="flex-1 bg-transparent border border-bone/25 px-5 py-4 text-sm text-bone placeholder:text-bone/40 focus:border-[hsl(var(--gold))] focus:outline-none transition-colors"
                    />
                    <button type="submit" className="bg-[hsl(var(--gold))] text-charcoal text-[11px] uppercase tracking-[0.22em] px-8 py-4 transition-colors hover:bg-bone">
                        Quero receber
                    </button>
                </form>
            </div>
        </section>
    );
}