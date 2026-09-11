import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Truck, Loader2, Copy, FileText, Printer, MapPin, QrCode, CreditCard, Banknote } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { formatBRL, ORDER_STATUS, PAYMENT_LABELS, SHIPPING_LABELS, PAYMENT_STATUS_PT, PAYMENT_STATUS_COLORS } from "@/data/products";
import OrderTimeline from "@/components/checkout/OrderTimeline";

const STATUS_OPTIONS = Object.entries(ORDER_STATUS).map(([key, v]) => ({ value: key, label: v.label }));

export default function AdminOrderDetail() {
    const { id } = useParams();
    const [order, setOrder] = useState(null);
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [labelLoading, setLabelLoading] = useState(false);
    const [labelError, setLabelError] = useState("");
    const [trackingInfo, setTrackingInfo] = useState(null);
    const [trackingLoading, setTrackingLoading] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const o = await base44.entities.Order.get(id);
            setOrder(o);
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
        setSaving(true);
        try {
            await base44.functions.invoke("updateOrderStatus", { orderId: id, status: newStatus });
            load();
        } catch (e) {
            console.error("Erro ao atualizar status:", e.response?.data?.error || e.message || "");
        } finally { setSaving(false); }
    };

    const copyAddress = () => {
        const a = order.shipping_address || order.snapshot?.shipping_address || {};
        const text = `${a.street || ""}, ${a.number || ""}${a.complement ? ` - ${a.complement}` : ""}\n${a.district || ""}\n${a.city || ""} - ${a.state || ""}\nCEP ${a.cep || ""}`;
        navigator.clipboard?.writeText(text);
    };

    const generateLabel = async () => {
        setLabelLoading(true);
        setLabelError("");
        try {
            await base44.functions.invoke("generateShippingLabel", { orderId: id });
            load();
        } catch (e) {
            setLabelError(e.response?.data?.error || e.message || "Erro ao gerar etiqueta");
        } finally { setLabelLoading(false); }
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

    if (loading) return <div className="h-64 bg-background animate-pulse" />;
    if (!order) return <div className="text-center py-12"><p className="text-muted-foreground">Pedido não encontrado.</p><Link to="/admin/pedidos" className="btn-outline mt-4 inline-flex">Voltar</Link></div>;

    const snapshot = order.snapshot || {};
    const customer = snapshot.customer || {};
    const shippingAddress = order.shipping_address || snapshot.shipping_address || {};
    const isPaid = order.payment_status === "approved";
    const hasLabel = !!order.melhor_envio_shipment_id;

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
                    <select value={order.status} onChange={(e) => changeStatus(e.target.value)} disabled={saving} className="border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:border-[hsl(var(--gold))]" >
                        {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                </div>
            </div>

            <div className="grid lg:grid-cols-3 gap-5">
                {/* left: items + summary + timeline */}
                <div className="lg:col-span-2 space-y-5">
                    {/* Products */}
                    <div className="bg-background p-5">
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
                    <div className="bg-background p-5">
                        <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4 flex items-center gap-2"><PaymentIcon className="w-4 h-4" strokeWidth={1.5} /> Pagamento</h2>
                        <div className="grid sm:grid-cols-2 gap-3 text-sm">
                            <InfoRow label="Método" value={PAYMENT_LABELS[order.payment_method] || order.payment_method || "—"} />
                            <InfoRow label="Status" value={
                                <span className={PAYMENT_STATUS_COLORS[order.payment_status] || ""}>{PAYMENT_STATUS_PT[order.payment_status] || order.payment_status}</span>
                            } />
                            <InfoRow label="Valor" value={formatBRL(Number(order.total))} />
                            <InfoRow label="Parcelas" value={order.installments ? `${order.installments}x` : "—"} />
                            <InfoRow label="ID Mercado Pago" value={order.mercado_pago_order_id || order.mercado_pago_payment_id || "—"} />
                            <InfoRow label="Data pagamento" value={order.paid_at ? new Date(order.paid_at).toLocaleString("pt-BR") : "—"} />
                        </div>
                    </div>

                    {/* Delivery / Shipping */}
                    <div className="bg-background p-5">
                        <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4 flex items-center gap-2"><Truck className="w-4 h-4" strokeWidth={1.5} /> Entrega</h2>
                        <div className="grid sm:grid-cols-2 gap-3 text-sm">
                            <InfoRow label="Transportadora" value={order.shipping_carrier || snapshot.shipping_carrier || "—"} />
                            <InfoRow label="Serviço" value={order.shipping_service_name || snapshot.shipping_service_name || SHIPPING_LABELS[order.shipping_method] || "—"} />
                            <InfoRow label="Prazo" value={order.shipping_delivery_time ? `${order.shipping_delivery_time} dia(s) úteis` : "—"} />
                            <InfoRow label="Código rastreio" value={order.tracking_code || "—"} />
                            <InfoRow label="Status envio" value={order.shipping_status || "—"} />
                            <InfoRow label="ID Melhor Envio" value={order.melhor_envio_shipment_id || "—"} />
                        </div>

                        {/* Actions */}
                        <div className="flex flex-wrap gap-2 mt-4">
                            {!isPaid && (
                                <p className="text-xs text-amber-600 flex items-center gap-1.5">
                                    <FileText className="w-3.5 h-3.5" strokeWidth={1.5} /> Etiqueta disponível após pagamento aprovado
                                </p>
                            )}
                            {isPaid && !hasLabel && (
                                <button onClick={generateLabel} disabled={labelLoading} className="btn-outline text-xs flex items-center gap-2">
                                    {labelLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" strokeWidth={1.5} />}
                                    Gerar etiqueta
                                </button>
                            )}
                            {hasLabel && (
                                <>
                                    <button onClick={fetchTracking} disabled={trackingLoading} className="btn-outline text-xs flex items-center gap-2">
                                        {trackingLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" strokeWidth={1.5} />}
                                        Rastrear
                                    </button>
                                    {order.melhor_envio_shipment_id && (
                                        <a
                                            href={`https://sandbox.melhorenvio.com.br/carrinho/${order.melhor_envio_shipment_id}`}
                                            target="_blank" rel="noopener noreferrer"
                                            className="btn-outline text-xs flex items-center gap-2"
                                        >
                                            <Printer className="w-3.5 h-3.5" strokeWidth={1.5} /> Imprimir etiqueta
                                        </a>
                                    )}
                                </>
                            )}
                        </div>
                        {labelError && <p className="text-xs text-red-600 mt-2">{labelError}</p>}
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
                        {trackingInfo?.error && <p className="text-xs text-red-600 mt-2">{trackingInfo.error}</p>}
                    </div>

                    {/* Timeline */}
                    {events.length > 0 && (
                        <div className="bg-background p-5">
                            <OrderTimeline events={events} />
                        </div>
                    )}
                </div>

                {/* right: customer + address */}
                <div className="space-y-5">
                    <div className="bg-background p-5">
                        <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-3">Cliente</h2>
                        <div className="space-y-1.5 text-sm">
                            <p className="font-medium">{customer.name || "—"}</p>
                            <p className="text-muted-foreground">{customer.email || "—"}</p>
                            <p className="text-muted-foreground">{customer.phone || "—"}</p>
                            <p className="text-muted-foreground">CPF: {customer.cpf || "—"}</p>
                        </div>
                    </div>
                    <div className="bg-background p-5">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Endereço de entrega</h2>
                            <button onClick={copyAddress} className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground hover:text-[hsl(var(--gold))] transition-colors">
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
                    <div className="bg-background p-5">
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

function InfoRow({ label, value }) {
    return (
        <div>
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground block">{label}</span>
            <span className="text-sm">{value}</span>
        </div>
    );
}
