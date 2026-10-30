import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { canChangePaymentMethod } from '@/lib/paymentEligibility';
import { safeChallengeUrl } from '@/lib/cardBrick';
import PaymentMethodChange from './PaymentMethodChange';
import CardPaymentBrick from './CardPaymentBrick';
import PixPaymentScreen from './PixPaymentScreen';
import { useAuth } from '@/lib/AuthContext';
import { usePublicSettings } from '@/context/PublicSettingsContext';

export default function OrderPaymentPanel({ order, onChanged, onRefresh }) {
    const { user } = useAuth();
    const { settings, loading, error: settingsError } = usePublicSettings();
    const maintenance = user?.role !== 'admin' && (loading || settingsError || settings.maintenance.maintenance_mode === true);
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
        {maintenance && <p className="text-sm">Novos pagamentos estão indisponíveis durante a manutenção. Você pode consultar o pagamento existente.</p>}
        {!maintenance && <PaymentMethodChange order={order} blocked={attempted} onChanged={updated => { setOpen(false); onChanged(updated); }} />}
        {!maintenance && !open && eligible && <button type="button" className="btn-gold min-h-11" disabled={busy} onClick={pay}>{busy ? 'Carregando...' : 'Pagar este pedido'}</button>}
        {(maintenance || !eligible) && !open && <button type="button" className="btn-outline min-h-11" disabled={busy} onClick={consult}>{busy ? 'Consultando...' : 'Consultar pagamento'}</button>}
        {open && !methods?.enabled?.[type] && <p role="alert">Este método está indisponível no momento. Consulte o atendimento ou altere o método, se disponível.</p>}
        {!maintenance && open && methods?.enabled?.[type] && (order.payment_method === 'pix'
            ? <PixPaymentScreen order={order} onApproved={onRefresh} onAttempt={() => setAttempted(true)} />
            : <CardPaymentBrick key={`${order.id}-${order.payment_method}`} order={order} amount={order.total} publicKey={methods.public_key}
                maxInstallments={methods.max_installments} installmentPolicyManaged={methods.installment_policy_managed} isDebit={order.payment_method === 'debito'} onApproved={onRefresh}
                onRejected={onRefresh} onAttempt={() => setAttempted(true)} />)}
        {!open && !status?.reconciliation_required && order.payment_method === 'pix' && order.payment_status === 'pending' && order.pix_qr_code && <div className="space-y-3">
            {order.pix_qr_code_base64 && <img className="w-48 h-48" src={`data:image/png;base64,${order.pix_qr_code_base64}`} alt="QR Code do pagamento existente" />}
            <button type="button" className="btn-outline min-h-11" onClick={() => navigator.clipboard?.writeText(order.pix_qr_code)}>Copiar código Pix deste pedido</button>
            {order.pix_expiration_at && <p className="text-sm">Validade do código: {new Date(order.pix_expiration_at).toLocaleString('pt-BR')}</p>}
        </div>}
        {status?.reconciliation_required && <p role="alert" className="text-error-ink text-sm">{status.status_message || 'Este pagamento precisa de conciliação. Entre em contato com o atendimento antes de uma nova tentativa.'}</p>}
        {challenge && !status?.reconciliation_required && <iframe src={challenge} title="Autenticação segura do cartão no Mercado Pago" className="w-full h-[500px] border" referrerPolicy="no-referrer" />}
        {error && <p role="alert" className="text-error-ink text-sm">{error}</p>}
    </div>;
}
