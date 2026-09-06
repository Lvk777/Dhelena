import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { formatBRL } from "@/data/products";

export default function Customers() {
    const [users, setUsers] = useState([]);
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([
            base44.entities.User.list().catch(() => []),
            base44.entities.Order.list("-created_date", 200).catch(() => []),
        ]).then(([u, o]) => { setUsers(u || []); setOrders(o || []); }).finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="h-64 bg-background animate-pulse" />;

    const statsByEmail = {};
    orders.forEach((o) => {
        const e = o.customer_email;
        if (!e) return;
        if (!statsByEmail[e]) statsByEmail[e] = { count: 0, total: 0, lastDate: null };
        statsByEmail[e].count++;
        statsByEmail[e].total += o.total || 0;
        if (!statsByEmail[e].lastDate || o.created_date > statsByEmail[e].lastDate) statsByEmail[e].lastDate = o.created_date;
    });

    const customers = users.filter((u) => u.role !== "admin");

    return (
        <div>
            <h1 className="font-heading text-2xl tracking-[0.03em] mb-6">Clientes</h1>
            {customers.length === 0 ? (
                <div className="bg-background p-12 text-center"><p className="text-sm text-muted-foreground">Nenhum cliente cadastrado.</p></div>
            ) : (
                <div className="bg-background overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                            <th className="py-3 px-3">Nome</th><th className="py-3 px-3">E-mail</th><th className="py-3 px-3 hidden sm:table-cell">Telefone</th>
                            <th className="py-3 px-3 hidden md:table-cell">Pedidos</th><th className="py-3 px-3 hidden md:table-cell">Total comprado</th>
                            <th className="py-3 px-3 hidden lg:table-cell">Última compra</th><th className="py-3 px-3 hidden lg:table-cell">Cadastro</th>
                        </tr></thead>
                        <tbody className="divide-y divide-border">
                            {customers.map((u) => {
                                const s = statsByEmail[u.email] || {};
                                return (
                                    <tr key={u.id} className="hover:bg-[hsl(var(--bone))]/50">
                                        <td className="py-3 px-3 font-medium">{u.full_name || "—"}</td>
                                        <td className="py-3 px-3 text-muted-foreground">{u.email}</td>
                                        <td className="py-3 px-3 hidden sm:table-cell text-muted-foreground font-numeric">{u.phone || "—"}</td>
                                        <td className="py-3 px-3 hidden md:table-cell font-numeric">{s.count || 0}</td>
                                        <td className="py-3 px-3 hidden md:table-cell font-numeric">{s.total ? formatBRL(s.total) : "—"}</td>
                                        <td className="py-3 px-3 hidden lg:table-cell text-muted-foreground font-numeric">{s.lastDate ? new Date(s.lastDate).toLocaleDateString("pt-BR") : "—"}</td>
                                        <td className="py-3 px-3 hidden lg:table-cell text-muted-foreground font-numeric">{u.created_date ? new Date(u.created_date).toLocaleDateString("pt-BR") : "—"}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
            <p className="text-[11px] text-muted-foreground mt-4">As senhas dos clientes nunca são exibidas.</p>
        </div>
    );
}