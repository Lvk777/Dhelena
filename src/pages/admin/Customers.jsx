import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";

export default function Customers() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        base44.entities.User.list().then(u => setUsers(u || [])).catch(() => setUsers([])).finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="h-64 bg-background animate-pulse" />;

    const customers = users.filter((u) => u.role !== "admin");

    return (
        <div>
            <h1 className="font-heading text-2xl tracking-[0.03em] mb-2">Clientes</h1>
            <p className="text-xs text-muted-foreground mb-6">Cadastros preservados. Consulte o <Link to="/admin/pedidos" className="underline">histórico de pedidos</Link> separadamente dos indicadores do novo lançamento.</p>
            {customers.length === 0 ? (
                <div className="bg-background p-12 text-center"><p className="text-sm text-muted-foreground">Nenhum cliente cadastrado.</p></div>
            ) : (
                <div className="bg-background overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                            <th className="py-3 px-3">Nome</th><th className="py-3 px-3">E-mail</th><th className="py-3 px-3 hidden sm:table-cell">Telefone</th>
                            <th className="py-3 px-3 hidden lg:table-cell">Cadastro</th>
                        </tr></thead>
                        <tbody className="divide-y divide-border">
                            {customers.map((u) => {
                                return (
                                    <tr key={u.id} className="hover:bg-[hsl(var(--bone))]/50">
                                        <td className="py-3 px-3 font-medium">{u.full_name || "—"}</td>
                                        <td className="py-3 px-3 text-muted-foreground">{u.email}</td>
                                        <td className="py-3 px-3 hidden sm:table-cell text-muted-foreground font-numeric">{u.phone || "—"}</td>
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
