import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Check } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { formatBRL, ORDER_STATUS, ORDER_TIMELINE, PAYMENT_LABELS, SHIPPING_LABELS } from "@/data/products";

export default function OrderDetail() {
    const { id } = useParams();
    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        base44.entities.Order.get(id)
            .then(setOrder)
            .catch(() => setOrder(null))
            .finally(() => setLoading(false));
    }, [id]);

    if (loading) return <div className="h-64 bg-bone animate-pulse" />;

    if (!order) {
        return (
            <div className="text-center py-12">
                <p className="text-muted-foreground">Pedido não encontrado.</p>
                <Link to="/minha-conta/pedidos" className="btn-outline mt-4 inline-flex">Ver meus pedidos</Link>
            </div>
        );
    }

    const currentStep = ORDER_STATUS[order.status]?.step ?? 0;
    const isCancelled = order.status === "cancelado";

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

            {/* timeline */}
            {!isCancelled && (
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

            {/* items */}
            <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Produtos</h2>
            <div className="space-y-4 mb-8">
                {(order.items || []).map((item, i) => (
                    <div key={i} className="flex gap-4 bg-[hsl(var(--bone))] p-4">
                        <img src={item.image} alt={item.product_name} className="w-16 h-20 object-cover bg-background" />
                        <div className="flex-1">
                            <p className="text-sm font-medium">{item.product_name}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                                {item.color_name} · Tam {item.size} · {item.qty}x
                            </p>
                            <p className="text-sm mt-1">{formatBRL(item.price * item.qty)}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* summary */}
            <div className="bg-[hsl(var(--bone))] p-6 space-y-2 text-sm mb-8">
                <Row label="Subtotal" value={formatBRL(order.subtotal)} />
                {order.discount > 0 && <Row label="Desconto" value={`- ${formatBRL(order.discount)}`} />}
                <Row label="Frete" value={order.shipping_cost === 0 ? "Grátis" : formatBRL(order.shipping_cost)} />
                <div className="pt-3 border-t border-border flex justify-between text-base font-medium">
                    <span>Total</span><span>{formatBRL(order.total)}</span>
                </div>
            </div>

            {/* info grid */}
            <div className="grid sm:grid-cols-2 gap-6">
                <InfoBlock title="Pagamento">
                    <p className="text-sm">{PAYMENT_LABELS[order.payment_method] || order.payment_method}</p>
                </InfoBlock>
                <InfoBlock title="Entrega">
                    <p className="text-sm">{SHIPPING_LABELS[order.shipping_method] || order.shipping_method}</p>
                </InfoBlock>
                <InfoBlock title="Endereço de entrega" full>
                    <p className="text-sm leading-relaxed">
                        {order.address?.street}, {order.address?.number}{order.address?.complement ? ` - ${order.address.complement}` : ""}<br />
                        {order.address?.district} · {order.address?.city}/{order.address?.state}<br />
                        CEP {order.address?.cep}
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