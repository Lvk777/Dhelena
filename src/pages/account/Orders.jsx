import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Package, ArrowRight } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { formatBRL, ORDER_STATUS } from "@/data/products";

export default function Orders() {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        base44.entities.Order.list("-created_date", 50)
            .then(setOrders)
            .catch(() => { })
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="h-40 bg-bone animate-pulse" />;

    if (orders.length === 0) {
        return (
            <div>
                <h1 className="font-heading text-3xl tracking-[0.03em] mb-6">Meus pedidos</h1>
                <div className="bg-[hsl(var(--bone))] p-12 text-center">
                    <Package className="w-10 h-10 text-muted-foreground/40 mx-auto mb-4" strokeWidth={1} />
                    <p className="text-sm text-muted-foreground">Você ainda não fez nenhum pedido.</p>
                    <Link to="/loja" className="btn-outline mt-5 inline-flex">Explorar a coleção</Link>
                </div>
            </div>
        );
    }

    return (
        <div>
            <h1 className="font-heading text-3xl tracking-[0.03em] mb-6">Meus pedidos</h1>
            <div className="space-y-4">
                {orders.map((order) => (
                    <div key={order.id} className="bg-[hsl(var(--bone))] p-6">
                        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                            <div>
                                <p className="text-sm font-medium">{order.order_number}</p>
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                    {new Date(order.created_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
                                </p>
                            </div>
                            <span className="text-[11px] uppercase tracking-[0.18em] px-3 py-1.5 bg-background">
                                {ORDER_STATUS[order.status]?.label || order.status}
                            </span>
                        </div>

                        <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar">
                            {(order.items || []).slice(0, 5).map((item, i) => (
                                <img key={i} src={item.image} alt={item.product_name} className="w-14 h-18 object-cover bg-background shrink-0" style={{ height: "72px" }} />
                            ))}
                        </div>

                        <div className="flex items-center justify-between flex-wrap gap-3 pt-4 border-t border-border">
                            <div className="text-sm">
                                <span className="text-muted-foreground">{(order.items || []).length} {((order.items || []).length) === 1 ? "item" : "itens"} · </span>
                                <span className="font-medium">{formatBRL(order.total)}</span>
                            </div>
                            <Link to={`/minha-conta/pedidos/${order.id}`} className="btn-ghost text-[hsl(var(--rose))]">
                                Ver detalhes <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
                            </Link>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}