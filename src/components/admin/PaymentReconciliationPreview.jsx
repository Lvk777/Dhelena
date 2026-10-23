import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const HISTORICAL_MP_ORDER = 'ORDTST01M3WY62VJNVEVXATHY3CRDVHW';

function DataRow({ label, value }) {
    return <div className="flex flex-wrap justify-between gap-2 border-b border-border/60 py-1.5 text-xs">
        <span className="text-muted-foreground">{label}</span><span className="font-medium break-all">{value ?? '—'}</span>
    </div>;
}

export default function PaymentReconciliationPreview({ order }) {
    const [mpOrderId, setMpOrderId] = useState(order.mercado_pago_order_id
        || (order.order_number === 'DH-2026-000006' ? HISTORICAL_MP_ORDER : ''));
    const [preview, setPreview] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const runPreview = async () => {
        setLoading(true);
        setError('');
        setPreview(null);
        try {
            const result = await base44.functions.invoke('getPaymentReconciliationPreview', {
                orderId: order.id, mpOrderId: mpOrderId.trim(),
            });
            setPreview(result);
        } catch (err) {
            setError(err.response?.data?.error || err.message || 'Prévia indisponível');
        } finally { setLoading(false); }
    };

    return <section className="bg-background p-5" aria-labelledby="payment-preview-title">
        <h2 id="payment-preview-title" className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-2">Prévia de conciliação</h2>
        <p className="text-xs text-muted-foreground mb-4">Consulta somente leitura ao pedido e à order Mercado Pago TEST. Esta tela não aprova nem cobra pagamentos.</p>
        <label htmlFor="preview-mp-order" className="block text-xs mb-1">ID da order Mercado Pago</label>
        <div className="flex flex-wrap gap-2">
            <input id="preview-mp-order" value={mpOrderId} onChange={event => setMpOrderId(event.target.value)}
                className="min-w-0 flex-1 border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:border-[hsl(var(--gold))]"
                autoComplete="off" />
            <button type="button" onClick={runPreview} disabled={loading || !mpOrderId.trim()}
                className="btn-outline text-xs min-h-11 disabled:opacity-50">
                {loading ? <><Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" /> Consultando</> : 'Consultar prévia'}
            </button>
        </div>
        {error && <p role="alert" className="mt-3 text-xs text-red-700">{error}</p>}
        {preview && <div className="mt-5 space-y-5">
            <p role="status" className={`text-sm font-medium ${preview.safe_to_reconcile ? 'text-green-700' : 'text-amber-700'}`}>
                {preview.safe_to_reconcile ? 'Critérios da prévia atendidos; nenhuma alteração executada.' : 'Conciliação bloqueada pela prévia; nenhuma alteração executada.'}
            </p>
            <div className="grid md:grid-cols-2 gap-5">
                <div><h3 className="text-xs font-semibold mb-2">Pedido local</h3>
                    <DataRow label="Pedido" value={preview.local.order_number} />
                    <DataRow label="Status" value={preview.local.order_status} />
                    <DataRow label="Pagamento" value={preview.local.payment_status} />
                    <DataRow label="Total / moeda" value={`${preview.local.total} ${preview.local.currency}`} />
                    <DataRow label="paid_at" value={preview.local.paid_at} />
                    <DataRow label="MP order ID" value={preview.local.mp_order_id} />
                    <DataRow label="MP transaction ID" value={preview.local.mp_payment_id} />
                </div>
                <div><h3 className="text-xs font-semibold mb-2">Mercado Pago TEST</h3>
                    <DataRow label="Referência" value={preview.provider.external_reference} />
                    <DataRow label="Total / moeda" value={`${preview.provider.total} ${preview.provider.currency}`} />
                    <DataRow label="Order" value={`${preview.provider.order_status} / ${preview.provider.order_status_detail}`} />
                    <DataRow label="Transação" value={`${preview.provider.transaction_status} / ${preview.provider.transaction_status_detail}`} />
                    <DataRow label="Valor da transação" value={preview.provider.transaction_amount} />
                    <DataRow label="ID da transação" value={preview.provider.transaction_id} />
                    <DataRow label="Secret webhook TEST configurado" value={preview.integration.webhook_test_secret_configured ? 'Sim' : 'Não'} />
                </div>
            </div>
            <div><h3 className="text-xs font-semibold mb-2">Verificações</h3>
                <div className="grid sm:grid-cols-2 gap-x-5">{Object.entries(preview.checks).map(([key, passed]) =>
                    <DataRow key={key} label={key.replaceAll('_', ' ')} value={passed ? 'OK' : 'Falhou'} />)}</div>
            </div>
            <div><h3 className="text-xs font-semibold mb-2">Estoque e cupom</h3>
                {preview.local.stock.map((item, index) => <div key={`${item.product_id}-${index}`} className="text-xs border-b border-border/60 py-2">
                    <p>{item.color_id} / {item.size}: estoque {item.current_stock ?? '—'}, reservas {item.reservation_count}, restaurações {item.restoration_movement_count}</p>
                    {item.reservation && <p className="text-muted-foreground">Reserva {item.reservation.previous_stock} → {item.reservation.new_stock} ({item.reservation.attribution})</p>}
                </div>)}
                <DataRow label="Restaurações registradas" value={preview.local.stock_restorations.length} />
                <DataRow label="Cupom" value={preview.local.coupon_code} />
                <DataRow label="Usos do cupom neste pedido" value={preview.local.coupon_usages.length} />
                {preview.local.coupon_usages[0] && <DataRow label="Usos totais do cupom" value={preview.local.coupon_usages[0].total_uses} />}
            </div>
            <div className="grid sm:grid-cols-2 gap-5 text-xs">
                <div><h3 className="font-semibold mb-2">Auditoria</h3>{preview.local.audit.length ? preview.local.audit.map((entry, i) =>
                    <p key={i}>{entry.action} · {entry.created_at}</p>) : <p className="text-muted-foreground">Nenhum evento</p>}</div>
                <div><h3 className="font-semibold mb-2">Timeline</h3>{preview.local.timeline.length ? preview.local.timeline.map((entry, i) =>
                    <p key={i}>{entry.event} · {entry.created_at}</p>) : <p className="text-muted-foreground">Nenhum evento</p>}</div>
            </div>
        </div>}
    </section>;
}
