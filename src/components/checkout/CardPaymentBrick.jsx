import React, { useState, useEffect, useRef, useId } from "react";
import { Loader2, CreditCard, AlertCircle, Check } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { formatBRL } from "@/data/products";
import { mountCardBrick, safeChallengeUrl } from "@/lib/cardBrick";

export default function CardPaymentBrick({ order, publicKey, amount, maxInstallments, isDebit, onApproved, onRejected, onAttempt = () => {} }) {
    const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
    const callbacks = useRef({ onApproved, onRejected, onAttempt });
    callbacks.current = { onApproved, onRejected, onAttempt };
    const submitted = useRef(false);
    const [retry, setRetry] = useState(0);
    const containerId = `mp-card-${instanceId}-${isDebit ? 'debit' : 'credit'}-${retry}`;
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [processing, setProcessing] = useState(false);
    const [result, setResult] = useState(null);
    const [checking, setChecking] = useState(false);
    const challengeUrl = safeChallengeUrl(result?.challenge_url);

    const checkStatus = async () => {
        setChecking(true);
        try {
            const next = await base44.functions.invoke('getPaymentStatus', { orderId: order.id });
            setResult(next);
            if (next.payment_status === 'approved') callbacks.current.onApproved?.(next);
        } catch { setError('Não foi possível consultar o pagamento. Confira novamente em Meus pedidos.'); }
        finally { setChecking(false); }
    };

    useEffect(() => {
        setLoading(true); setError('');
        const mounted = mountCardBrick({ publicKey, amount, maxInstallments, isDebit, containerId,
            onReady: () => setLoading(false),
            onError: message => { setError(message); setLoading(false); },
            onSubmit: async (form, additional) => {
                if (submitted.current) throw new Error('Pagamento já enviado. Consulte o status do pedido.');
                const expectedType = isDebit ? 'debit_card' : 'credit_card';
                if (additional?.paymentTypeId !== expectedType) throw new Error('Escolha um cartão correspondente ao método selecionado.');
                submitted.current = true; setProcessing(true); setError(''); callbacks.current.onAttempt?.();
                try {
                    const next = await base44.functions.invoke('createCardPayment', {
                        orderId: order.id, card_token: form.token, installments: form.installments || 1,
                        payment_method_id: form.payment_method_id, issuer_id: form.issuer_id,
                        payment_type_id: additional.paymentTypeId, bin: additional.bin,
                    });
                    setResult(next);
                    if (next.payment_status === 'approved') callbacks.current.onApproved?.(next);
                    else if (next.payment_status === 'rejected') callbacks.current.onRejected?.(next);
                    return next;
                } catch (cause) {
                    setResult({ payment_status: 'unknown' });
                    setError(cause.message || 'Não foi possível confirmar o pagamento. Consulte o pedido antes de tentar novamente.');
                    throw cause;
                } finally { setProcessing(false); }
            },
        });
        return () => mounted.dispose();
    }, [order.id, publicKey, amount, maxInstallments, isDebit, containerId, retry]);

    useEffect(() => {
        if (!result || !['pending', 'in_process'].includes(result.payment_status)) return;
        const timer = setInterval(() => { checkStatus(); }, 10000);
        return () => clearInterval(timer);
    }, [result?.payment_status, order.id]);

    return <div>
        <div className="text-center mb-6">
            <h2 className="font-heading text-2xl tracking-[0.03em]">Pagamento com cartão de {isDebit ? 'débito' : 'crédito'}</h2>
            <p className="mt-4 text-sm text-muted-foreground">Pedido <strong>{order.order_number}</strong></p>
            <p className="text-2xl font-heading mt-2">{formatBRL(Number(amount))}</p>
            <p className="text-sm text-muted-foreground">{isDebit ? 'Pagamento à vista, nas modalidades aceitas para este cartão.' : maxInstallments > 1 ? `Até ${maxInstallments}x sem juros, conforme disponibilidade do cartão.` : 'Pagamento à vista. Parcelamento sujeito à aprovação comercial e disponibilidade.'}</p>
        </div>
        {error && <div role="alert" className="flex gap-2 p-4 border border-destructive/30 text-destructive text-sm mb-4"><AlertCircle className="w-4 h-4 shrink-0" /><p>{error}</p></div>}
        {loading && !result && <div role="status" className="flex flex-col items-center py-12"><Loader2 className="w-8 h-8 animate-spin" /><p className="mt-4">Carregando formulário de cartão...</p></div>}
        <div key={containerId} id={containerId} hidden={!!result || !!error || processing} />
        {error && !submitted.current && <button type="button" className="btn-outline min-h-11" onClick={() => setRetry(value => value + 1)}>Tentar carregar novamente</button>}
        {processing && <p role="status" className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Confirmando pagamento...</p>}
        {result?.payment_status === 'approved' && <p role="status" className="text-green-700 flex items-center gap-2"><Check />Pagamento aprovado!</p>}
        {result && result.payment_status !== 'approved' && <div className="space-y-4">
            <p role="status" className="text-sm">{result.payment_status === 'rejected' ? 'Pagamento não aprovado. O atendimento pode orientar os próximos passos.' : challengeUrl ? 'Confirme a autenticação solicitada pelo emissor do cartão.' : 'Pagamento aguardando confirmação. Consulte o status antes de outra tentativa.'}</p>
            {challengeUrl && <iframe src={challengeUrl} title="Autenticação segura do cartão no Mercado Pago" className="w-full h-[500px] border" referrerPolicy="no-referrer" />}
            <button type="button" className="btn-outline min-h-11" disabled={checking || processing} onClick={checkStatus}>{checking ? 'Consultando...' : 'Consultar pagamento'}</button>
        </div>}
        <p className="text-[10px] text-muted-foreground mt-4 text-center"><CreditCard className="w-3 h-3 inline mr-1" />Dados de cartão tokenizados pelo Mercado Pago.</p>
    </div>;
}
