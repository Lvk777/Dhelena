import OperationalRefund from '@/components/admin/OperationalRefund';
import ShippingOperations from '@/components/admin/ShippingOperations';
import FiscalDocumentPanel from '@/components/admin/FiscalDocumentPanel';
import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Truck, Loader2, Copy, MapPin, QrCode, CreditCard, Banknote } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { formatBRL, ORDER_STATUS, PAYMENT_LABELS, SHIPPING_LABELS, PAYMENT_STATUS_PT, PAYMENT_STATUS_COLORS } from "@/data/products";
import OrderTimeline from "@/components/checkout/OrderTimeline";
import AdminAfterSales from "@/components/admin/AdminAfterSales";
import PaymentReconciliationPreview from "@/components/admin/PaymentReconciliationPreview";
import CardFinancingSummary from '@/components/checkout/CardFinancingSummary';
import { orderDeliveryEstimateLabel } from '@/lib/deliveryEstimate';
import { fiscalXmlImportEnabled } from '@/lib/fiscalFeature';
import { shippingStatusLabel } from '@/lib/shippingStatusLabel';
import { userFacingError } from '@/lib/userFacingError';

const STATUS_OPTIONS = Object.entries(ORDER_STATUS)
    .filter(([key]) => ['em_separacao', 'enviado', 'em_transporte', 'saiu_entrega', 'entregue'].includes(key))
    .map(([key, v]) => ({ value: key, label: v.label }));
const NEXT_STATUS = {
    pagamento_aprovado: ['em_separacao'], em_separacao: ['enviado'],
    enviado: ['em_transporte', 'entregue'], em_transporte: ['saiu_entrega', 'entregue'],
    saiu_entrega: ['entregue'],
};

