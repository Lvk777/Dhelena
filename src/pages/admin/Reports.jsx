import React, { useState, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell, Legend } from "recharts";
import { base44 } from "@/api/base44Client";
import { formatBRL } from "@/data/products";

export default function Reports() {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        base44.entities.Order.list("-created_date", 200).then(setOrders).catch(() => { }).finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="h-64 bg-background animate-pulse" />;

    const revenue = orders.reduce((s, o) => s + (o.total || 0), 0);
    const avg = orders.length ? revenue / orders.length : 0;

    // monthly revenue
    const months = {};
    orders.forEach((o) => {
        const m = (o.created_date || "").slice(0, 7);
        if (!m) return;
        months[m] = (months[m] || 0) + (o.total || 0);
    });
    const monthData = Object.entries(months).sort().slice(-6).map(([m, v]) => ({ month: m.slice(5) + "/" + m.slice(2, 4), vendas: v }));

    // status distribution
    const statusColors = ["hsl(44 69% 54%)", "hsl(352 50% 70%)", "hsl(200 50% 60%)", "hsl(150 50% 50%)", "hsl(0 62% 50%)"];
    const statusData = Object.entries(
        orders.reduce((acc, o) => { acc[o.status] = (acc[o.status] || 0) + 1; return acc; }, {})
    ).map(([k, v]) => ({ name: k, value: v }));

    // top products
    const productSales = {};
    orders.forEach((o) => {
        (o.items || []).forEach((i) => {
            productSales[i.product_name] = (productSales[i.product_name] || 0) + (i.price * i.qty);
        });
    });
    const topProducts = Object.entries(productSales).sort((a, b) => b[1] - a[1]).slice(0, 5);

    return (
        <div>
            <h1 className="font-heading text-2xl tracking-[0.03em] mb-6">Relatórios</h1>

            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                <div className="bg-background p-5"><p className="font-numeric text-2xl font-medium">{formatBRL(revenue)}</p><p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mt-1">Receita total</p></div>
                <div className="bg-background p-5"><p className="font-numeric text-2xl font-medium">{orders.length}</p><p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mt-1">Total de pedidos</p></div>
                <div className="bg-background p-5"><p className="font-numeric text-2xl font-medium">{formatBRL(avg)}</p><p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mt-1">Ticket médio</p></div>
            </div>

            <div className="grid lg:grid-cols-2 gap-5 mb-5">
                <div className="bg-background p-6">
                    <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Receita por mês</h2>
                    <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={monthData}><XAxis dataKey="month" tick={{ fontSize: 11, fill: "#999" }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 11, fill: "#999" }} axisLine={false} tickLine={false} tickFormatter={(v) => `R$${v}`} /><Tooltip formatter={(v) => formatBRL(v)} /><Bar dataKey="vendas" fill="hsl(44 69% 54%)" radius={[4, 4, 0, 0]} /></BarChart>
                    </ResponsiveContainer>
                </div>
                <div className="bg-background p-6">
                    <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Pedidos por status</h2>
                    <ResponsiveContainer width="100%" height={250}>
                        <PieChart><Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>{statusData.map((_, i) => <Cell key={i} fill={statusColors[i % statusColors.length]} />)}</Pie><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="bg-background p-6">
                <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Produtos mais vendidos</h2>
                {topProducts.length === 0 ? <p className="text-sm text-muted-foreground">Sem dados ainda.</p> : (
                    <div className="space-y-2">
                        {topProducts.map(([name, total], i) => (
                            <div key={name} className="flex items-center justify-between text-sm py-2 border-b border-border last:border-0">
                                <span><span className="text-muted-foreground mr-3 font-numeric">{i + 1}.</span> {name}</span>
                                <span className="font-medium font-numeric">{formatBRL(total)}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}