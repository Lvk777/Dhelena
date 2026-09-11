import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Check, Truck, MapPin, QrCode, CreditCard, Banknote, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { formatBRL, ORDER_STATUS, ORDER_TIMELINE, PAYMENT_LABELS, SHIPPING_LABELS, PAYMENT_STATUS_PT, PAYMENT_STATUS_COLORS } from "@/data/products";
import OrderTimeline from "@/components/checkout/OrderTimeline";

export default function OrderDetail() {
    const { id } = useParams();
    const [order, setOrder] = useState(null);
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [trackingInfo, setTrackingInfo] = useState(null);
    const [trackingLoading, setTrackingLoading] = useState(false);

    useEffect(() => {
        Promise.all([
            base44.entities.Order.get(id).catch(() => null),
            base44.functions.invoke("getOrderEvents", { orderId: id }).catch(() => []),
        ]).then(([o, evs]) => {
            setOrder(o);
            setEvents(Array.isArray(evs) ? evs : []);
            setLoading(false);
        });
    }, [id]);

    const fetchTracking = async () => {
        setTrackingLoading(true);
        try {
            const res = await base44.functions.invoke("getTrackingInfo", { orderId: id });
            setTrackingInfo(res);
        } catch (e) {
            setTrackingInfo({ error: e.response?.data?.error || e.message });
        } finally { setTrackingLoading(false); }
    };

    if (loading) return <div className="h-64 bg-bone animate-pulse" />;
    if (!order) {
        return (
            <div className="text-center py-12">
                <p className="text-muted-foreground">Pedido não encontrado.</p>
                <Link to="/minha-conta/pedidos" className="btn-outline mt-4 inline-flex">Ver meus pedidos</Link>
            </div>
        );
    }

    const snapshot = order.snapshot || {};
    const customer = snapshot.customer || {};
    const shippingAddress = order.shipping_address || snapshot.shipping_address || {};
    const currentStep = ORDER_STATUS[order.status]?.step ?? 0;
    const isCancelled = order.status === "cancelado";
    const PaymentIcon = order.payment_method === "pix" ? QrCode : order.payment_method === "debito" ? Banknote : CreditCard;

    return (
        <div>
            <Link to="/minha-conta/pedidos" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6">
                <ArrowLeft className="w-4 h-4" strokeWidth={1.5} /> Voltar para meus pedidos
            </Link>

            <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
                <h1 className="font-heading text-3xl tracking-[0.03em]">{order.order_number}</h1>
                <span className="text-[11px] uppercase tracking-[0.18em] px-3 py-1.5 bg-[hsl(var(--bone))]">
                    {ORDER_STATUS[order.status]?.label || order.status}
                </span>
            </div>
            <p className="text-sm text-muted-foreground mb-8">
                {new Date(order.created_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
            </p>

            {/* Timeline from events */}
            {events.length > 0 ? (
                <div className="mb-10">
                    <OrderTimeline events={events} />
                </div>
            ) : !isCancelled && (
                <div className="mb-10">
                    <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-6">Linha do tempo</h2>
                    <div className="space-y-0">
                        {ORDER_TIMELINE.map((statusKey, i) => {
                            const done = i <= currentStep;
                            const isCurrent = i === currentStep;
                            return (
                                <div key={statusKey} className="flex items-center gap-4">
                                    <div className="flex flex-col items-center">
                                        <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-colors ${done ? "bg-[hsl(var(--gold))] border-[hsl(var(--gold))] text-white" : "border-border text-muted-foreground"}`}>
                                            {done ? <Check className="w-4 h-4" strokeWidth={2} /> : <span className="text-xs">{i + 1}</span>}
                                        </div>
                                        {i < ORDER_TIMELINE.length - 1 && <div className={`w-px h-8 ${done && i < currentStep ? "bg-[hsl(var(--gold))]" : "bg-border"}`} />}
                                    </div>
                                    <span className={`text-sm pb-8 ${isCurrent ? "font-medium text-foreground" : done ? "text-foreground/80" : "text-muted-foreground"}`}>
                                        {ORDER_STATUS[statusKey]?.label}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Items */}
            <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Produtos</h2>
            <div className="space-y-4 mb-8">
                {(order.items || []).map((item, i) => (
                    <div key={i} className="flex gap-4 bg-[hsl(var(--bone))] p-4">
                        <img src={item.product_image || item.image} alt={item.product_name} className="w-16 h-20 object-cover bg-background" />
                        <div className="flex-1">
                            <p className="text-sm font-medium">{item.product_name}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                                {item.color_name} · Tam {item.size} · {item.quantity || item.qty}x
                            </p>
                            <p className="text-sm mt-1">{formatBRL(Number(item.unit_price || item.price) * (item.quantity || item.qty))}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Summary */}
            <div className="bg-[hsl(var(--bone))] p-6 space-y-2 text-sm mb-8">
                <Row label="Subtotal" value={formatBRL(Number(order.subtotal))} />
                {Number(order.discount) > 0 && <Row label="Desconto" value={`- ${formatBRL(Number(order.discount))}`} />}
                <Row label="Frete" value={Number(order.shipping_cost) === 0 ? "Grátis" : formatBRL(Number(order.shipping_cost))} />
                <div className="pt-3 border-t border-border flex justify-between text-base font-medium">
                    <span>Total</span><span>{formatBRL(Number(order.total))}</span>
                </div>
            </div>

            {/* Payment + Delivery info */}
            <div className="grid sm:grid-cols-2 gap-6 mb-8">
                <InfoBlock title="Pagamento">
                    <div className="space-y-2 text-sm">
                        <p className="flex items-center gap-2">
                            <PaymentIcon className="w-4 h-4 text-[hsl(var(--gold))]" strokeWidth={1.5} />
                            {PAYMENT_LABELS[order.payment_method] || order.payment_method || "—"}
                        </p>
                        <p>
                            <span className="text-muted-foreground">Status: </span>
                            <span className={PAYMENT_STATUS_COLORS[order.payment_status] || ""}>
                                {PAYMENT_STATUS_PT[order.payment_status] || order.payment_status}
                            </span>
                        </p>
                        {order.installments > 1 && <p className="text-muted-foreground">{order.installments}x de {formatBRL(Number(order.total) / order.installments)}</p>}
                    </div>
                </InfoBlock>
                <InfoBlock title="Entrega">
                    <div className="space-y-2 text-sm">
                        <p className="flex items-center gap-2">
                            <Truck className="w-4 h-4 text-[hsl(var(--gold))]" strokeWidth={1.5} />
                            {SHIPPING_LABELS[order.shipping_method] || order.shipping_method || "—"}
                        </p>
                        {order.shipping_carrier && <p className="text-muted-foreground">{order.shipping_carrier} · {order.shipping_service_name}</p>}
                        {order.shipping_delivery_time && <p className="text-muted-foreground">{order.shipping_delivery_time} dia(s) úteis</p>}
                        {order.tracking_code && (
                            <p className="text-muted-foreground">Rastreio: {order.tracking_code}</p>
                        )}
                        {order.melhor_envio_shipment_id && (
                            <button onClick={fetchTracking} disabled={trackingLoading} className="btn-outline text-xs flex items-center gap-2 mt-2">
                                {trackingLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" strokeWidth={1.5} />}
                                Acompanhar entrega
                            </button>
                        )}
                        {trackingInfo && !trackingInfo.error && (
                            <div className="mt-2 p-2 bg-[hsl(var(--bone))] text-xs space-y-1">
                                <p><span className="text-muted-foreground">Status:</span> {trackingInfo.status || "—"}</p>
                                {trackingInfo.history?.length > 0 && (
                                    <div className="space-y-0.5">
                                        {trackingInfo.history.slice(-5).map((h, i) => (
                                            <p key={i} className="text-muted-foreground">{h.status || h.label || JSON.stringify(h)}</p>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </InfoBlock>
                <InfoBlock title="Endereço de entrega" full>
                    <p className="text-sm leading-relaxed">
                        {shippingAddress.street}, {shippingAddress.number}{shippingAddress.complement ? ` - ${shippingAddress.complement}` : ""}<br />
                        {shippingAddress.district} · {shippingAddress.city}/{shippingAddress.state}<br />
                        CEP {shippingAddress.cep}
                    </p>
                </InfoBlock>
            </div>
        </div>
    );
}

function Row({ label, value }) {
    return <div className="flex justify-between"><span className="text-muted-foreground">{label}</span><span>{value}</span></div>;
}

function InfoBlock({ title, children, full }) {
    return (
        <div className={full ? "sm:col-span-2" : ""}>
            <h3 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-2">{title}</h3>
            {children}
        </div>
    );
}