export default function AdminOrderDetail() {
    const { id } = useParams();
    const [order, setOrder] = useState(null);
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [trackingInfo, setTrackingInfo] = useState(null);
    const [trackingLoading, setTrackingLoading] = useState(false);
    const [fiscalDocument, setFiscalDocument] = useState(null);
    const [fiscalLoadError, setFiscalLoadError] = useState('');
    const [statusError, setStatusError] = useState('');

    const load = async () => {
        setLoading(true);
        try {
            const o = await base44.entities.Order.get(id);
            setOrder(o);
            if (fiscalXmlImportEnabled) {
                try { setFiscalDocument(await base44.functions.invoke('getFiscalDocument', { orderId: id })); setFiscalLoadError(''); }
                catch { setFiscalDocument(null); setFiscalLoadError('Não foi possível consultar a nota fiscal deste pedido. Tente atualizar a página.'); }
            } else { setFiscalDocument(null); setFiscalLoadError(''); }
            // Load timeline events
            try {
                const evs = await base44.functions.invoke("getOrderEvents", { orderId: id });
                setEvents(Array.isArray(evs) ? evs : []);
            } catch { setEvents([]); }
        } catch { setOrder(null); }
        finally { setLoading(false); }
    };

    useEffect(() => { load(); }, [id]);

    const changeStatus = async (newStatus) => {
        setSaving(true); setStatusError('');
        try {
            await base44.functions.invoke("updateOrderStatus", { orderId: id, status: newStatus });
            load();
        } catch (e) {
            setStatusError(userFacingError(e, '/orders/status'));
        } finally { setSaving(false); }
    };

    const copyAddress = () => {
        const a = order.shipping_address || order.snapshot?.shipping_address || {};
        const text = `${a.street || ""}, ${a.number || ""}${a.complement ? ` - ${a.complement}` : ""}\n${a.district || ""}\n${a.city || ""} - ${a.state || ""}\nCEP ${a.cep || ""}`;
        navigator.clipboard?.writeText(text);
    };

    const fetchTracking = async () => {
        setTrackingLoading(true);
        try {
            const res = await base44.functions.invoke("getTrackingInfo", { orderId: id });
            setTrackingInfo(res);
        } catch (e) {
            setTrackingInfo({ error: e.response?.data?.error || e.message });
        } finally { setTrackingLoading(false); }
    };

    if (loading) return <div className="h-64 bg-background text-foreground animate-pulse" />;
    if (!order) return <div className="text-center py-12"><p className="text-muted-foreground">Pedido não encontrado.</p><Link to="/admin/pedidos" className="btn-outline mt-4 inline-flex">Voltar</Link></div>;

    const snapshot = order.snapshot || {};
    const customer = snapshot.customer || {};
    const shippingAddress = order.shipping_address || snapshot.shipping_address || {};
    const isPaid = order.payment_status === "approved";
    const uncertainPayment = order.payment_status === 'pending' && !!order.payment_attempt_started_at && !order.mercado_pago_order_id;
    const uncertainShipping = ['cart_inflight', 'cart_uncertain', 'purchase_inflight', 'purchase_uncertain'].includes(order.shipping_status);
    const fiscalDifferences = fiscalDocument?.differences?.length > 0;

    const PaymentIcon = order.payment_method === "pix" ? QrCode : order.payment_method === "debito" ? Banknote : CreditCard;

    return (
        <div>
            <Link to="/admin/pedidos" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
                <ArrowLeft className="w-4 h-4" strokeWidth={1.5} /> Pedidos
            </Link>

            <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
                <div>
                    <h1 className="font-heading text-2xl tracking-[0.03em]">{order.order_number}</h1>
                    <p className="text-sm text-muted-foreground mt-1">{new Date(order.created_date).toLocaleString("pt-BR")}</p>
                </div>
                <div className="flex items-center gap-2">
                    <select value={order.status} onChange={(e) => changeStatus(e.target.value)} disabled={saving || !isPaid || order.status === 'cancelado'} className="admin-field w-auto px-4 py-2.5" >
                        {!STATUS_OPTIONS.some(s => s.value === order.status) && <option value={order.status}>{ORDER_STATUS[order.status]?.label || order.status}</option>}
                        {STATUS_OPTIONS.filter(s => s.value === order.status || NEXT_STATUS[order.status]?.includes(s.value))
                            .map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                </div>
            </div>

            <div className="space-y-2 mb-5" aria-label="Pendências críticas do pedido">
                {statusError && <p role="alert" className="border border-red-500/60 bg-red-500/10 p-3 text-sm">{statusError}</p>}
                {uncertainPayment && <p role="alert" className="border border-amber-500/60 bg-amber-500/10 p-3 text-sm">Pagamento com tentativa inconclusiva. Concilie no Mercado Pago antes de liberar reserva, cancelar ou repetir a cobrança.</p>}
                {uncertainShipping && <p role="alert" className="border border-amber-500/60 bg-amber-500/10 p-3 text-sm">{shippingStatusLabel(order.shipping_status)}. O Melhor Envio ainda não confirmou o resultado. Confira o histórico no provedor antes de uma nova tentativa, que pode gerar duplicidade.</p>}
                {fiscalDifferences && <p role="alert" className="border border-amber-500/60 bg-amber-500/10 p-3 text-sm">Divergência fiscal: {fiscalDocument.differences.join(', ')}. Chave bloqueada para o Melhor Envio.</p>}
                {fiscalXmlImportEnabled && isPaid && order.shipping_method === 'melhor_envio' && !fiscalDocument && !fiscalLoadError &&
                    <p role="alert" className="border border-amber-500/60 bg-amber-500/10 p-3 text-sm">NF-e ainda não cadastrada. Importe o XML fiscal original; somente dados conciliados com o pedido e conferidos na fonte oficial podem liberar a chave.</p>}
                {fiscalDocument?.status === 'pending_key' && <p role="alert" className="border border-amber-500/60 bg-amber-500/10 p-3 text-sm">Chave fiscal pendente de XML, conciliação com o pedido e conferência oficial. Expedição bloqueada.</p>}
                {fiscalDocument?.status === 'pending_official' && <p role="alert" className="border border-amber-500/60 bg-amber-500/10 p-3 text-sm">NF-e ainda sem conferência administrativa em fonte oficial. Chave fiscal bloqueada.</p>}
                {fiscalLoadError && <p role="alert" className="border border-amber-500/60 bg-amber-500/10 p-3 text-sm">Não foi possível consultar a situação fiscal. A preparação do envio permanece bloqueada.</p>}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* left: items + summary + timeline */}
                <div className="min-w-0 [overflow-wrap:anywhere] lg:col-span-2 space-y-5">
                    {/* Products */}
                    <div className="bg-background text-foreground p-5">
                        <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Produtos</h2>
                        <div className="space-y-3">
                            {(order.items || []).map((item, i) => (
                                <div key={i} className="flex gap-3">
                                    <img src={item.product_image || item.image} alt="" className="w-14 h-18 object-cover bg-bone" style={{ height: "72px" }} />
                                    <div className="flex-1 text-sm">
                                        <p className="font-medium">{item.product_name}</p>
                                        <p className="text-[11px] text-muted-foreground">{item.color_name} · Tam {item.size} · {item.quantity || item.qty}x</p>
                                        <p className="text-sm mt-1">{formatBRL(Number(item.unit_price || item.price) * (item.quantity || item.qty))}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="pt-4 mt-4 border-t border-border space-y-2 text-sm">
                            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatBRL(Number(order.subtotal))}</span></div>
                            {Number(order.discount) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Cupom ({order.coupon_code})</span><span>- {formatBRL(Number(order.discount))}</span></div>}
                            <div className="flex justify-between"><span className="text-muted-foreground">Frete</span><span>{Number(order.shipping_cost) === 0 ? "Grátis" : formatBRL(Number(order.shipping_cost))}</span></div>
                            <div className="flex justify-between pt-2 border-t border-border text-base font-medium"><span>Total</span><span>{formatBRL(Number(order.total))}</span></div>
                        </div>
                    </div>

                    {/* Payment info */}
                    <div className="bg-background text-foreground p-5">
                        <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4 flex items-center gap-2"><PaymentIcon className="w-4 h-4" strokeWidth={1.5} /> Pagamento</h2>
                        <div className="grid sm:grid-cols-2 gap-3 text-sm">
                            <InfoRow label="Método" value={PAYMENT_LABELS[order.payment_method] || order.payment_method || "—"} />
                            <InfoRow label="Status" value={
                                <span className={PAYMENT_STATUS_COLORS[order.payment_status] || ""}>{PAYMENT_STATUS_PT[order.payment_status] || order.payment_status}</span>
                            } />
                            <InfoRow label="Valor" value={formatBRL(Number(order.total))} />
                            <CardFinancingSummary order={order} />
                            <InfoRow label="Parcelas" value={order.installments ? `${order.installments}x` : "—"} />
                            <InfoRow label="ID Mercado Pago" value={order.mercado_pago_order_id || order.mercado_pago_payment_id || "—"} />
                            <InfoRow label="Data pagamento" value={order.paid_at ? new Date(order.paid_at).toLocaleString("pt-BR") : "—"} />
                        </div>
                    </div>

                    <OperationalPanel title="Conciliação de pagamento" badge={uncertainPayment ? 'Pendente' : null}>
                        {snapshot.payment_context?.mode === 'test' ?
                            <PaymentReconciliationPreview key={order.id} order={order} /> :
                            <p className="text-sm text-muted-foreground">Consulte a situação financeira no provedor antes de qualquer regularização. Nenhuma consulta desta seção movimenta pagamentos.</p>}
                    </OperationalPanel>

                    <OperationalPanel title="Trocas e devoluções">
                        <AdminAfterSales order={order} onChanged={load} view="returns" />
                    </OperationalPanel>
                    <OperationalPanel title="Reembolso e estorno">
                        <AdminAfterSales order={order} onChanged={load} view="refunds" />
                        <OperationalRefund key={order.id} order={order} onChanged={load} />
                    </OperationalPanel>

                    {fiscalXmlImportEnabled && <FiscalDocumentPanel order={order} document={fiscalDocument} loadError={fiscalLoadError} onChanged={setFiscalDocument} />}

                    {/* Delivery / Shipping */}
                    <OperationalPanel title="Expedição e etiquetas" badge={uncertainShipping ? 'Pendente' : null}>
                        <h3 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4 flex items-center gap-2"><Truck className="w-4 h-4" strokeWidth={1.5} /> Entrega</h3>
                        <div className="grid sm:grid-cols-2 gap-3 text-sm">
                            <InfoRow label="Transportadora" value={order.shipping_carrier || snapshot.shipping_carrier || "—"} />
                            <InfoRow label="Serviço" value={order.shipping_service_name || snapshot.shipping_service_name || SHIPPING_LABELS[order.shipping_method] || "—"} />
                            <InfoRow label="Prazo" value={orderDeliveryEstimateLabel(order)} />
                            <InfoRow label="Código rastreio" value={order.tracking_code || "—"} />
                            <InfoRow label="Situação do envio" value={order.shipping_status ? shippingStatusLabel(order.shipping_status) : "—"} />
                            <InfoRow label="ID Melhor Envio" value={order.melhor_envio_shipment_id || "—"} />
                        </div>

                        <ShippingOperations order={order} fiscalDocument={fiscalDocument} onChanged={load} />
                        {order.melhor_envio_shipment_id && <button onClick={fetchTracking} disabled={trackingLoading} className="btn-outline text-xs mt-3">
                            {trackingLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" />} Acompanhar entrega
                        </button>}
                        {trackingInfo && !trackingInfo.error && (
                            <div className="mt-3 p-3 bg-[hsl(var(--bone))] text-xs space-y-1">
                                <p><span className="text-muted-foreground">Status:</span> {trackingInfo.status || "—"}</p>
                                {trackingInfo.tracking_code && <p><span className="text-muted-foreground">Rastreio:</span> {trackingInfo.tracking_code}</p>}
                                {trackingInfo.history?.length > 0 && (
                                    <div className="mt-2 space-y-1">
                                        {trackingInfo.history.map((h, i) => (
                                            <p key={i} className="text-muted-foreground">{h.status || h.label || JSON.stringify(h)}</p>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                        {trackingInfo?.error && <p className="text-xs text-error-ink mt-2">{trackingInfo.error}</p>}
                    </OperationalPanel>

                    {/* Timeline */}
                    <OperationalPanel title="Histórico do pedido">
                        {events.length > 0 ? <OrderTimeline events={events} paymentStatus={order.payment_status} /> :
                            <p className="text-sm text-muted-foreground">Nenhum evento disponível.</p>}
                    </OperationalPanel>
                </div>

                {/* right: customer + address */}
                <div className="min-w-0 [overflow-wrap:anywhere] space-y-5">
                    <div className="bg-background text-foreground p-5">
                        <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-3">Cliente</h2>
                        <div className="space-y-1.5 text-sm">
                            <p className="font-medium">{customer.name || "—"}</p>
                            <p className="text-muted-foreground">{customer.email || "—"}</p>
                            <p className="text-muted-foreground">{customer.phone || "—"}</p>
                            <p className="text-muted-foreground">CPF: {customer.cpf || "—"}</p>
                        </div>
                    </div>
                    <div className="bg-background text-foreground p-5">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Endereço de entrega</h2>
                            <button onClick={copyAddress} className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground hover:text-gold-ink transition-colors">
                                <Copy className="w-3.5 h-3.5" strokeWidth={1.5} /> Copiar
                            </button>
                        </div>
                        <div className="text-sm leading-relaxed">
                            <p>{shippingAddress.street}, {shippingAddress.number}{shippingAddress.complement ? ` - ${shippingAddress.complement}` : ""}</p>
                            <p>{shippingAddress.district}</p>
                            <p>{shippingAddress.city}/{shippingAddress.state}</p>
                            <p className="text-muted-foreground">CEP {shippingAddress.cep}</p>
                        </div>
                    </div>
                    <div className="bg-background text-foreground p-5">
                        <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-3">Resumo</h2>
                        <div className="space-y-1.5 text-sm">
                            <p><span className="text-muted-foreground">Pagamento:</span> {PAYMENT_LABELS[order.payment_method] || order.payment_method || "—"}</p>
                            <p><span className="text-muted-foreground">Status pagamento:</span> <span className={PAYMENT_STATUS_COLORS[order.payment_status] || ""}>{PAYMENT_STATUS_PT[order.payment_status] || order.payment_status}</span></p>
                            <p><span className="text-muted-foreground">Entrega:</span> {SHIPPING_LABELS[order.shipping_method] || order.shipping_method || "—"}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function OperationalPanel({ title, badge = null, children }) {
    return <details className="bg-background text-foreground group">
        <summary className="min-h-11 p-5 flex items-center justify-between gap-3 cursor-pointer list-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[hsl(var(--gold))] [&::-webkit-details-marker]:hidden">
            <span className="text-[11px] uppercase tracking-[0.18em] font-medium">{title}</span>
            <span className="flex items-center gap-2 text-xs">
                {badge && <span className="text-warning-ink font-semibold">{badge}</span>}
                <span aria-hidden="true" className="text-xl leading-none group-open:rotate-45 transition-transform">+</span>
            </span>
        </summary>
        <div className="border-t border-border p-5 min-w-0 [overflow-wrap:anywhere]">{children}</div>
    </details>;
}

function InfoRow({ label, value }) {
    return (
        <div>
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground block">{label}</span>
            <span className="text-sm">{value}</span>
        </div>
    );
}
