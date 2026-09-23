import { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { formatBRL } from '@/data/products';

const SHIPPED = new Set(['enviado', 'em_transporte', 'saiu_entrega', 'entregue']);
const RETURN_NEXT = {
    solicitada: ['autorizada', 'recusada', 'cancelada'],
    autorizada: ['aguardando_postagem', 'recebida', 'cancelada'],
    aguardando_postagem: ['em_transito_retorno', 'recebida', 'cancelada'],
    em_transito_retorno: ['recebida'],
    recebida: ['reembolso_processado'],
};

export default function AdminAfterSales({ order, onChanged }) {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [reason, setReason] = useState('');
    const [kind, setKind] = useState(() => order.payment_status === 'partially_refunded' ? 'remaining' : 'full');
    const [itemId, setItemId] = useState('');
    const [quantity, setQuantity] = useState(1);
    const [returnId, setReturnId] = useState('');
    const [restockable, setRestockable] = useState({});
    const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

    const refresh = useCallback(async () => {
        try {
            setData(await base44.functions.invoke('getAfterSales', { orderId: order.id }));
            setError('');
        } catch (failure) {
            setData(null);
            setError(failure.response?.data?.error || 'Pós-venda indisponível até a migração do banco.');
        }
    }, [order.id]);

    useEffect(() => { refresh(); }, [refresh]);
    useEffect(() => {
        if (order.payment_status === 'partially_refunded' && kind === 'full') setKind('remaining');
    }, [order.payment_status, kind]);

    const run = async (action, confirmation) => {
        if (confirmation && !window.confirm(confirmation)) return;
        setBusy(true);
        setError('');
        try {
            await action();
            await refresh();
            await onChanged();
        } catch (failure) {
            setError(failure.response?.data?.error || failure.message || 'Não foi possível concluir a operação.');
        } finally { setBusy(false); }
    };

    const selected = (order.items || []).find(item => item.id === itemId);
    const selectedItems = selected ? [{ order_item_id: selected.id, quantity: Number(quantity) }] : [];
    const cancel = () => {
        if (SHIPPED.has(order.status)) return;
        if (order.payment_status === 'refunded') {
            return run(() => base44.functions.invoke('cancelAfterRefund', { orderId: order.id }),
                'Confirmar cancelamento após reembolso integral? O estoque será reposto uma única vez.');
        }
        if (order.payment_status === 'approved' || order.payment_status === 'partially_refunded') return;
        if (order.mercado_pago_order_id) {
            return run(() => base44.functions.invoke('cancelPendingPayment', { orderId: order.id }),
                'Cancelar o pagamento pendente no Mercado Pago e repor o estoque?');
        }
        return run(() => base44.functions.invoke('cancelOrder', { orderId: order.id }),
            'Cancelar o pedido sem pagamento e repor o estoque?');
    };

    const submitRefund = () => {
        if (!reason.trim() || reason.trim().length < 5) return setError('Informe um motivo com pelo menos 5 caracteres.');
        if (kind === 'partial' && (!selected || Number(quantity) < 1 || Number(quantity) > selected.quantity)) {
            return setError('Selecione um item e uma quantidade válida.');
        }
        return run(async () => {
            const result = await base44.functions.invoke('requestRefund', {
                orderId: order.id, kind, reason: reason.trim(),
                items: kind === 'partial' ? selectedItems : [], returnId: returnId || null, idempotencyKey,
            });
            if (result.status !== 'processed') {
                setError('Reembolso ainda não confirmado. Concilie antes de solicitar outro.');
            } else {
                setIdempotencyKey(crypto.randomUUID());
                setReason('');
            }
        }, `Confirmar ${kind === 'full' ? 'reembolso total' : kind === 'remaining' ? 'reembolso do saldo restante' : 'reembolso parcial'} via Mercado Pago? A operação financeira não pode ser desfeita.`);
    };

    const submitReturn = () => {
        if (!reason.trim() || reason.trim().length < 5 || !selected) {
            return setError('Selecione item e motivo para abrir a devolução.');
        }
        return run(() => base44.functions.invoke('createReturn', {
            orderId: order.id, items: selectedItems, reason: reason.trim(),
        }), 'Abrir solicitação de devolução para este item?');
    };

    const advance = (entry, status) => run(() => base44.functions.invoke('advanceReturn', {
        orderId: order.id, returnId: entry.id, status,
        restockable: status === 'recebida'
            ? Object.fromEntries(entry.items.map(item => [item.return_item_id, restockable[item.return_item_id]])) : {},
    }), status === 'recebida' ? 'Confirmar recebimento físico e classificação de todos os itens?' : null);

    return (
        <section className="bg-background p-5" aria-label="Pós-venda">
            <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Pós-venda</h2>
            {error && <p role="alert" className="text-xs text-red-700 mb-3">{error}</p>}
            {!data ? <p className="text-xs text-muted-foreground">Histórico de pós-venda indisponível.</p> : <div className="space-y-5 text-sm">
                <div>
                    <h3 className="font-medium mb-2">Cancelamento</h3>
                    {order.status === 'cancelado' ? <p>Pedido cancelado.</p>
                        : SHIPPED.has(order.status) ? <p className="text-muted-foreground">Pedido enviado ou entregue: use devolução física, não cancelamento.</p>
                            : ['approved', 'partially_refunded'].includes(order.payment_status)
                                ? <p className="text-muted-foreground">Pagamento confirmado: concilie o reembolso integral antes de cancelar.</p>
                                : <button className="btn-outline text-xs" disabled={busy || (!!order.mercado_pago_order_id && !data.pending_cancellation_enabled)} onClick={cancel}>Cancelar pedido</button>}
                    {!!order.mercado_pago_order_id && !data.pending_cancellation_enabled && order.payment_status === 'pending'
                        && <p className="text-xs text-muted-foreground mt-1">Cancelamento no provedor desabilitado até validação operacional.</p>}
                </div>

                <div className="border-t border-border pt-4">
                    <h3 className="font-medium mb-2">Devoluções físicas</h3>
                    {(data.returns || []).map(entry => <div key={entry.id} className="border border-border p-3 mb-2 space-y-2">
                        <p><span className="font-medium">{entry.status.replaceAll('_', ' ')}</span> · {entry.reason}</p>
                        <p className="text-xs text-muted-foreground">{entry.items.map(item => `${item.quantity}x ${order.items?.find(row => row.id === item.order_item_id)?.product_name || 'Item'}`).join(', ')}</p>
                        {RETURN_NEXT[entry.status]?.includes('recebida') && entry.items.map(item => <label key={item.return_item_id} className="block text-xs">
                            {order.items?.find(row => row.id === item.order_item_id)?.product_name || 'Item'}: condição física
                            <select className="border border-border bg-background ml-2 p-1" value={restockable[item.return_item_id] === undefined ? '' : String(restockable[item.return_item_id])}
                                onChange={event => setRestockable(previous => ({ ...previous, [item.return_item_id]: event.target.value === 'true' }))}>
                                <option value="">Selecione</option><option value="true">Revenda</option><option value="false">Não revenda</option>
                            </select>
                        </label>)}
                        <div className="flex flex-wrap gap-2">{(RETURN_NEXT[entry.status] || []).map(status => <button key={status} className="btn-outline text-xs" disabled={busy || (status === 'recebida' && entry.items.some(item => restockable[item.return_item_id] === undefined))}
                            onClick={() => advance(entry, status)}>{status.replaceAll('_', ' ')}</button>)}</div>
                    </div>)}
                    {!data.returns?.length && <p className="text-xs text-muted-foreground">Nenhuma devolução solicitada.</p>}
                </div>

                <div className="border-t border-border pt-4 space-y-2">
                    <h3 className="font-medium">Nova solicitação / reembolso</h3>
                    <textarea className="w-full border border-border bg-background p-2 text-sm" placeholder="Motivo (obrigatório)" value={reason} maxLength={500}
                        onChange={event => setReason(event.target.value)} />
                    <div className="flex flex-wrap gap-2">
                        <select className="border border-border bg-background p-2" value={itemId} onChange={event => setItemId(event.target.value)}>
                            <option value="">Selecionar item</option>{(order.items || []).map(item => <option key={item.id} value={item.id}>{item.product_name}</option>)}
                        </select>
                        <input className="w-20 border border-border bg-background p-2" type="number" min="1" max={selected?.quantity || 1} value={quantity}
                            onChange={event => setQuantity(Number(event.target.value))} aria-label="Quantidade" />
                        <button className="btn-outline text-xs" disabled={busy || !selected || order.status === 'cancelado'} onClick={submitReturn}>Solicitar devolução</button>
                    </div>
                    {data.refunds_enabled && ['approved', 'partially_refunded'].includes(order.payment_status) && <div className="space-y-2 pt-2">
                        <select className="border border-border bg-background p-2 mr-2" value={kind} onChange={event => setKind(event.target.value)}>
                            {order.payment_status === 'approved' && <option value="full">Total</option>}
                            {order.payment_status === 'partially_refunded' && <option value="remaining">Saldo restante</option>}
                            <option value="partial">Parcial por item</option>
                        </select>
                        <select className="border border-border bg-background p-2" value={returnId} onChange={event => setReturnId(event.target.value)}>
                            <option value="">Sem devolução vinculada</option>{data.returns.filter(entry => entry.status === 'recebida').map(entry =>
                                <option key={entry.id} value={entry.id}>Devolução recebida {entry.id.slice(0, 8)}</option>)}</select>
                        <p className="text-xs text-muted-foreground">O valor é calculado e limitado pelo backend; reembolso não repõe estoque automaticamente.</p>
                        <button className="btn-outline text-xs" disabled={busy || (kind === 'partial' && !selected)} onClick={submitRefund}>Solicitar reembolso MP</button>
                    </div>}
                    {!data.refunds_enabled && <p className="text-xs text-muted-foreground">Reembolsos financeiros desabilitados até validação operacional.</p>}
                </div>

                <div className="border-t border-border pt-4">
                    <h3 className="font-medium mb-2">Reembolsos</h3>
                    {(data.refunds || []).map(entry => <div key={entry.id} className="text-xs py-2 border-b border-border">
                        {entry.kind === 'full' ? 'Total' : entry.kind === 'remaining' ? 'Saldo restante' : 'Parcial'} · {formatBRL(Number(entry.amount))} · {entry.status}
                        {entry.provider_refund_id && <span> · MP {entry.provider_refund_id}</span>}
                        {['processing', 'reconciliation_required'].includes(entry.status) && <button className="btn-outline text-xs ml-2" disabled={busy}
                            onClick={() => run(() => base44.functions.invoke('reconcileRefund', { orderId: order.id, refundId: entry.id }))}>Consultar MP</button>}
                    </div>)}
                    {!data.refunds?.length && <p className="text-xs text-muted-foreground">Nenhum reembolso.</p>}
                </div>
            </div>}
        </section>
    );
}
