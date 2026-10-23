import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DollarSign, ShoppingCart, Package, Users } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { base44 } from '@/api/base44Client';
import { formatBRL } from '@/data/products';

export default function Dashboard() {
    const [summary, setSummary] = useState(null);
    const [error, setError] = useState('');
    useEffect(() => {
        base44.custom.launchSummary().then(setSummary)
            .catch(() => setError('Não foi possível consultar os indicadores do novo período.'));
    }, []);

    if (error) return <p role="alert" className="text-destructive p-6">{error}</p>;
    if (!summary) return <div className="h-64 bg-background animate-pulse" />;
    if (!summary.configured) return <div className="bg-background p-8">
        <h1 className="font-heading text-2xl">Dashboard do novo lançamento</h1>
        <p className="mt-4 text-muted-foreground">A data de início operacional ainda não foi definida. Os pedidos históricos permanecem disponíveis em <Link to="/admin/pedidos" className="underline">Pedidos</Link>; nenhum valor será apresentado como zero antes da separação do período.</p>
    </div>;

    const chartData = summary.daily.map(row => ({
        day: new Date(`${row.day}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).slice(0, 3),
        vendas: Number(row.revenue),
    }));

    return <div>
        <h1 className="font-heading text-2xl tracking-[0.03em] mb-2">Dashboard</h1>
        <p className="text-xs text-muted-foreground mb-6">Nova operação desde {new Date(summary.start_at).toLocaleString('pt-BR')} · <Link to="/admin/pedidos" className="underline">Consultar histórico de pedidos</Link></p>
        {!!summary.refund_inconsistencies && <p role="alert" className="text-destructive mb-5">Há reembolsos que excedem o valor de pedidos. Concilie antes de usar os indicadores.</p>}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <KPI icon={DollarSign} label="Faturamento líquido do período" value={formatBRL(summary.net_revenue)} />
            <KPI icon={ShoppingCart} label="Vendas pagas" value={summary.paid_orders} />
            <KPI icon={Package} label="Produtos publicados" value={summary.published_products} />
            <KPI icon={Users} label="Compradores do período" value={summary.buyers} />
        </div>
        <div className="grid lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 bg-background p-6">
                <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Vendas pagas nos últimos 7 dias</h2>
                <ResponsiveContainer width="100%" height={240}><BarChart data={chartData}>
                    <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#999' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#999' }} axisLine={false} tickLine={false} tickFormatter={formatBRL} />
                    <Tooltip formatter={formatBRL} /><Bar dataKey="vendas" fill="hsl(44 69% 54%)" radius={[4, 4, 0, 0]} />
                </BarChart></ResponsiveContainer>
            </div>
            <div className="bg-background p-6 space-y-4">
                <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Conciliação do período</h2>
                <p className="text-sm">Bruto recebido: <strong>{formatBRL(summary.gross_paid)}</strong></p>
                <p className="text-sm">Reembolsos processados: <strong>{formatBRL(summary.refunds)}</strong></p>
                <p className="text-sm">Lucro líquido: <strong>{summary.profit === null ? 'A apurar' : formatBRL(summary.profit)}</strong></p>
                <p className="text-xs text-muted-foreground">{summary.profit_note}</p>
            </div>
        </div>
        <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mt-8 mb-4">Pedidos do novo período</h2>
        <div className="bg-background divide-y divide-border">
            {summary.recent_orders.length ? summary.recent_orders.map(order => <Link key={order.id} to={`/admin/pedidos/${order.id}`} className="flex justify-between p-4 hover:bg-[hsl(var(--bone))]">
                <span className="font-numeric text-sm">{order.order_number}</span><span className="font-numeric text-sm">{formatBRL(order.total)}</span>
            </Link>) : <p className="p-6 text-sm text-muted-foreground">Nenhum pedido desde o início da nova operação.</p>}
        </div>
    </div>;
}

function KPI({ icon: Icon, label, value }) {
    return <div className="bg-background p-5"><Icon className="w-5 h-5 text-[hsl(var(--gold))] mb-3" strokeWidth={1.25} />
        <p className="font-numeric text-2xl font-medium">{value}</p>
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mt-1">{label}</p></div>;
}
