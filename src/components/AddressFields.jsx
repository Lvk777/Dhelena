import React, { useRef, useId } from "react";
import { maskCEP } from "@/lib/forms";
import { useCepLookup } from "@/hooks/useCepLookup";

const UF = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

export default function AddressFields({ form, set, disabled = false, errors = /** @type {Record<string, string>} */ ({}) }) {
    const { cepStatus, lookup } = useCepLookup();
    const numberRef = useRef(null);
    const id = useId();

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
                <label htmlFor={id + "-cep"} className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">CEP *</label>
                <input
                    disabled={disabled} id={id + "-cep"} aria-invalid={!!errors.cep} aria-describedby={errors.cep ? id + "-cep-error" : undefined} autoComplete="postal-code" inputMode="numeric"
                    value={form.cep || ""}
                    onChange={(e) => handleCepChange(e.target.value)}
                    placeholder="00000-000"
                    className={`w-full border bg-background px-4 py-3 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors ${errClass("cep")}`}
                />
                {cepStatus === "searching" && <p className="text-[11px] text-muted-foreground mt-1">Buscando endereço...</p>}
                {cepStatus === "not_found" && <p className="text-[11px] text-[hsl(var(--rose))] mt-1">CEP não encontrado. Confira o número informado.</p>}
                {cepStatus === "error" && <p className="text-[11px] text-muted-foreground mt-1">Não foi possível consultar o CEP agora. Preencha o endereço manualmente.</p>}
                {errors.cep && <p id={id + "-cep-error"} className="text-[11px] text-[hsl(var(--rose))] mt-1">{errors.cep}</p>}
            </div>
            <div>
                <label htmlFor={id + "-state"} className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Estado *</label>
                <select
                    disabled={disabled} id={id + "-state"} aria-invalid={!!errors.state} aria-describedby={errors.state ? id + "-state-error" : undefined} autoComplete="address-level1"
                    value={form.state || "SP"}
                    onChange={(e) => set("state", e.target.value)}
                    className={`w-full border bg-background px-4 py-3 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors ${errClass("state")}`}
                >
                    {UF.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                </select>
                {errors.state && <p id={id + "-state-error"} className="text-[11px] text-[hsl(var(--rose))] mt-1">{errors.state}</p>}
            </div>

            {/* Rua */}
            <div className="sm:col-span-2">
                <label htmlFor={id + "-street"} className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Rua *</label>
                <input
                    disabled={disabled} id={id + "-street"} aria-invalid={!!errors.street} aria-describedby={errors.street ? id + "-street-error" : undefined} autoComplete="street-address"
                    value={form.street || ""}
                    onChange={(e) => set("street", e.target.value)}
                    className={`w-full border bg-background px-4 py-3 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors ${errClass("street")}`}
                />
                {errors.street && <p id={id + "-street-error"} className="text-[11px] text-[hsl(var(--rose))] mt-1">{errors.street}</p>}
            </div>

            {/* Número + Complemento */}
            <div>
                <label htmlFor={id + "-number"} className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Número *</label>
                <input
                    ref={numberRef}
                    disabled={disabled} id={id + "-number"} aria-invalid={!!errors.number} aria-describedby={errors.number ? id + "-number-error" : undefined}
                    value={form.number || ""}
                    onChange={(e) => set("number", e.target.value)}
                    className={`w-full border bg-background px-4 py-3 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors ${errClass("number")}`}
                />
                {errors.number && <p id={id + "-number-error"} className="text-[11px] text-[hsl(var(--rose))] mt-1">{errors.number}</p>}
            </div>
            <div>
                <label htmlFor={id + "-complement"} className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Complemento</label>
                <input
                    disabled={disabled} id={id + "-complement"} aria-invalid={!!errors.complement} autoComplete="address-line2"
                    value={form.complement || ""}
                    onChange={(e) => set("complement", e.target.value)}
                    className="w-full border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors"
                />
            </div>

            {/* Bairro + Cidade */}
            <div>
                <label htmlFor={id + "-district"} className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Bairro *</label>
                <input
                    disabled={disabled} id={id + "-district"} aria-invalid={!!errors.district} aria-describedby={errors.district ? id + "-district-error" : undefined}
                    value={form.district || ""}
                    onChange={(e) => set("district", e.target.value)}
                    className={`w-full border bg-background px-4 py-3 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors ${errClass("district")}`}
                />
                {errors.district && <p id={id + "-district-error"} className="text-[11px] text-[hsl(var(--rose))] mt-1">{errors.district}</p>}
            </div>
            <div>
                <label htmlFor={id + "-city"} className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Cidade *</label>
                <input
                    disabled={disabled} id={id + "-city"} aria-invalid={!!errors.city} aria-describedby={errors.city ? id + "-city-error" : undefined} autoComplete="address-level2"
                    value={form.city || ""}
                    onChange={(e) => set("city", e.target.value)}
                    className={`w-full border bg-background px-4 py-3 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors ${errClass("city")}`}
                />
                {errors.city && <p id={id + "-city-error"} className="text-[11px] text-[hsl(var(--rose))] mt-1">{errors.city}</p>}
            </div>
        </div>
    );
}
