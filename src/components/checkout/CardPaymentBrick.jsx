import React, { useState, useEffect, useRef } from "react";
import { Loader2, CreditCard, AlertCircle, Check } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { formatBRL } from "@/data/products";

// Loads Mercado Pago SDK v2 from CDN
function loadMPSdk(publicKey) {
    return new Promise((resolve, reject) => {
        if (window.MercadoPago) {
            resolve(new window.MercadoPago(publicKey));
            return;
        }
        const script = document.createElement("script");
        script.src = "https://sdk.mercadopago.com/js/v2";
        script.onload = () => {
            if (window.MercadoPago) {
                resolve(new window.MercadoPago(publicKey));
            } else {
                reject(new Error("Falha ao carregar SDK do Mercado Pago"));
            }
        };
        script.onerror = () => reject(new Error("Falha ao carregar SDK do Mercado Pago"));
        document.head.appendChild(script);
    });
}

export default function CardPaymentBrick({ order, publicKey, amount, maxInstallments, onApproved, onRejected }) {
    const containerRef = useRef(null);
    const brickRef = useRef(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [processing, setProcessing] = useState(false);
    const [result, setResult] = useState(null);

    useEffect(() => {
        initBrick();
        return () => { if (brickRef.current) brickRef.current.unmount?.(); };
    }, []);

    const initBrick = async () => {
        try {
            setLoading(true);
            setError("");
            const mp = await loadMPSdk(publicKey);
            const bricks = mp.bricks();

            brickRef.current = await bricks.create("card", "card-payment-brick-container", {
                initialization: {
                    amount: Number(amount),
                },
                customization: {
                    paymentMethods: {
                        creditCard: { maxInstallments: maxInstallments || 12 },
                        debitCard: { maxInstallments: 1 },
                    },
                    visual: {
                        style: { theme: "default" },
                    },
                },
                callbacks: {
                    onReady: () => setLoading(false),
                    onError: (e) => {
                        console.error("[Card Brick] Error:", e);
                        setLoading(false);
                    },
                    onSubmit: async (formData) => {
                        // formData contains: token, payment_method_id, issuer_id, installments, payer, etc.
                        setProcessing(true);
                        try {
                            const res = await base44.functions.invoke("createCardPayment", {
                                orderId: order.id,
                                card_token: formData.token,
                                installments: formData.installments,
                                payment_method_id: formData.payment_method_id,
                                issuer_id: formData.issuer_id,
                            });

                            setResult(res);
                            if (res.payment_status === "approved") {
                                onApproved?.(res);
                            } else if (res.payment_status === "rejected") {
                                onRejected?.(res);
                                setError("Cartão recusado. Verifique os dados ou tente outro cartão.");
                            }
                            return res;
                        } catch (e) {
                            const msg = e.response?.data?.error || e.message || "Erro ao processar pagamento";
                            setError(msg);
                            onRejected?.({ payment_status: "rejected", error: msg });
                            throw e;
                        } finally {
                            setProcessing(false);
                        }
                    },
                },
            });
        } catch (e) {
            setError(e.message || "Erro ao carregar formulário de cartão");
            setLoading(false);
        }
    };

    if (result?.payment_status === "approved") {
        return (
            <div className="text-center py-12">
                <div className="w-16 h-16 rounded-full bg-green-600 mx-auto flex items-center justify-center">
                    <Check className="w-8 h-8 text-white" strokeWidth={1.5} />
                </div>
                <p className="mt-4 text-sm text-green-600 font-medium">Pagamento aprovado!</p>
                {result.installments > 1 && (
                    <p className="mt-1 text-xs text-muted-foreground">{result.installments}x de {formatBRL(Number(amount) / result.installments)}</p>
                )}
            </div>
        );
    }

    return (
        <div>
            <div className="text-center mb-6">
                <h2 className="font-heading text-2xl tracking-[0.03em]">Pagamento via Cartão</h2>
                <div className="flex justify-center mt-3"><div className="gold-rule" /></div>
                <p className="mt-4 text-sm text-muted-foreground">Pedido <strong className="text-foreground">{order.order_number}</strong></p>
                <p className="text-2xl font-heading mt-2">{formatBRL(Number(amount))}</p>
            </div>

            {error && (
                <div className="flex items-start gap-2 p-4 bg-red-500/5 border border-red-500/20 text-sm text-red-600 mb-4">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.5} />
                    <div>
                        <p>{error}</p>
                        <p className="text-xs mt-1">Você pode revisar os dados do cartão e tentar novamente.</p>
                    </div>
                </div>
            )}

            {loading && (
                <div className="flex flex-col items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-[hsl(var(--gold))]" />
                    <p className="mt-4 text-sm text-muted-foreground">Carregando formulário de cartão...</p>
                </div>
            )}

            <div id="card-payment-brick-container" ref={containerRef} />

            {processing && (
                <div className="fixed inset-0 bg-background/80 flex items-center justify-center z-50">
                    <div className="flex flex-col items-center">
                        <Loader2 className="w-10 h-10 animate-spin text-[hsl(var(--gold))]" />
                        <p className="mt-4 text-sm text-muted-foreground">Processando pagamento...</p>
                    </div>
                </div>
            )}

            <p className="text-[10px] text-muted-foreground mt-4 text-center">
                <CreditCard className="w-3 h-3 inline mr-1" strokeWidth={1.5} />
                Seus dados de cartão são tokenizados pelo Mercado Pago. Nenhum dado sensível é armazenado.
            </p>
        </div>
    );
}
