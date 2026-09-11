import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { DollarSign, ShoppingCart, Package, Users, AlertTriangle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { base44 } from "@/api/base44Client";
import { formatBRL, totalStock } from "@/data/products";

export default function Dashboard() {
    const [orders, setOrders] = useState([]);
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([
            base44.entities.Order.list("-created_date", 200).catch(() => []),
            base44.entities.Product.list("-created_date", 200).catch(() => []),
        ]).then(([o, p]) => { setOrders(o || []); setProducts(p || []); })
            .finally(() => setLoading(false));
    }, []);

    const revenue = orders.reduce((s, o) => s + (o.total || 0), 0);
    const published = products.filter((p) => p.status === "published");
    const lowStock = products.filter((p) => p.status === "published" && totalStock(p) > 0 && totalStock(p) <= 6);
    const outStock = products.filter((p) => p.status === "published" && totalStock(p) === 0);

    // last 7 days revenue
    const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d;
    });
    const chartData = days.map((d) => {
        const key = d.toISOString().slice(0, 10);
        const dayOrders = orders.filter((o) => (o.created_date || "").slice(0, 10) === key);
        return {
            day: d.toLocaleDateString("pt-BR", { weekday: "short" }).slice(0, 3),
            vendas: dayOrders.reduce((s, o) => s + (o.total || 0), 0),
        };
    });

    // unique customers
    const customerEmails = [...new Set(orders.map((o) => o.customer_email).filter(Boolean))];

    if (loading) return <div className="h-64 bg-background animate-pulse" />;

    return (
        <div>
            <h1 className="font-heading text-2xl tracking-[0.03em] mb-6">Dashboard</h1>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <KPI icon={DollarSign} label="Receita total" value={formatBRL(revenue)} />
                <KPI icon={ShoppingCart} label="Pedidos" value={orders.length} />
                <KPI icon={Package} label="Produtos ativos" value={published.length} />
                <KPI icon={Users} label="Clientes" value={customerEmails.length} />
            </div>

            <div className="grid lg:grid-cols-3 gap-5">
                {/* chart */}
                <div className="lg:col-span-2 bg-background p-6">
                    <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Vendas dos últimos 7 dias</h2>
                    <ResponsiveContainer width="100%" height={240}>
                        <BarChart data={chartData}>
                            <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#999" }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fontSize: 11, fill: "#999" }} axisLine={false} tickLine={false} tickFormatter={(v) => `R$${v}`} />
                            <Tooltip formatter={(v) => formatBRL(v)} contentStyle={{ fontSize: 12, border: "1px solid #eee" }} />
                            <Bar dataKey="vendas" fill="hsl(44 69% 54%)" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* alerts */}
                <div className="bg-background p-6">
                    <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Alertas de estoque</h2>
                    {outStock.length === 0 && lowStock.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Tudo em ordem ✓</p>
                    ) : (
                        <div className="space-y-3">
                            {outStock.map((p) => (
                                <Link key={p.id} to="/admin/estoque" className="flex items-center gap-2 text-sm text-[hsl(var(--rose))]">
                                    <AlertTriangle className="w-4 h-4 shrink-0" strokeWidth={1.5} /> {p.name} — Esgotado
                                </Link>
                            ))}
                            {lowStock.map((p) => (
                                <Link key={p.id} to="/admin/estoque" className="flex items-center gap-2 text-sm text-foreground/70">
                                    <AlertTriangle className="w-4 h-4 shrink-0 text-[hsl(var(--gold))]" strokeWidth={1.5} /> {p.name} — <span className="font-numeric">{totalStock(p)}</span> un.
                                </Link>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* recent orders */}
            <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mt-8 mb-4">Pedidos recentes</h2>
            <div className="bg-background">
                {orders.length === 0 ? (
                    <p className="text-sm text-muted-foreground p-6">Nenhum pedido ainda.</p>
                ) : (
                    <div className="divide-y divide-border">
                        {orders.slice(0, 5).map((o) => (
                            <Link key={o.id} to={`/admin/pedidos/${o.id}`} className="flex items-center justify-between p-4 hover:bg-[hsl(var(--bone))] transition-colors">
                                <div>
                                    <p className="text-sm font-medium font-numeric">{o.order_number}</p>
                                    <p className="text-[11px] text-muted-foreground font-numeric">{o.customer_name} · {new Date(o.created_date).toLocaleDateString("pt-BR")}</p>
                                </div>
                                <span className="text-sm font-medium font-numeric">{formatBRL(o.total)}</span>
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function KPI({ icon: Icon, label, value }) {
    return (
        <div className="bg-background p-5">
            <Icon className="w-5 h-5 text-[hsl(var(--gold))] mb-3" strokeWidth={1.25} />
            <p className="font-numeric text-2xl font-medium">{value}</p>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mt-1">{label}</p>
        </div>
    );
}