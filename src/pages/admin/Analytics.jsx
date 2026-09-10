import React, { useState, useEffect, useCallback } from "react";
import { Users, Eye, ShoppingCart, TrendingUp, TrendingDown, Package, DollarSign, Percent, Monitor, Smartphone, Tablet, Calendar } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell, LineChart, Line, CartesianGrid } from "recharts";
import { base44 } from "@/api/base44Client";

const COLORS = ['hsl(44 69% 54%)', 'hsl(340 52% 62%)', 'hsl(280 40% 55%)', 'hsl(200 60% 55%)', 'hsl(140 50% 50%)', 'hsl(20 70% 55%)'];

const PERIODS = [
    { key: 'today', label: 'Hoje' },
    { key: 'yesterday', label: 'Ontem' },
    { key: '7d', label: '7 dias' },
    { key: '30d', label: '30 dias' },
    { key: 'this_month', label: 'Este mês' },
    { key: 'last_month', label: 'Mês passado' },
    { key: 'custom', label: 'Personalizado' },
];

const SOURCE_LABELS = {
    google: 'Google', instagram: 'Instagram', facebook: 'Facebook',
    tiktok: 'TikTok', whatsapp: 'WhatsApp', direto: 'Direto',
};

function formatCurrency(v) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
}
function formatNumber(v) {
    return new Intl.NumberFormat('pt-BR').format(v || 0);
}

