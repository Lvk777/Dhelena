import React, { useState, useEffect, useRef, useId } from "react";
import { Loader2, CreditCard, AlertCircle, Check } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { formatBRL } from "@/data/products";
import { mountCardBrick, safeChallengeUrl } from "@/lib/cardBrick";
import { guardNativeInstallments } from '@/lib/cardInstallmentGuard';

export default function CardPaymentBrick({ order, publicKey, amount, maxInstallments, installmentPolicyManaged = false, isDebit, onApproved, onRejected, onAttempt = () => {} }) {
    const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
    const callbacks = useRef({ onApproved, onRejected, onAttempt });
    callbacks.current = { onApproved, onRejected, onAttempt };
    const submitted = useRef(false);
    const [retry, setRetry] = useState(0);
    const payableAmount = Number(amount);
    const allowedInstallments = isDebit ? 1 : Math.min(12, Math.max(1, Number(maxInstallments) || 1));
    const offers = useRef([]);
    const displayedOffer = useRef(null);
    const [offerNotice, setOfferNotice] = useState('');
    const [selectedOffer, setSelectedOffer] = useState(null);
    // Only initialization changes replace this DOM node; field edits/errors do not.
    const orderIdentity = String(order.id).replace(/[^a-zA-Z0-9_-]/g, '');
    const containerId = `mp-card-${instanceId}-${orderIdentity}-${isDebit ? 'debit' : 'credit'}-${Math.round(payableAmount * 100)}-${allowedInstallments}-${retry}`;
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [loadError, setLoadError] = useState('');
    const [sdkNotice, setSdkNotice] = useState('');
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
        setLoading(true); setError(''); setLoadError(''); setSdkNotice('');
        let active = true, generation = 0;
        offers.current = []; displayedOffer.current = null; setSelectedOffer(null); setOfferNotice('');
        const guard = installmentPolicyManaged && !isDebit ? guardNativeInstallments(document.getElementById(containerId), () => offers.current,
            n => { displayedOffer.current = offers.current.find(o => o.installments === n) || null; setSelectedOffer(displayedOffer.current); }) : null;
        const mounted = mountCardBrick({ publicKey, amount: payableAmount, maxInstallments: allowedInstallments, isDebit, containerId,
            onBinChange: async bin => {
                if (!guard) return;
                const current = ++generation; offers.current = []; displayedOffer.current = null; setSelectedOffer(null); guard.refresh();
                if (!/^\d{6,8}$/.test(String(bin))) { setOfferNotice('Informe o cartão para consultar as condições.'); return; }
                setOfferNotice('Consultando parcelas e totais no provedor...');
                try {
                    const preview = await base44.functions.invoke('getInstallmentOffers', { orderId: order.id, bin });
                    if (!active || current !== generation) return;
                    offers.current = preview.offers || []; guard.refresh();
                    setOfferNotice(offers.current.length ? 'Escolha uma opção no seletor de parcelas. O total inclui os juros informados pelo provedor.' : 'O provedor não ofereceu parcelas nas condições da loja para este cartão. Consulte o atendimento ou escolha outro método.');
                } catch { if (active && current === generation) setOfferNotice('Não foi possível confirmar as parcelas. Tente novamente antes de pagar.'); }
            },
            onReady: () => { setLoading(false); setLoadError(''); },
            onError: message => { setLoadError(message); setLoading(false); },
            onIssue: issue => {
                // Validation belongs to the SDK's inline field messages.
                setSdkNotice(issue.category === 'validation' ? '' : issue.category === 'tokenization'
                    ? 'Não foi possível validar o cartão agora. Confira os campos e tente novamente.'
                    : 'Não foi possível consultar os dados do cartão agora. Corrija os campos ou tente novamente em instantes.');
            },
            onSubmit: async (form, additional) => {
                if (submitted.current) throw new Error('Pagamento já enviado. Consulte o status do pedido.');
                const expectedType = isDebit ? 'debit_card' : 'credit_card';
                if (additional?.paymentTypeId !== expectedType) throw new Error('Escolha um cartão correspondente ao método selecionado.');
                const chosen = offers.current.find(o => o.installments === Number(form.installments || 1)
                    && o.payment_method_id === form.payment_method_id && o.issuer_id === String(form.issuer_id));
                if (installmentPolicyManaged && !isDebit && Number(form.installments || 1) > 1 && (!chosen || displayedOffer.current !== chosen)) throw new Error('Consulte e selecione uma oferta válida antes de confirmar.');
                submitted.current = true; setProcessing(true); setError('');
                try {
                    const next = await base44.functions.invoke('createCardPayment', {
                        orderId: order.id, card_token: form.token, installments: form.installments || 1,
                        payment_method_id: form.payment_method_id, issuer_id: form.issuer_id,
                        payment_type_id: additional.paymentTypeId, bin: additional.bin,
                        expected_offer: chosen || null,
                    });
                    callbacks.current.onAttempt?.();
                    setResult(next);
                    if (next.payment_status === 'approved') callbacks.current.onApproved?.(next);
                    else if (next.payment_status === 'rejected') callbacks.current.onRejected?.(next);
                    return next;
                } catch (cause) {
                    if (cause.response?.data?.attempt_started === false) { submitted.current = false; offers.current = []; guard?.refresh(); }
                    else { setResult({ payment_status: 'unknown' }); callbacks.current.onAttempt?.(); }
                    setError(cause.message || 'Não foi possível confirmar o pagamento. Consulte o pedido antes de tentar novamente.');
                    throw cause;
                } finally { setProcessing(false); }
            },
        });
        return () => { active = false; generation++; guard?.dispose(); mounted.dispose(); };
    }, [order.id, publicKey, payableAmount, allowedInstallments, installmentPolicyManaged, isDebit, containerId, retry]);

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
            <p className="text-sm text-muted-foreground">{isDebit ? 'Pagamento à vista, nas modalidades aceitas para este cartão.' : maxInstallments > 1 ? 'Informe o cartão para consultar as opções de parcelas disponíveis.' : 'Pagamento à vista. Parcelamento sujeito à aprovação comercial e disponibilidade.'}</p>
        </div>
        {(loadError || error || sdkNotice) && <div role="alert" className="flex gap-2 p-4 border border-destructive/30 text-destructive text-sm mb-4"><AlertCircle className="w-4 h-4 shrink-0" /><p>{loadError || error || sdkNotice}</p></div>}
        {loading && !result && <div role="status" className="flex flex-col items-center py-12"><Loader2 className="w-8 h-8 animate-spin" /><p className="mt-4">Carregando formulário de cartão...</p></div>}
        <div key={containerId} id={containerId} hidden={!!result || !!loadError || processing} />
        {offerNotice && <p role="status" className="text-sm mt-3">{offerNotice}</p>}
        {selectedOffer && <p role="status" className="text-sm mt-3">{selectedOffer.installments}x de {formatBRL(selectedOffer.installment_amount)} · Juros: {formatBRL(selectedOffer.buyer_interest_amount)} · Total da cliente: {formatBRL(selectedOffer.buyer_total)}. Eventual ajuste de centavos segue o provedor.</p>}
        {loadError && !submitted.current && <button type="button" className="btn-outline min-h-11" onClick={() => setRetry(value => value + 1)}>Tentar carregar novamente</button>}
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
