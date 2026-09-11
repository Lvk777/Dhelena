import React, { useState, useEffect } from "react";
import { Truck, Store, Loader2, AlertCircle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { formatBRL } from "@/data/products";

export default function ShippingStep({ cep, products, totalValue, shippingMethod, onShippingSelect, pickupEnabled, pickupName, pickupTime }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [options, setOptions] = useState([]);
    const [melhorEnvioEnabled, setMelhorEnvioEnabled] = useState(true);

    const cleanCep = (cep || "").replace(/\D/g, "");

    useEffect(() => {
        if (shippingMethod === "retirada") return;
        if (!cleanCep || cleanCep.length !== 8) return;
        fetchQuote();
    }, [cleanCep]);

    const fetchQuote = async () => {
        setLoading(true);
        setError("");
        try {
            const res = await base44.functions.invoke("calculateShipping", {
                to_postal_code: cleanCep,
                products: products.map((p) => ({ qty: p.qty, weight: 300, height: 10, width: 15, length: 20 })),
                total_value: totalValue,
            });
            setOptions(res.options || []);
            if ((res.options || []).length === 0) {
                setError("Nenhuma opção de frete encontrada para este CEP.");
            }
        } catch (e) {
            const msg = e.response?.data?.error || e.message || "";
            if (msg.includes("não está ativado") || msg.includes("não configurad")) {
                setMelhorEnvioEnabled(false);
                setError("Melhor Envio não está ativado. Selecione retirada ou configure o frete no admin.");
            } else {
                setError(msg || "Erro ao calcular frete");
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-4">
            {/* Retirada option */}
            {pickupEnabled && (
                <button
                    onClick={() => onShippingSelect({ method: "retirada", cost: 0, carrier: null, serviceName: null, deliveryTime: null, quoteId: null })}
                    className={`w-full flex items-center gap-4 p-5 border text-left transition-colors ${shippingMethod === "retirada" ? "border-[hsl(var(--gold))] bg-[hsl(var(--gold))]/5" : "border-border hover:border-foreground/40"}`}
                >
                    <Store className="w-5 h-5 text-[hsl(var(--gold))]" strokeWidth={1.25} />
                    <div className="flex-1">
                        <p className="text-sm font-medium">{pickupName || "Retirada no estoque"}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{pickupTime || "Retire em nosso endereço"}</p>
                    </div>
                    <span className="text-sm font-medium">Grátis</span>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${shippingMethod === "retirada" ? "border-[hsl(var(--gold))]" : "border-border"}`}>
                        {shippingMethod === "retirada" && <div className="w-2.5 h-2.5 rounded-full bg-[hsl(var(--gold))]" />}
                    </div>
                </button>
            )}

            {/* Melhor Envio options */}
            {melhorEnvioEnabled && shippingMethod !== "retirada" && (
                <>
                    {loading && (
                        <div className="flex items-center gap-3 p-5 border border-border text-sm text-muted-foreground">
                            <Loader2 className="w-4 h-4 animate-spin" /> Calculando frete via Melhor Envio...
                        </div>
                    )}

                    {error && !loading && (
                        <div className="flex items-start gap-2 p-4 border border-amber-500/30 bg-amber-500/5 text-sm text-amber-700">
                            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.5} />
                            <span>{error}</span>
                        </div>
                    )}

                    {!loading && !error && options.map((opt) => (
                        <button
                            key={opt.id || opt.name}
                            onClick={() => onShippingSelect({
                                method: "melhor_envio",
                                cost: opt.price,
                                carrier: opt.company,
                                serviceName: opt.name,
                                deliveryTime: opt.delivery_time,
                                quoteId: opt.id,
                            })}
                            className={`w-full flex items-center justify-between p-5 border text-left transition-colors ${shippingMethod === "melhor_envio" && shippingMethod !== "retirada" ? "border-[hsl(var(--gold))] bg-[hsl(var(--gold))]/5" : "border-border hover:border-foreground/40"}`}
                        >
                            <div className="flex items-center gap-3">
                                <Truck className="w-5 h-5 text-[hsl(var(--gold))] shrink-0" strokeWidth={1.25} />
                                <div>
                                    <p className="text-sm font-medium">{opt.company}</p>
                                    <p className="text-[11px] text-muted-foreground mt-0.5">
                                        {opt.name} · {opt.delivery_time ? `${opt.delivery_time} dia(s) úteis` : "Prazo não informado"}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="text-sm font-medium">{formatBRL(opt.price)}</span>
                                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${shippingMethod === "melhor_envio" ? "border-[hsl(var(--gold))]" : "border-border"}`}>
                                    {shippingMethod === "melhor_envio" && <div className="w-2.5 h-2.5 rounded-full bg-[hsl(var(--gold))]" />}
                                </div>
                            </div>
                        </button>
                    ))}

                    {!loading && !error && options.length === 0 && cleanCep?.length === 8 && (
                        <p className="text-sm text-muted-foreground p-4">Nenhuma opção de frete disponível.</p>
                    )}
                </>
            )}
        </div>
    );
}
