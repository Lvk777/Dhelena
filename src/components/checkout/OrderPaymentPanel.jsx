import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { canChangePaymentMethod } from '@/lib/paymentEligibility';
import { safeChallengeUrl } from '@/lib/cardBrick';
import PaymentMethodChange from './PaymentMethodChange';
import CardPaymentBrick from './CardPaymentBrick';
import PixPaymentScreen from './PixPaymentScreen';

export default function OrderPaymentPanel({ order, onChanged, onRefresh }) {
    const [open, setOpen] = useState(false);
    const [methods, setMethods] = useState(null);
    const [busy, setBusy] = useState(false);
    const [attempted, setAttempted] = useState(false);
    const [error, setError] = useState('');
    const [status, setStatus] = useState(null);
    if (order.status === 'cancelado' || order.payment_status === 'approved') return null;
    const eligible = canChangePaymentMethod(order) && !attempted;
    const pay = async () => {
        setBusy(true); setError('');
        try { setMethods(await base44.functions.invoke('getPaymentMethods')); setOpen(true); }
        catch { setError('Não foi possível carregar o pagamento. Tente novamente.'); }
        finally { setBusy(false); }
    };
    const consult = async () => {
        setBusy(true); setError('');
        try { setStatus(await base44.functions.invoke('getPaymentStatus', { orderId: order.id })); onRefresh(); }
        catch { setError('Este pagamento precisa de conciliação. Entre em contato com o atendimento antes de uma nova tentativa.'); }
        finally { setBusy(false); }
    };
    const type = { credito: 'credit_card', debito: 'debit_card', pix: 'pix' }[order.payment_method];
    const challenge = safeChallengeUrl(status?.challenge_url);
    return <div className="mb-8 space-y-4">
        <PaymentMethodChange order={order} blocked={attempted} onChanged={updated => { setOpen(false); onChanged(updated); }} />
        {!open && eligible && <button type="button" className="btn-gold min-h-11" disabled={busy} onClick={pay}>{busy ? 'Carregando...' : 'Pagar este pedido'}</button>}
        {!eligible && !open && <button type="button" className="btn-outline min-h-11" disabled={busy} onClick={consult}>{busy ? 'Consultando...' : 'Consultar pagamento'}</button>}
        {open && !methods?.enabled?.[type] && <p role="alert">Este método está indisponível no momento. Consulte o atendimento ou altere o método, se disponível.</p>}
        {open && methods?.enabled?.[type] && (order.payment_method === 'pix'
            ? <PixPaymentScreen order={order} onApproved={onRefresh} onAttempt={() => setAttempted(true)} />
            : <CardPaymentBrick key={`${order.id}-${order.payment_method}`} order={order} amount={order.total} publicKey={methods.public_key}
                maxInstallments={methods.max_installments} isDebit={order.payment_method === 'debito'} onApproved={onRefresh}
                onRejected={onRefresh} onAttempt={() => setAttempted(true)} />)}
        {!open && order.payment_method === 'pix' && order.payment_status === 'pending' && order.pix_qr_code && <div className="space-y-3">
            {order.pix_qr_code_base64 && <img className="w-48 h-48" src={`data:image/png;base64,${order.pix_qr_code_base64}`} alt="QR Code do pagamento existente" />}
            <button type="button" className="btn-outline min-h-11" onClick={() => navigator.clipboard?.writeText(order.pix_qr_code)}>Copiar código Pix deste pedido</button>
            {order.pix_expiration_at && <p className="text-sm">Validade do código: {new Date(order.pix_expiration_at).toLocaleString('pt-BR')}</p>}
        </div>}
        {challenge && <iframe src={challenge} title="Autenticação segura do cartão no Mercado Pago" className="w-full h-[500px] border" referrerPolicy="no-referrer" />}
        {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
    </div>;
}
