import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { formatBRL } from '@/data/products';
import { safeShippingPrintUrl } from '../../../backend/src/lib/shipping.js';

export default function ShippingOperations({ order, onChanged }) {
    const [ready, setReady] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [invoice, setInvoice] = useState(''), [printUrl, setPrintUrl] = useState(''), [confirm, setConfirm] = useState(false);
    const reload = () => base44.functions.invoke('shippingReadiness', { orderId: order.id }).then(setReady).catch(() => setReady(null));
    useEffect(() => { reload(); setPrintUrl(''); setConfirm(false); }, [order.id, order.shipping_status]);
    const run = async action => {
        setBusy(true); setError('');
        try {
            const result = await base44.functions.invoke('generateShippingLabel', { orderId: order.id, action,
                invoice_key: invoice || undefined, confirm_purchase: confirm,
                expected_price_cents: ready?.price != null ? Math.round(Number(ready.price) * 100) : undefined });
            if (result.print_url) setPrintUrl(result.print_url);
            setConfirm(false); await reload(); if(action !== 'print') onChanged?.();
        } catch (e) { setError(e.message || 'Operação de envio indisponível.'); }
        finally { setBusy(false); }
    };
    if (order.shipping_method !== 'melhor_envio') return null;
    const eligible = order.payment_status === 'approved' && order.status !== 'cancelado';
    const state = ready?.status || order.shipping_status;
    return <div className="mt-4 space-y-3 text-sm" aria-label="Expedição Melhor Envio">
        {error && <p role="alert" className="text-red-700">{error}</p>}
        {!eligible ? <p>Expedição disponível após a confirmação do pagamento.</p> : !ready?.environment ?
            <p>O ambiente deste envio precisa de análise antes de preparar ou comprar etiquetas.</p> : <>
                <p>Ambiente do envio: {ready.environment === 'production' ? 'Produção' : 'Sandbox'}. Preparar a etiqueta não compra frete.</p>
                {!order.melhor_envio_shipment_id && <>
                    <label className="block">Chave da NF-e {ready.environment === 'production' ? '(obrigatória)' : '(opcional em Sandbox)'}
                        <input aria-label="Chave da NF-e" value={invoice} onChange={e=>setInvoice(e.target.value.replace(/\D/g,'').slice(0,44))}
                            className="block w-full border border-border bg-background p-3 mt-1" inputMode="numeric" />
                    </label>
                    <button className="btn-outline text-xs" disabled={busy || ['cart_inflight','cart_uncertain'].includes(state)} onClick={()=>run('prepare')}>Preparar etiqueta</button>
                </>}
                {state === 'cart_created' && <>
                    <p>Custo da etiqueta: {ready.price == null ? 'consulte novamente' : formatBRL(Number(ready.price))}. Pode diferir do frete pago pela cliente.</p>
                    <label className="flex gap-2 items-center"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)} />Confirmo a compra pelo custo indicado, debitado da carteira Melhor Envio.</label>
                    <button className="btn-outline text-xs" disabled={busy || !ready.purchase_enabled || !confirm || ready.price == null} onClick={()=>run('purchase')}>Comprar etiqueta</button>
                    {!ready.purchase_enabled && <p>Compra desabilitada até homologação e autorização operacional.</p>}
                </>}
                {state === 'purchased' && <button className="btn-outline text-xs" disabled={busy} onClick={()=>run('generate')}>Solicitar geração da etiqueta</button>}
                {order.melhor_envio_shipment_id && <div className="flex flex-wrap gap-2">
                    <button className="btn-outline text-xs" disabled={busy} onClick={()=>run('refresh')}>Consultar status</button>
                    <button className="btn-outline text-xs" disabled={busy} onClick={()=>run('print')}>Obter impressão</button>
                </div>}
                {['cart_inflight','cart_uncertain','purchase_inflight','purchase_uncertain'].includes(state) && <p role="status">Resultado externo ainda não confirmado. Não repita a operação; confira o painel Melhor Envio e solicite análise.</p>}
                {state === 'generating' && <p role="status">Geração em andamento. Consulte o status antes de imprimir.</p>}
                {safeShippingPrintUrl(printUrl) && <a href={safeShippingPrintUrl(printUrl)} target="_blank" rel="noopener noreferrer" className="btn-outline text-xs">Abrir etiqueta (login Melhor Envio)</a>}
            </>}
    </div>;
}
