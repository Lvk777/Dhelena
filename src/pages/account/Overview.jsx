import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Package, Clock, Heart, ArrowRight } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useStore } from "@/context/StoreContext";
import { formatBRL, ORDER_STATUS } from "@/data/products";

export default function Overview() {
    const { user } = useAuth();
    const { favorites } = useStore();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        base44.entities.Order.list("-created_date", 50)
            .then(setOrders)
            .catch(() => { })
            .finally(() => setLoading(false));
    }, []);

    const firstName = (user?.full_name || "").split(" ")[0] || "querida";
    const ongoing = orders.filter((o) => !["entregue", "cancelado"].includes(o.status));
    const latest = orders[0];

    return (
        <div>
            <h1 className="font-heading text-3xl tracking-[0.03em]">Olá, {firstName}</h1>
            <div className="flex justify-start mt-3 mb-8"><div className="gold-rule" /></div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
                <StatCard icon={Package} label="Pedidos realizados" value={orders.length} />
                <StatCard icon={Clock} label="Em andamento" value={ongoing.length} />
                <StatCard icon={Heart} label="Favoritos" value={favorites.length} />
            </div>

            <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Pedido mais recente</h2>
            {loading ? (
                <div className="h-32 bg-bone animate-pulse" />
            ) : latest ? (
                <Link to={`/minha-conta/pedidos/${latest.id}`} className="block bg-[hsl(var(--bone))] p-6 hover:shadow-md transition-shadow group">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                        <div>
                            <p className="text-sm font-medium">{latest.order_number}</p>
                            <p className="text-[11px] text-muted-foreground mt-1">
                                {new Date(latest.created_date).toLocaleDateString("pt-BR")} · {formatBRL(latest.total)}
                            </p>
                        </div>
                        <span className="text-[11px] uppercase tracking-[0.18em] px-3 py-1.5 bg-background">
                            {ORDER_STATUS[latest.status]?.label || latest.status}
                        </span>
                    </div>
                    <div className="flex items-center gap-2 mt-4 text-[hsl(var(--rose))] text-sm">
                        Ver detalhes <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" strokeWidth={1.5} />
                    </div>
                </Link>
            ) : (
                <div className="bg-[hsl(var(--bone))] p-8 text-center">
                    <p className="text-sm text-muted-foreground">Você ainda não fez nenhum pedido.</p>
                    <Link to="/loja" className="btn-outline mt-4 inline-flex">Explorar a coleção</Link>
                </div>
            )}
        </div>
    );
}

function StatCard({ icon: Icon, label, value }) {
    return (
        <div className="bg-[hsl(var(--bone))] p-6">
            <Icon className="w-5 h-5 text-[hsl(var(--gold))] mb-3" strokeWidth={1.25} />
            <p className="font-heading text-3xl">{value}</p>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mt-1">{label}</p>
        </div>
    );
}