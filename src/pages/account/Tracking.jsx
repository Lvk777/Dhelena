import React, { useState, useEffect } from "react";
import { Truck } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { formatBRL, ORDER_STATUS } from "@/data/products";
import { Link } from "react-router-dom";

export default function Tracking() {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        base44.entities.Order.filter({ status: { $in: ["enviado", "em_transporte", "saiu_entrega"] } }, "-created_date", 50)
            .then(setOrders)
            .catch(() => { setError(true); })
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="h-40 bg-bone animate-pulse" />;

    const tracked = orders;

    return (
        <div>
            <h1 className="font-heading text-3xl tracking-[0.03em] mb-2">Rastreamento</h1>
            <p className="text-sm text-muted-foreground mb-8">Acompanhe seus pedidos em trânsito.</p>

            {error ? <p role="alert">Não foi possível consultar seus envios. Recarregue a página para tentar novamente.</p> : tracked.length === 0 ? (
                <div className="bg-[hsl(var(--bone))] p-12 text-center">
                    <Truck className="w-10 h-10 text-muted-foreground/40 mx-auto mb-4" strokeWidth={1} />
                    <p className="text-sm text-muted-foreground">Nenhum pedido em trânsito no momento.</p>
                    <p className="text-[11px] text-muted-foreground mt-2">Quando seu pedido for enviado, as informações de rastreamento aparecerão aqui.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {tracked.map((order) => (
                        <div key={order.id} className="bg-[hsl(var(--bone))] p-6">
                            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                                <div>
                                    <p className="text-sm font-medium">{order.order_number}</p>
                                    <p className="text-[11px] text-muted-foreground mt-0.5">{formatBRL(order.total)}</p>
                                </div>
                                <span className="text-[11px] uppercase tracking-[0.18em] px-3 py-1.5 bg-background">
                                    {ORDER_STATUS[order.status]?.label}
                                </span>
                            </div>

                            <div className="space-y-2 text-sm border-t border-border pt-4">
                                <div className="flex gap-3">
                                    <span className="text-muted-foreground w-32">Transportadora:</span>
                                    <span className="font-medium">{order.shipping_carrier || "—"}</span>
                                </div>
                                <div className="flex gap-3">
                                    <span className="text-muted-foreground w-32">Código de rastreamento:</span>
                                    <span className="font-medium font-mono text-xs">{order.tracking_code || "Aguardando código da transportadora"}</span>
                                </div>
                                <div className="flex gap-3">
                                    <span className="text-muted-foreground w-32">Data de postagem:</span>
                                    <span className="font-medium">{order.posted_at ? new Date(order.posted_at).toLocaleDateString("pt-BR") : "—"}</span>
                                </div>
                            </div>

                            <Link to={`/minha-conta/pedidos/${order.id}`} className="btn-gold mt-5 w-full sm:w-auto">Acompanhar entrega</Link>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