export default function Analytics() {
    const [period, setPeriod] = useState('7d');
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');
    const [overview, setOverview] = useState(null);
    const [sources, setSources] = useState([]);
    const [devices, setDevices] = useState([]);
    const [pages, setPages] = useState([]);
    const [funnel, setFunnel] = useState([]);
    const [products, setProducts] = useState({ most_viewed: [], most_added_to_cart: [] });
    const [campaigns, setCampaigns] = useState([]);
    const [customers, setCustomers] = useState(null);
    const [geo, setGeo] = useState({ top_cities: [], top_states: [], top_countries: [] });
    const [loading, setLoading] = useState(true);

    const fetchData = useCallback(async () => {
        if (period === 'custom' && (!customStart || !customEnd)) return;
        setLoading(true);
        try {
            const params = period === 'custom'
                ? { period: 'custom', start: customStart, end: customEnd }
                : { period };

            const [ov, src, dev, pg, fn, pr, cmp, cust, g] = await Promise.all([
                base44.custom.analyticsOverview(params).catch(() => null),
                base44.custom.analyticsSources(params).catch(() => []),
                base44.custom.analyticsDevices(params).catch(() => []),
                base44.custom.analyticsPages(params).catch(() => []),
                base44.custom.analyticsFunnel(params).catch(() => []),
                base44.custom.analyticsProducts(params).catch(() => ({ most_viewed: [], most_added_to_cart: [] })),
                base44.custom.analyticsCampaigns(params).catch(() => []),
                base44.custom.analyticsCustomers(params).catch(() => null),
                base44.custom.analyticsGeo(params).catch(() => ({ top_cities: [], top_states: [], top_countries: [] })),
            ]);
            setOverview(ov);
            setSources(src || []);
            setDevices(dev || []);
            setPages(pg || []);
            setFunnel(fn || []);
            setProducts(pr || { most_viewed: [], most_added_to_cart: [] });
            setCampaigns(cmp || []);
            setCustomers(cust);
            setGeo(g || { top_cities: [], top_states: [], top_countries: [] });
        } catch (e) {
            console.error('Analytics error:', e);
        } finally {
            setLoading(false);
        }
    }, [period, customStart, customEnd]);

    useEffect(() => { fetchData(); }, [fetchData]);

    if (loading) return <div className="h-64 bg-background animate-pulse rounded-lg" />;

    if (!overview || (overview.visitors === 0 && overview.sessions === 0 && overview.orders === 0)) {
        return (
            <div>
                <h1 className="font-heading text-2xl tracking-[0.03em] mb-6">Analytics</h1>
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                        <TrendingUp className="w-8 h-8 text-muted-foreground" strokeWidth={1.5} />
                    </div>
                    <p className="text-sm font-medium text-foreground">Sem dados de analytics ainda</p>
                    <p className="text-xs text-muted-foreground mt-1">Os dados de visitantes e pedidos aparecerão aqui conforme a loja receber tráfego.</p>
                </div>
            </div>
        );
    }

    const cmp = overview?.comparison || {};

    // KPI cards data
    const kpiCards = [
        { icon: Users, label: 'Visitantes', value: formatNumber(overview?.visitors || 0), change: cmp.visitors?.change },
        { icon: Eye, label: 'Sessões', value: formatNumber(overview?.sessions || 0), change: cmp.sessions?.change },
        { icon: Eye, label: 'Page Views', value: formatNumber(overview?.page_views || 0), change: cmp.page_views?.change },
        { icon: Users, label: 'Clientes Novos', value: formatNumber(overview?.new_signups || 0), change: cmp.new_signups?.change },
        { icon: ShoppingCart, label: 'Add. Carrinho', value: formatNumber(overview?.cart_adds || 0), change: cmp.cart_adds?.change },
        { icon: Package, label: 'Checkouts', value: formatNumber(overview?.checkouts_started || 0), change: cmp.checkouts?.change },
        { icon: Package, label: 'Pedidos', value: formatNumber(overview?.orders || 0), change: cmp.orders?.change },
        { icon: DollarSign, label: 'Receita', value: formatCurrency(overview?.revenue || 0), change: cmp.revenue?.change },
        { icon: Percent, label: 'Conversão', value: `${overview?.conversion_rate || '0.00'}%` },
    ];

    // Devices
    const deviceCounts = devices.reduce((acc, d) => { acc[d.device_type] = (acc[d.device_type] || 0) + parseInt(d.visitors); return acc; }, {});
    const deviceData = [
        { name: 'Desktop', value: deviceCounts.desktop || 0, icon: Monitor },
        { name: 'Mobile', value: deviceCounts.mobile || 0, icon: Smartphone },
        { name: 'Tablet', value: deviceCounts.tablet || 0, icon: Tablet },
    ].filter(d => d.value > 0);

    // Browsers
    const browserCounts = devices.reduce((acc, d) => { acc[d.browser] = (acc[d.browser] || 0) + parseInt(d.visitors); return acc; }, {});
    const browserData = Object.entries(browserCounts).map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value }));

    // Funnel
    const funnelLabels = {
        page_view: 'Visitou o site', product_view: 'Visualizou produto', add_to_cart: 'Adicionou à sacola',
        begin_checkout: 'Iniciou checkout', sign_up: 'Criou/entrou na conta', order_created: 'Criou pedido',
    };
    const funnelData = funnel.map(f => ({ name: funnelLabels[f.event_name] || f.event_name, users: parseInt(f.unique_users) }));
    const funnelTop = funnelData[0]?.users || 1;

    // Source classification
    const sourceData = sources.map(s => ({
        ...s,
        label: SOURCE_LABELS[s.source?.toLowerCase()] || (s.source ? s.source.charAt(0).toUpperCase() + s.source.slice(1) : 'Direto'),
    }));

    // Customer growth chart
    const growthData = (customers?.growth || []).map(g => ({
        date: new Date(g.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        customers: parseInt(g.new_customers),
    }));

    return (
        <div>
            {/* Header + Period filters */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <h1 className="font-heading text-2xl tracking-[0.03em]">Analytics</h1>
                <div className="flex flex-wrap gap-1">
                    {PERIODS.map(p => (
                        <button
                            key={p.key}
                            onClick={() => setPeriod(p.key)}
                            className={`px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] border transition-colors rounded ${
                                period === p.key
                                    ? "border-accent bg-accent text-accent-foreground font-medium"
                                    : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                            }`}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Custom date pickers */}
            {period === 'custom' && (
                <div className="flex items-center gap-3 mb-6 p-3 bg-background border border-border rounded-lg">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="px-3 py-1.5 text-sm bg-transparent border border-border rounded focus:outline-none focus:border-accent" />
                    <span className="text-muted-foreground">até</span>
                    <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="px-3 py-1.5 text-sm bg-transparent border border-border rounded focus:outline-none focus:border-accent" />
                    <button onClick={fetchData} disabled={!customStart || !customEnd} className="btn-gold text-xs ml-2">Aplicar</button>
                </div>
            )}

            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
                {kpiCards.map((kpi, i) => (
                    <KPICard key={i} {...kpi} />
                ))}
            </div>

            {/* Funnel + Sources */}
            <div className="grid lg:grid-cols-2 gap-4 mb-6">
                {/* Funnel */}
                <div className="bg-background border border-border rounded-lg p-5">
                    <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Funil de Conversão</h2>
                    {funnelData.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-8 text-center">Sem dados suficientes.</p>
                    ) : (
                        <div className="space-y-3">
                            {funnelData.map((f, i) => {
                                const pct = funnelTop > 0 ? ((f.users / funnelTop) * 100).toFixed(1) : 0;
                                const dropoff = i > 0 && funnelData[i-1].users > 0
                                    ? (((funnelData[i-1].users - f.users) / funnelData[i-1].users) * 100).toFixed(1)
                                    : null;
                                return (
                                    <div key={f.name}>
                                        <div className="flex justify-between text-sm mb-1">
                                            <span className="text-foreground/80">{f.name}</span>
                                            <span className="font-numeric text-muted-foreground">{formatNumber(f.users)} ({pct}%)</span>
                                        </div>
                                        <div className="h-3 bg-muted rounded-full overflow-hidden">
                                            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: COLORS[i % COLORS.length] }} />
                                        </div>
                                        {dropoff && parseFloat(dropoff) > 0 && (
                                            <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                                                <TrendingDown className="w-3 h-3" /> {dropoff}% de queda
                                            </p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Traffic Sources */}
                <div className="bg-background border border-border rounded-lg p-5">
                    <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Origem do Tráfego</h2>
                    {sourceData.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-8 text-center">Sem dados.</p>
                    ) : (
                        <div className="space-y-2">
                            {sourceData.map((s, i) => {
                                const total = sourceData.reduce((sum, x) => sum + parseInt(x.visitors), 0) || 1;
                                const pct = ((parseInt(s.visitors) / total) * 100).toFixed(1);
                                return (
                                    <div key={i}>
                                        <div className="flex justify-between text-sm mb-1">
                                            <span className="text-foreground/80">{s.label}</span>
                                            <span className="font-numeric text-muted-foreground">{formatNumber(s.visitors)} ({pct}%)</span>
                                        </div>
                                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                                            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: COLORS[i % COLORS.length] }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Campaigns */}
            {campaigns.length > 0 && (
                <div className="bg-background border border-border rounded-lg p-5 mb-6">
                    <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Desempenho por Campanha</h2>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left border-b border-border text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                                    <th className="py-2 pr-4 font-medium">Campanha</th>
                                    <th className="py-2 px-4 font-medium">Origem</th>
                                    <th className="py-2 px-4 font-medium text-right">Sessões</th>
                                    <th className="py-2 px-4 font-medium text-right">Carrinhos</th>
                                    <th className="py-2 px-4 font-medium text-right">Checkouts</th>
                                    <th className="py-2 px-4 font-medium text-right">Pedidos</th>
                                    <th className="py-2 px-4 font-medium text-right">Receita</th>
                                    <th className="py-2 pl-4 font-medium text-right">Conv.</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {campaigns.map((c, i) => (
                                    <tr key={i} className="hover:bg-muted/30 transition-colors">
                                        <td className="py-2.5 pr-4 text-xs font-medium truncate max-w-[200px]">{c.campaign}</td>
                                        <td className="py-2.5 px-4 text-xs">{SOURCE_LABELS[c.source?.toLowerCase()] || c.source}</td>
                                        <td className="py-2.5 px-4 text-xs font-numeric text-right">{formatNumber(c.sessions)}</td>
                                        <td className="py-2.5 px-4 text-xs font-numeric text-right">{c.add_to_cart}</td>
                                        <td className="py-2.5 px-4 text-xs font-numeric text-right">{c.checkouts}</td>
                                        <td className="py-2.5 px-4 text-xs font-numeric text-right">{c.orders}</td>
                                        <td className="py-2.5 px-4 text-xs font-numeric text-right">{formatCurrency(c.revenue)}</td>
                                        <td className="py-2.5 pl-4 text-xs font-numeric text-right">{c.conversion}%</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Pages + Products */}
            <div className="grid lg:grid-cols-2 gap-4 mb-6">
                <div className="bg-background border border-border rounded-lg p-5">
                    <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Páginas Mais Visitadas</h2>
                    {pages.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-8 text-center">Sem dados.</p>
                    ) : (
                        <div className="space-y-2">
                            {pages.map((p, i) => (
                                <div key={i} className="flex justify-between text-sm items-center">
                                    <span className="text-foreground/80 truncate mr-2">{p.page || '/'}</span>
                                    <span className="font-numeric text-muted-foreground text-xs whitespace-nowrap">{formatNumber(p.views)} views · {formatNumber(p.unique_visitors)} únicos</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="bg-background border border-border rounded-lg p-5">
                    <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Produtos Populares</h2>
                    {products.most_viewed.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-8 text-center">Sem dados.</p>
                    ) : (
                        <div className="space-y-2">
                            {products.most_viewed.map((p, i) => (
                                <div key={i} className="flex justify-between text-sm items-center">
                                    <span className="text-foreground/80 truncate mr-2">{p.name || '—'}</span>
                                    <span className="font-numeric text-muted-foreground text-xs">{formatNumber(p.views)} views</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Customers */}
            {customers && (
                <div className="bg-background border border-border rounded-lg p-5 mb-6">
                    <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Clientes</h2>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-4">
                        <MiniStat label="Total" value={formatNumber(customers.total_customers)} />
                        <MiniStat label="Novos no período" value={formatNumber(customers.new_in_period)} />
                        <MiniStat label="Recorrentes" value={formatNumber(customers.recurring_customers)} />
                        <MiniStat label="Compradores" value={formatNumber(customers.buyers_in_period)} />
                        <MiniStat label="Sem compra" value={formatNumber(customers.non_buyers)} />
                        <MiniStat label="Ticket médio" value={formatCurrency(customers.avg_ticket)} />
                    </div>
                    {growthData.length > 0 && (
                        <ResponsiveContainer width="100%" height={180}>
                            <LineChart data={growthData}>
                                <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                                <Tooltip contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} />
                                <Line type="monotone" dataKey="customers" stroke="hsl(var(--accent))" strokeWidth={2} dot={{ r: 3 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    )}
                </div>
            )}

            {/* Devices + Browsers */}
            <div className="grid lg:grid-cols-2 gap-4">
                <div className="bg-background border border-border rounded-lg p-5">
                    <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Dispositivos</h2>
                    {deviceData.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-8 text-center">Sem dados.</p>
                    ) : (
                        <div className="flex items-center gap-4">
                            <ResponsiveContainer width={120} height={120}>
                                <PieChart>
                                    <Pie data={deviceData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={30} outerRadius={50}>
                                        {deviceData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                                    </Pie>
                                    <Tooltip contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="space-y-2 flex-1">
                                {deviceData.map((d, i) => (
                                    <div key={d.name} className="flex items-center gap-2 text-sm">
                                        <span className="w-3 h-3 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                                        <d.icon className="w-3.5 h-3.5 text-muted-foreground" />
                                        <span className="flex-1">{d.name}</span>
                                        <span className="font-numeric text-muted-foreground">{formatNumber(d.value)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="bg-background border border-border rounded-lg p-5">
                    <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Browsers</h2>
                    {browserData.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-8 text-center">Sem dados.</p>
                    ) : (
                        <ResponsiveContainer width="100%" height={140}>
                            <BarChart data={browserData}>
                                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                                <Tooltip contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} cursor={{ fill: 'hsl(var(--muted))' }} />
                                <Bar dataKey="value" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </div>
        </div>
    );
}

function KPICard({ icon: Icon, label, value, change }) {
    const isPositive = change && parseFloat(change) >= 0;
    return (
        <div className="bg-background border border-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
                <Icon className="w-4 h-4 text-[hsl(var(--gold))]" strokeWidth={1.25} />
                {change && (
                    <span className={`text-[10px] font-medium flex items-center gap-0.5 ${isPositive ? 'text-accent' : 'text-destructive'}`}>
                        {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {isPositive ? '+' : ''}{change}%
                    </span>
                )}
            </div>
            <p className="font-numeric text-xl font-medium">{value}</p>
            <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mt-0.5">{label}</p>
        </div>
    );
}

function MiniStat({ label, value }) {
    return (
        <div className="p-3 bg-muted/30 rounded-lg">
            <p className="font-numeric text-lg font-medium">{value}</p>
            <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mt-0.5">{label}</p>
        </div>
    );
}
