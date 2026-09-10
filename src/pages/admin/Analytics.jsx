import React, { useState, useEffect, useCallback } from "react";
import { Users, Eye, ShoppingCart, TrendingUp, Monitor, Smartphone, Tablet } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell } from "recharts";
import { base44 } from "@/api/base44Client";

const COLORS = ['hsl(44 69% 54%)', 'hsl(340 52% 62%)', 'hsl(280 40% 55%)', 'hsl(200 60% 55%)', 'hsl(140 50% 50%)'];

const PERIODS = [
    { key: 'today', label: 'Hoje' },
    { key: 'yesterday', label: 'Ontem' },
    { key: '7d', label: '7 dias' },
    { key: '30d', label: '30 dias' },
    { key: 'this_month', label: 'Este mês' },
];

export default function Analytics() {
    const [period, setPeriod] = useState('7d');
    const [overview, setOverview] = useState(null);
    const [sources, setSources] = useState([]);
    const [devices, setDevices] = useState([]);
    const [pages, setPages] = useState([]);
    const [funnel, setFunnel] = useState([]);
    const [products, setProducts] = useState({ most_viewed: [], most_added_to_cart: [] });
    const [loading, setLoading] = useState(true);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [ov, src, dev, pg, fn, pr] = await Promise.all([
                base44.custom.analyticsOverview({ period }).catch(() => null),
                base44.custom.analyticsSources({ period }).catch(() => []),
                base44.custom.analyticsDevices({ period }).catch(() => []),
                base44.custom.analyticsPages({ period }).catch(() => []),
                base44.custom.analyticsFunnel({ period }).catch(() => []),
                base44.custom.analyticsProducts({ period }).catch(() => ({ most_viewed: [], most_added_to_cart: [] })),
            ]);
            setOverview(ov);
            setSources(src || []);
            setDevices(dev || []);
            setPages(pg || []);
            setFunnel(fn || []);
            setProducts(pr || { most_viewed: [], most_added_to_cart: [] });
        } catch (e) {
            console.error('Analytics error:', e);
        } finally {
            setLoading(false);
        }
    }, [period]);

    useEffect(() => { fetchData(); }, [fetchData]);

    if (loading) return <div className="h-64 bg-background animate-pulse" />;

    // Aggregate devices
    const deviceCounts = devices.reduce((acc, d) => {
        acc[d.device_type] = (acc[d.device_type] || 0) + parseInt(d.visitors);
        return acc;
    }, {});
    const deviceData = [
        { name: 'Desktop', value: deviceCounts.desktop || 0, icon: Monitor },
        { name: 'Mobile', value: deviceCounts.mobile || 0, icon: Smartphone },
        { name: 'Tablet', value: deviceCounts.tablet || 0, icon: Tablet },
    ].filter(d => d.value > 0);

    // Browser aggregation
    const browserCounts = devices.reduce((acc, d) => {
        acc[d.browser] = (acc[d.browser] || 0) + parseInt(d.visitors);
        return acc;
    }, {});
    const browserData = Object.entries(browserCounts).map(([name, value]) => ({ name, value }));

    // Funnel data
    const funnelLabels = {
        page_view: 'Visitou loja',
        product_view: 'Visualizou produto',
        add_to_cart: 'Adicionou à sacola',
        begin_checkout: 'Iniciou checkout',
        sign_up: 'Login/Cadastro',
        order_created: 'Pedido criado',
    };
    const funnelData = funnel.map(f => ({
        name: funnelLabels[f.event_name] || f.event_name,
        users: parseInt(f.unique_users),
    }));
    const funnelTop = funnelData[0]?.users || 1;

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="font-heading text-2xl tracking-[0.03em]">Analytics</h1>
                <div className="flex gap-1">
                    {PERIODS.map(p => (
                        <button
                            key={p.key}
                            onClick={() => setPeriod(p.key)}
                            className={`px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] border transition-colors ${
                                period === p.key ? "border-foreground bg-foreground text-white" : "border-border text-foreground/60 hover:border-foreground"
                            }`}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
                <KPI icon={Users} label="Visitantes" value={overview?.visitors_today || 0} />
                <KPI icon={Eye} label="Sessões" value={overview?.sessions || 0} />
                <KPI icon={Eye} label="Page Views" value={overview?.page_views || 0} />
                <KPI icon={ShoppingCart} label="Carrinho" value={overview?.cart_adds || 0} />
                <KPI icon={TrendingUp} label="Conversão" value={`${overview?.conversion_rate || '0.00'}%`} />
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
                <MiniKPI label="Cadastros" value={overview?.new_signups || 0} />
                <MiniKPI label="Produtos vistos" value={overview?.product_views || 0} />
                <MiniKPI label="Checkouts" value={overview?.checkouts_started || 0} />
                <MiniKPI label="Pedidos" value={overview?.orders || 0} />
            </div>

            <div className="grid lg:grid-cols-2 gap-5 mb-6">
                {/* Funnel */}
                <div className="bg-background p-6">
                    <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Funil de conversão</h2>
                    {funnelData.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Sem dados suficientes.</p>
                    ) : (
                        <div className="space-y-2">
                            {funnelData.map((f, i) => {
                                const pct = funnelTop > 0 ? ((f.users / funnelTop) * 100).toFixed(1) : 0;
                                const prevPct = i > 0 ? ((funnelData[i-1].users / funnelTop) * 100).toFixed(1) : 100;
                                const dropoff = i > 0 ? (((funnelData[i-1].users - f.users) / funnelData[i-1].users) * 100).toFixed(1) : null;
                                return (
                                    <div key={f.name}>
                                        <div className="flex justify-between text-sm mb-1">
                                            <span className="text-foreground/80">{f.name}</span>
                                            <span className="font-numeric">{f.users} ({pct}%)</span>
                                        </div>
                                        <div className="h-2 bg-[hsl(var(--bone))] rounded-full overflow-hidden">
                                            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: COLORS[i % COLORS.length] }} />
                                        </div>
                                        {dropoff && parseFloat(dropoff) > 0 && (
                                            <p className="text-[10px] text-muted-foreground mt-0.5">↓ {dropoff}% de queda</p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Sources */}
                <div className="bg-background p-6">
                    <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Origem dos acessos</h2>
                    {sources.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Sem dados.</p>
                    ) : (
                        <div className="space-y-2">
                            {sources.map((s, i) => (
                                <div key={i} className="flex justify-between text-sm">
                                    <span className="capitalize text-foreground/80">{s.source}</span>
                                    <span className="font-numeric">{s.visitors}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-5 mb-6">
                {/* Devices */}
                <div className="bg-background p-6">
                    <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Dispositivos</h2>
                    {deviceData.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Sem dados.</p>
                    ) : (
                        <div className="flex items-center gap-6">
                            <ResponsiveContainer width={160} height={160}>
                                <PieChart>
                                    <Pie data={deviceData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={70}>
                                        {deviceData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                                    </Pie>
                                    <Tooltip />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="space-y-2">
                                {deviceData.map((d, i) => (
                                    <div key={d.name} className="flex items-center gap-2 text-sm">
                                        <span className="w-3 h-3 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                                        {d.name}: <span className="font-numeric">{d.value}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Browsers */}
                <div className="bg-background p-6">
                    <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Browsers</h2>
                    {browserData.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Sem dados.</p>
                    ) : (
                        <ResponsiveContainer width="100%" height={160}>
                            <BarChart data={browserData}>
                                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#999" }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 11, fill: "#999" }} axisLine={false} tickLine={false} />
                                <Tooltip />
                                <Bar dataKey="value" fill="hsl(44 69% 54%)" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-5">
                {/* Top pages */}
                <div className="bg-background p-6">
                    <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Páginas mais visitadas</h2>
                    {pages.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Sem dados.</p>
                    ) : (
                        <div className="space-y-2">
                            {pages.map((p, i) => (
                                <div key={i} className="flex justify-between text-sm">
                                    <span className="text-foreground/80 truncate max-w-[70%]">{p.page || '/'}</span>
                                    <span className="font-numeric">{p.views} views</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Top products */}
                <div className="bg-background p-6">
                    <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Produtos populares</h2>
                    {products.most_viewed.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Sem dados.</p>
                    ) : (
                        <div className="space-y-2">
                            {products.most_viewed.map((p, i) => (
                                <div key={i} className="flex justify-between text-sm">
                                    <span className="text-foreground/80 truncate max-w-[60%]">{p.name || '—'}</span>
                                    <span className="font-numeric">{p.views} views</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function KPI({ icon: Icon, label, value }) {
    return (
        <div className="bg-background p-4">
            <Icon className="w-4 h-4 text-[hsl(var(--gold))] mb-2" strokeWidth={1.25} />
            <p className="font-numeric text-xl font-medium">{value}</p>
            <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mt-0.5">{label}</p>
        </div>
    );
}

function MiniKPI({ label, value }) {
    return (
        <div className="bg-background/50 p-3">
            <p className="font-numeric text-lg">{value}</p>
            <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
        </div>
    );
}
