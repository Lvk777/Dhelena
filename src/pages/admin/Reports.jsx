import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart as RechartsBarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell, Legend } from 'recharts';
import { base44 } from '@/api/base44Client';
import { formatBRL } from '@/data/products';

const STATUS_COLORS = ['hsl(44 69% 54%)', 'hsl(352 50% 70%)', 'hsl(200 50% 60%)', 'hsl(150 50% 50%)', 'hsl(0 62% 50%)'];

export default function Reports() {
    const [summary, setSummary] = useState(null);
    const [error, setError] = useState('');
    useEffect(() => {
        base44.custom.launchSummary().then(setSummary)
            .catch(() => setError('Não foi possível carregar os relatórios do novo período.'));
    }, []);
    if (error) return <p role="alert" className="text-destructive p-6">{error}</p>;
    if (!summary) return <div className="h-64 bg-background animate-pulse" />;
    if (!summary.configured) return <div className="bg-background p-8">
        <h1 className="font-heading text-2xl">Relatórios</h1>
        <p className="text-muted-foreground mt-4">A data de início operacional ainda não foi definida. <Link to="/admin/pedidos" className="underline">O histórico de pedidos</Link> continua disponível.</p>
    </div>;

    const monthData = summary.monthly.map(row => ({ month: `${row.month.slice(5)}/${row.month.slice(2, 4)}`,
        vendas: Number(row.revenue) }));
    const statusData = summary.statuses.map(row => ({ name: row.status, value: row.count }));
    return <div>
        <h1 className="font-heading text-2xl tracking-[0.03em] mb-2">Relatórios</h1>
        <p className="text-xs text-muted-foreground mb-6">Nova operação desde {new Date(summary.start_at).toLocaleString('pt-BR')} · <Link to="/admin/pedidos" className="underline">Histórico completo</Link></p>
        {!!summary.refund_inconsistencies && <p role="alert" className="text-destructive mb-5">Há divergência nos reembolsos. Concilie antes de usar os resultados.</p>}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <Stat label="Faturamento líquido" value={formatBRL(summary.net_revenue)} />
            <Stat label="Pedidos criados" value={summary.orders} />
            <Stat label="Vendas pagas" value={summary.paid_orders} />
            <Stat label="Ticket médio pago" value={formatBRL(summary.average_paid_order)} />
            <Stat label="Reembolsos processados" value={formatBRL(summary.refunds)} />
            <Stat label="Lucro líquido" value={summary.profit === null ? 'A apurar' : formatBRL(summary.profit)} />
        </div>
        <p className="text-xs text-muted-foreground mb-6">{summary.profit_note}</p>
        {summary.orders === 0 ? <div className="bg-background p-12 text-center text-sm text-muted-foreground">Nenhum pedido na nova operação. Os relatórios serão preenchidos após as primeiras vendas.</div> : <>
            <div className="grid lg:grid-cols-2 gap-5 mb-5">
                <div className="bg-background p-6"><h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Faturamento líquido por mês</h2>
                    <ResponsiveContainer width="100%" height={250}><RechartsBarChart data={monthData}>
                        <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#999' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: '#999' }} axisLine={false} tickLine={false} tickFormatter={formatBRL} />
                        <Tooltip formatter={formatBRL} /><Bar dataKey="vendas" fill="hsl(44 69% 54%)" radius={[4, 4, 0, 0]} />
                    </RechartsBarChart></ResponsiveContainer>
                </div>
                <div className="bg-background p-6"><h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Pedidos por status</h2>
                    <ResponsiveContainer width="100%" height={250}><PieChart><Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                        {statusData.map((_, i) => <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />)}
                    </Pie><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart></ResponsiveContainer>
                </div>
            </div>
            <div className="bg-background p-6"><h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Produtos vendidos · valor bruto dos itens</h2>
                {summary.top_products.length ? summary.top_products.map((product, i) => <div key={product.name} className="flex justify-between py-2 border-b border-border last:border-0 text-sm">
                    <span><span className="text-muted-foreground mr-3 font-numeric">{i + 1}.</span>{product.name}</span><span className="font-numeric">{formatBRL(product.gross_sales)}</span>
                </div>) : <p className="text-sm text-muted-foreground">Ainda não há produtos vendidos no período.</p>}
            </div>
        </>}
    </div>;
}

function Stat({ label, value }) {
    return <div className="bg-background p-5"><p className="font-numeric text-2xl font-medium">{value}</p>
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mt-1">{label}</p></div>;
}
