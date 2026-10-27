import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { formatBRL } from '@/data/products';
import { canChangePaymentMethod } from '@/lib/paymentEligibility';

export default function PaymentMethodChange({ order, onChanged, blocked = false }) {
    const [open, setOpen] = useState(false);
    const [methods, setMethods] = useState(null);
    const [method, setMethod] = useState('');
    const [pricing, setPricing] = useState(null);
    const [key, setKey] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    if (blocked || !canChangePaymentMethod(order)) return null;
    const start = async () => {
        setOpen(true); setBusy(true); setError('');
        try { setMethods(await base44.functions.invoke('getPaymentMethods')); }
        catch { setError('Não foi possível consultar os métodos. Tente novamente.'); }
        finally { setBusy(false); }
    };
    const preview = async selected => {
        setMethod(selected); setPricing(null); setBusy(true); setError('');
        setKey(`payment_${crypto.randomUUID()}`);
        try { setPricing(await base44.functions.invoke('previewPaymentMethodChange', { orderId: order.id, payment_method: selected })); }
        catch (cause) { setError(cause.message || 'Não foi possível revisar o pagamento.'); }
        finally { setBusy(false); }
    };
    const save = async () => {
        setBusy(true); setError('');
        try {
            const updated = await base44.functions.invoke('changePaymentMethod', {
                orderId: order.id, payment_method: method, expected_pricing: pricing, idempotencyKey: key,
            });
            setOpen(false); setPricing(null); onChanged(updated);
        } catch (cause) { setError(cause.message || 'Não foi possível alterar. Consulte o pedido antes de repetir.'); }
        finally { setBusy(false); }
    };
    return <div className="my-6 border border-border p-4 space-y-4">
        {!open ? <button type="button" className="btn-outline min-h-11" onClick={start}>Alterar método de pagamento</button> : <>
            <h3 className="font-heading text-xl">Alterar método de pagamento</h3>
            <p className="text-sm text-muted-foreground">A alteração preserva este pedido e o cupom. O estoque só é reservado ao iniciar o pagamento. Confira o novo total antes de confirmar.</p>
            <div role="radiogroup" aria-label="Novo método de pagamento" className="flex flex-wrap gap-3">
                {[['credito', 'credit_card', 'Cartão de crédito'], ['debito', 'debit_card', 'Cartão de débito à vista'], ['pix', 'pix', 'Pix']].map(([value, type, label]) =>
                    <button type="button" role="radio" aria-checked={method === value} disabled={busy || !methods?.enabled?.[type] || order.payment_method === value}
                        className={`btn-outline min-h-11 ${method === value ? 'border-foreground' : ''}`} key={value} onClick={() => preview(value)}>{label}</button>)}
            </div>
            {busy && <p role="status">Conferindo pagamento...</p>}
            {pricing && <div className="text-sm space-y-2"><p>Produtos: {formatBRL(pricing.subtotal)}</p><p>Descontos: {formatBRL(pricing.discount)}</p><p>Frete: {formatBRL(pricing.shipping_cost)}</p><p className="font-medium">Total: {formatBRL(pricing.total)}</p>
                <button type="button" disabled={busy} onClick={save} className="btn-gold min-h-11">Confirmar alteração</button></div>}
            <button type="button" disabled={busy} className="underline min-h-11" onClick={() => { setOpen(false); setPricing(null); }}>Voltar ao pagamento atual</button>
        </>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>;
}
