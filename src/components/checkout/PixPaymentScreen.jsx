import React, { useState, useEffect, useRef } from "react";
import { QrCode, Copy, Check, Loader2, Clock, AlertCircle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { formatBRL, PAYMENT_STATUS_PT, PAYMENT_STATUS_COLORS } from "@/data/products";

export default function PixPaymentScreen({ order, onApproved, onExpired }) {
    const [pixData, setPixData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [copied, setCopied] = useState(false);
    const [status, setStatus] = useState("pending");
    const [statusDetail, setStatusDetail] = useState("");
    const pollRef = useRef(null);

    // Create Pix payment on mount
    useEffect(() => {
        createPix();
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }, []);

    const createPix = async () => {
        setLoading(true);
        setError("");
        try {
            const res = await base44.functions.invoke("createPixPayment", { orderId: order.id });
            setPixData(res);
            setStatus(res.payment_status || "pending");
            startPolling();
        } catch (e) {
            setError(e.response?.data?.error || e.message || "Erro ao gerar Pix");
        } finally {
            setLoading(false);
        }
    };

    const startPolling = () => {
        // Light polling: every 10 seconds
        pollRef.current = setInterval(async () => {
            try {
                const res = await base44.functions.invoke("getPaymentStatus", { orderId: order.id });
                setStatus(res.payment_status || "pending");
                setStatusDetail(res.mp_status_detail || "");

                if (res.payment_status === "approved") {
                    if (pollRef.current) clearInterval(pollRef.current);
                    onApproved?.();
                } else if (res.payment_status === "rejected" || res.payment_status === "cancelled") {
                    if (pollRef.current) clearInterval(pollRef.current);
                }
            } catch (e) {
                // Silently ignore polling errors
            }
        }, 10000);
    };

    const copyPixCode = () => {
        if (pixData?.pix_qr_code) {
            navigator.clipboard?.writeText(pixData.pix_qr_code);
            setCopied(true);
            setTimeout(() => setCopied(false), 3000);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-16">
                <Loader2 className="w-8 h-8 animate-spin text-[hsl(var(--gold))]" />
                <p className="mt-4 text-sm text-muted-foreground">Gerando pagamento Pix...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center py-16">
                <AlertCircle className="w-10 h-10 text-red-600" strokeWidth={1.5} />
                <p className="mt-4 text-sm text-red-600 text-center max-w-xs">{error}</p>
                <button onClick={createPix} className="btn-outline mt-6 text-sm">Tentar novamente</button>
            </div>
        );
    }

    const expiration = pixData?.pix_expiration_at ? new Date(pixData.pix_expiration_at) : null;
    const expired = expiration && expiration < new Date();

    return (
        <div className="max-w-md mx-auto">
            {/* Order info */}
            <div className="text-center mb-6">
                <h2 className="font-heading text-2xl tracking-[0.03em]">Pagamento via Pix</h2>
                <div className="flex justify-center mt-3"><div className="gold-rule" /></div>
                <p className="mt-4 text-sm text-muted-foreground">Pedido <strong className="text-foreground">{order.order_number}</strong></p>
                <p className="text-2xl font-heading mt-2">{formatBRL(Number(order.total))}</p>
            </div>

            {/* Status badge */}
            <div className="text-center mb-6">
                <span className={`inline-flex items-center gap-2 text-sm font-medium ${PAYMENT_STATUS_COLORS[status] || "text-muted-foreground"}`}>
                    <Clock className="w-4 h-4" strokeWidth={1.5} />
                    {PAYMENT_STATUS_PT[status] || status}
                </span>
            </div>

            {status === "approved" ? (
                <div className="text-center py-8">
                    <div className="w-16 h-16 rounded-full bg-green-600 mx-auto flex items-center justify-center">
                        <Check className="w-8 h-8 text-white" strokeWidth={1.5} />
                    </div>
                    <p className="mt-4 text-sm text-green-600">Pagamento confirmado!</p>
                </div>
            ) : expired ? (
                <div className="text-center py-8">
                    <AlertCircle className="w-10 h-10 text-amber-600 mx-auto" strokeWidth={1.5} />
                    <p className="mt-4 text-sm text-amber-600">O código Pix expirou.</p>
                    <button onClick={createPix} className="btn-outline mt-6 text-sm">Gerar novo Pix</button>
                </div>
            ) : (
                <>
                    {/* QR Code */}
                    {pixData?.pix_qr_code_base64 && (
                        <div className="flex justify-center mb-6">
                            <div className="bg-white p-4 rounded-lg">
                                <img src={`data:image/png;base64,${pixData.pix_qr_code_base64}`} alt="QR Code Pix" className="w-56 h-56" />
                            </div>
                        </div>
                    )}

                    {/* Pix Copia e Cola */}
                    {pixData?.pix_qr_code && (
                        <div className="mb-6">
                            <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Pix Copia e Cola</label>
                            <div className="flex gap-2">
                                <input
                                    readOnly
                                    value={pixData.pix_qr_code}
                                    className="flex-1 border border-border bg-background px-4 py-3 text-xs font-mono truncate"
                                />
                                <button onClick={copyPixCode} className="btn-gold px-5 flex items-center gap-2 text-sm shrink-0">
                                    {copied ? <><Check className="w-4 h-4" strokeWidth={1.5} /> Copiado</> : <><Copy className="w-4 h-4" strokeWidth={1.5} /> Copiar</>}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Expiration */}
                    {expiration && (
                        <p className="text-center text-[11px] text-muted-foreground">
                            Expira em {expiration.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </p>
                    )}

                    {/* Instructions */}
                    <div className="mt-6 p-4 bg-[hsl(var(--bone))] text-sm space-y-2">
                        <p className="font-medium">Como pagar:</p>
                        <p className="text-muted-foreground text-xs leading-relaxed">
                            1. Abra o app do seu banco ou instituição financeira<br />
                            2. Escolha pagar via Pix → QR Code ou Copia e Cola<br />
                            3. Confirme os dados e finalize o pagamento<br />
                            4. A confirmação é automática — aguarde nesta tela
                        </p>
                    </div>

                    {/* Loading indicator for polling */}
                    <div className="flex items-center justify-center gap-2 mt-6 text-xs text-muted-foreground">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Aguardando confirmação do pagamento...
                    </div>
                </>
            )}
        </div>
    );
}
