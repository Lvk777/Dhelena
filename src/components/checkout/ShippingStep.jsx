import React, { useEffect, useRef, useState } from "react";
import { Truck, Store, Loader2, AlertCircle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { formatBRL } from "@/data/products";

export default function ShippingStep({ cep, products, quoteContextKey, shippingMethod, shippingQuoteId, shippingCost, onShippingSelect, onQuoteLoading, pickupEnabled, pickupName, pickupTime, freeShipping }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [options, setOptions] = useState([]);
    const cleanCep = (cep || "").replace(/\D/g, "");
    const itemKey = JSON.stringify(products.map(({ productId, qty }) => ({ productId, qty })));
    const selectedRef = useRef(null);
    selectedRef.current = { method: shippingMethod, quoteId: shippingQuoteId, cost: shippingCost };

    useEffect(() => {
        let current = true;
        setOptions([]);
        setError("");
        if (cleanCep.length !== 8) { onQuoteLoading(false); return () => { current = false; }; }
        setLoading(true);
        onQuoteLoading(true);
        base44.functions.invoke("calculateShipping", { to_postal_code: cleanCep, items: JSON.parse(itemKey) })
            .then((res) => {
                if (!current) return;
                const validOptions = (res.options || []).filter((option) => option.id != null && Number.isFinite(Number(option.price)) && Number(option.price) >= 0);
                setOptions(validOptions);
                const selected = selectedRef.current;
                if (selected.method === "melhor_envio") {
                    const currentOption = validOptions.find((option) => String(option.id) === String(selected.quoteId));
                    if (!currentOption) onShippingSelect({ method: "", cost: null, quoteId: null });
                    else if (Number(currentOption.price) !== Number(selected.cost)) onShippingSelect({ method: "melhor_envio", cost: Number(currentOption.price), carrier: currentOption.company, serviceName: currentOption.name, deliveryTime: currentOption.delivery_time, quoteId: currentOption.id });
                }
                if (!validOptions.length) setError("Nenhuma opção de frete encontrada para este CEP.");
            }).catch((e) => {
                if (current) {
                    if (selectedRef.current.method === "melhor_envio") onShippingSelect({ method: "", cost: null, quoteId: null });
                    setError(e.response?.data?.error || e.message || "Não foi possível calcular o frete.");
                }
            }).finally(() => { if (current) { setLoading(false); onQuoteLoading(false); } });
        return () => { current = false; };
    }, [cleanCep, itemKey, quoteContextKey]);

    return <div className="space-y-4" role="radiogroup" aria-label="Opções de entrega">
        {pickupEnabled && <button type="button" role="radio" aria-checked={shippingMethod === "retirada"}
            onClick={() => onShippingSelect({ method: "retirada", cost: 0, quoteId: null })}
            className={`w-full flex items-center gap-4 p-5 border text-left min-h-14 ${shippingMethod === "retirada" ? "border-[hsl(var(--gold))] bg-[hsl(var(--gold))]/5" : "border-border hover:border-foreground/40"}`}>
            <Store className="w-5 h-5 text-[hsl(var(--gold))]" />
            <span className="flex-1"><span className="block text-sm font-medium">{pickupName || "Retirada no estoque"}</span><span className="block text-xs text-muted-foreground">{pickupTime || "Retire em nosso endereço"}</span></span>
            <span className="text-sm">Grátis</span><SelectionDot selected={shippingMethod === "retirada"} />
        </button>}
        {loading && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="w-4 h-4 animate-spin" /> Calculando frete...</p>}
        {error && !loading && <p className="flex items-center gap-2 text-sm text-amber-700" role="alert"><AlertCircle className="w-4 h-4" /> {error}</p>}
        {!loading && options.map((opt) => {
            const selected = shippingMethod === "melhor_envio" && String(shippingQuoteId) === String(opt.id);
            return <button key={opt.id} type="button" role="radio" aria-checked={selected}
                onClick={() => onShippingSelect({ method: "melhor_envio", cost: Number(opt.price), carrier: opt.company, serviceName: opt.name, deliveryTime: opt.delivery_time, quoteId: opt.id })}
                className={`w-full flex items-center gap-4 p-5 border text-left min-h-14 ${selected ? "border-[hsl(var(--gold))] bg-[hsl(var(--gold))]/5" : "border-border hover:border-foreground/40"}`}>
                <Truck className="w-5 h-5 text-[hsl(var(--gold))] shrink-0" />
                <span className="flex-1"><span className="block text-sm font-medium">{opt.company} · {opt.name}</span><span className="block text-xs text-muted-foreground">{opt.delivery_time ? `${opt.delivery_time} dias úteis` : "Prazo não informado"}</span></span>
                <span className="text-sm font-medium">{freeShipping ? "Grátis" : formatBRL(opt.price)}</span><SelectionDot selected={selected} />
            </button>;
        })}
    </div>;
}

function SelectionDot({ selected }) {
    return <span aria-hidden="true" className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${selected ? "border-[hsl(var(--gold))]" : "border-border"}`}>
        {selected && <span className="w-2.5 h-2.5 rounded-full bg-[hsl(var(--gold))]" />}
    </span>;
}
