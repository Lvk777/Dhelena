import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';

export default function CustomerAfterSales({ order, onChanged }) {
    const [data, setData] = useState(null);
    const [itemId, setItemId] = useState('');
    const [quantity, setQuantity] = useState(1);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const refresh = async () => {
        try { setData(await base44.functions.invoke('getAfterSales', { orderId: order.id })); }
        catch { setData(null); }
    };
    useEffect(() => { refresh(); }, [order.id]);

    const selected = order.items?.find(item => item.id === itemId);
    const cancelUnpaid = async () => {
        if (!window.confirm('Cancelar este pedido sem pagamento? O estoque será liberado.')) return;
        setBusy(true);
        setError('');
        try {
            await base44.functions.invoke('cancelOrder', { orderId: order.id });
            await onChanged();
        } catch (failure) { setError(failure.response?.data?.error || 'Não foi possível cancelar o pedido.'); }
        finally { setBusy(false); }
    };

    const requestReturn = async () => {
        if (!selected || !Number.isInteger(Number(quantity)) || Number(quantity) < 1
            || Number(quantity) > selected.quantity || reason.trim().length < 5) {
            setError('Selecione item, quantidade válida e informe o motivo.');
            return;
        }
        setBusy(true);
        setError('');
        try {
            await base44.functions.invoke('createReturn', {
                orderId: order.id, reason: reason.trim(),
                items: [{ order_item_id: selected.id, quantity: Number(quantity) }],
            });
            setReason('');
            await refresh();
        } catch (failure) { setError(failure.response?.data?.error || 'Não foi possível solicitar a devolução.'); }
        finally { setBusy(false); }
    };

    return <section className="border-t border-border pt-6 mt-8" aria-label="Pós-venda do pedido">
        <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-3">Pós-venda</h2>
        {error && <p role="alert" className="text-xs text-red-700 mb-3">{error}</p>}
        {!order.mercado_pago_order_id && !order.payment_attempt_started_at && order.payment_status === 'pending'
            && order.status !== 'cancelado' && <button className="btn-outline text-xs mb-4" disabled={busy} onClick={cancelUnpaid}>Cancelar pedido não pago</button>}
        {data?.returns?.map(entry => <div key={entry.id} className="text-sm border border-border p-3 mb-2">
            <p className="font-medium">Devolução: {entry.status.replaceAll('_', ' ')}</p>
            <p className="text-xs text-muted-foreground">{entry.reason}</p>
        </div>)}
        {data && ['approved', 'partially_refunded', 'refunded'].includes(order.payment_status)
            && order.status !== 'cancelado' && <div className="space-y-2 max-w-lg">
                <p className="text-sm">Solicitar devolução física</p>
                <div className="flex flex-wrap gap-2">
                    <select className="border border-border bg-background p-2 text-sm" value={itemId} onChange={event => setItemId(event.target.value)}>
                        <option value="">Selecione o item</option>{(order.items || []).map(item =>
                            <option key={item.id} value={item.id}>{item.product_name}</option>)}</select>
                    <input className="border border-border bg-background p-2 text-sm w-20" type="number" min="1" max={selected?.quantity || 1}
                        value={quantity} onChange={event => setQuantity(Number(event.target.value))} aria-label="Quantidade" />
                </div>
                <textarea className="w-full border border-border bg-background p-2 text-sm" value={reason} maxLength={500}
                    onChange={event => setReason(event.target.value)} placeholder="Motivo da devolução" />
                <button className="btn-outline text-xs" disabled={busy || !selected} onClick={requestReturn}>Enviar solicitação</button>
                <p className="text-xs text-muted-foreground">Solicitar devolução não gera reembolso automático. A equipe avaliará o pedido.</p>
            </div>}
    </section>;
}
