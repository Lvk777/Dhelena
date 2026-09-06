import React, { useRef } from "react";
import { maskCEP } from "@/lib/forms";
import { useCepLookup } from "@/hooks/useCepLookup";

const UF = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

export default function AddressFields({ form, set, errors = {} }) {
    const { cepStatus, lookup } = useCepLookup();
    const numberRef = useRef(null);

    const handleCepChange = (v) => {
        const masked = maskCEP(v);
        set("cep", masked);
        lookup(masked, (result) => {
            if (result) {
                if (result.street) set("street", result.street);
                if (result.district) set("district", result.district);
                if (result.city) set("city", result.city);
                if (result.state) set("state", result.state);
                setTimeout(() => numberRef.current?.focus(), 100);
            }
        });
    };

    const errClass = (field) => errors[field] ? "border-[hsl(var(--rose))]" : "border-border";

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* CEP + Estado */}
            <div>
                <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">CEP *</label>
                <input
                    value={form.cep || ""}
                    onChange={(e) => handleCepChange(e.target.value)}
                    placeholder="00000-000"
                    className={`w-full border bg-background px-4 py-3 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors ${errClass("cep")}`}
                />
                {cepStatus === "searching" && <p className="text-[11px] text-muted-foreground mt-1">Buscando endereço...</p>}
                {cepStatus === "not_found" && <p className="text-[11px] text-[hsl(var(--rose))] mt-1">CEP não encontrado. Confira o número informado.</p>}
                {cepStatus === "error" && <p className="text-[11px] text-muted-foreground mt-1">Não foi possível consultar o CEP agora. Preencha o endereço manualmente.</p>}
                {errors.cep && <p className="text-[11px] text-[hsl(var(--rose))] mt-1">{errors.cep}</p>}
            </div>
            <div>
                <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Estado *</label>
                <select
                    value={form.state || "SP"}
                    onChange={(e) => set("state", e.target.value)}
                    className={`w-full border bg-background px-4 py-3 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors ${errClass("state")}`}
                >
                    {UF.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                </select>
                {errors.state && <p className="text-[11px] text-[hsl(var(--rose))] mt-1">{errors.state}</p>}
            </div>

            {/* Rua */}
            <div className="sm:col-span-2">
                <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Rua *</label>
                <input
                    value={form.street || ""}
                    onChange={(e) => set("street", e.target.value)}
                    className={`w-full border bg-background px-4 py-3 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors ${errClass("street")}`}
                />
                {errors.street && <p className="text-[11px] text-[hsl(var(--rose))] mt-1">{errors.street}</p>}
            </div>

            {/* Número + Complemento */}
            <div>
                <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Número *</label>
                <input
                    ref={numberRef}
                    value={form.number || ""}
                    onChange={(e) => set("number", e.target.value)}
                    className={`w-full border bg-background px-4 py-3 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors ${errClass("number")}`}
                />
                {errors.number && <p className="text-[11px] text-[hsl(var(--rose))] mt-1">{errors.number}</p>}
            </div>
            <div>
                <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Complemento</label>
                <input
                    value={form.complement || ""}
                    onChange={(e) => set("complement", e.target.value)}
                    className="w-full border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors"
                />
            </div>

            {/* Bairro + Cidade */}
            <div>
                <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Bairro *</label>
                <input
                    value={form.district || ""}
                    onChange={(e) => set("district", e.target.value)}
                    className={`w-full border bg-background px-4 py-3 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors ${errClass("district")}`}
                />
                {errors.district && <p className="text-[11px] text-[hsl(var(--rose))] mt-1">{errors.district}</p>}
            </div>
            <div>
                <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Cidade *</label>
                <input
                    value={form.city || ""}
                    onChange={(e) => set("city", e.target.value)}
                    className={`w-full border bg-background px-4 py-3 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors ${errClass("city")}`}
                />
                {errors.city && <p className="text-[11px] text-[hsl(var(--rose))] mt-1">{errors.city}</p>}
            </div>
        </div>
    );
}