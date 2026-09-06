import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Truck, Check, Loader2, Copy } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { formatBRL, ORDER_STATUS, PAYMENT_LABELS, SHIPPING_LABELS } from "@/data/products";

const STATUS_OPTIONS = Object.entries(ORDER_STATUS).map(([key, v]) => ({ value: key, label: v.label }));

export default function AdminOrderDetail() {
    const { id } = useParams();
    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [tracking, setTracking] = useState({ carrier: "", code: "", posted_date: "", link: "" });

    const load = () => {
        setLoading(true);
        base44.entities.Order.get(id)
            .then((o) => {
                setOrder(o);
                setTracking({
                    carrier: o.tracking_carrier || "",
                    code: o.tracking_code || "",
                    posted_date: o.tracking_posted_date ? o.tracking_posted_date.slice(0, 10) : "",
                    link: o.tracking_link || "",
                });
            })
            .catch(() => setOrder(null))
            .finally(() => setLoading(false));
    };

    useEffect(() => { load(); }, [id]);

    const changeStatus = async (newStatus) => {
        setSaving(true);
        try {
            await base44.functions.invoke('updateOrderStatus', { orderId: id, status: newStatus });
            load();
        } catch (e) {
            console.error("Erro ao atualizar status:", e.response?.data?.error || e.message || "");
        } finally {
            setSaving(false);
        }
    };

    const copyAddress = () => {
        const a = order.address || {};
        const text = `${a.street || ""}, ${a.number || ""}${a.complement ? ` - ${a.complement}` : ""}\n${a.district || ""}\n${a.city || ""} - ${a.state || ""}\nCEP ${a.cep || ""}`;
        navigator.clipboard?.writeText(text);
    };

    const saveTracking = async (markShipped) => {
        setSaving(true);
        try {
            await base44.functions.invoke('updateOrderStatus', {
                orderId: id,
                tracking: {
                    carrier: tracking.carrier,
                    code: tracking.code,
                    posted_date: tracking.posted_date || null,
                    link: tracking.link,
                    markShipped,
                },
            });
            load();
        } catch (e) {
            console.error("Erro ao salvar rastreamento");
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="h-64 bg-background animate-pulse" />;
    if (!order) return <div className="text-center py-12"><p className="text-muted-foreground">Pedido não encontrado.</p><Link to="/admin/pedidos" className="btn-outline mt-4 inline-flex">Voltar</Link></div>;

    return (
        <div>
            <Link to="/admin/pedidos" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
                <ArrowLeft className="w-4 h-4" strokeWidth={1.5} /> Pedidos
            </Link>

            <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
                <div>
                    <h1 className="font-heading text-2xl tracking-[0.03em]">{order.order_number}</h1>
                    <p className="text-sm text-muted-foreground mt-1">{new Date(order.created_date).toLocaleString("pt-BR")}</p>
                </div>
                <div className="flex items-center gap-2">
                    <select value={order.status} onChange={(e) => changeStatus(e.target.value)} disabled={saving} className="border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:border-[hsl(var(--gold))]" >
                        {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                </div>
            </div>

            <div className="grid lg:grid-cols-3 gap-5">
                {/* left: items + summary */}
                <div className="lg:col-span-2 space-y-5">
                    <div className="bg-background p-5">
                        <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Produtos</h2>
                        <div className="space-y-3">
                            {(order.items || []).map((item, i) => (
                                <div key={i} className="flex gap-3">
                                    <img src={item.image} alt="" className="w-14 h-18 object-cover bg-bone" style={{ height: "72px" }} />
                                    <div className="flex-1 text-sm">
                                        <p className="font-medium">{item.product_name}</p>
                                        <p className="text-[11px] text-muted-foreground">{item.color_name} · Tam {item.size} · {item.qty}x</p>
                                        <p className="text-sm mt-1">{formatBRL(item.price * item.qty)}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="pt-4 mt-4 border-t border-border space-y-2 text-sm">
                            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatBRL(order.subtotal)}</span></div>
                            {order.discount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Cupom ({order.coupon_code})</span><span>- {formatBRL(order.discount)}</span></div>}
                            <div className="flex justify-between"><span className="text-muted-foreground">Frete</span><span>{order.shipping_cost === 0 ? "Grátis" : formatBRL(order.shipping_cost)}</span></div>
                            <div className="flex justify-between pt-2 border-t border-border text-base font-medium"><span>Total</span><span>{formatBRL(order.total)}</span></div>
                        </div>
                    </div>

                    {/* tracking */}
                    <div className="bg-background p-5">
                        <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4 flex items-center gap-2"><Truck className="w-4 h-4" strokeWidth={1.5} /> Dados de envio</h2>
                        <div className="grid sm:grid-cols-2 gap-3">
                            <TInput label="Transportadora" value={tracking.carrier} onChange={(v) => setTracking((t) => ({ ...t, carrier: v }))} />
                            <TInput label="Código de rastreamento" value={tracking.code} onChange={(v) => setTracking((t) => ({ ...t, code: v }))} />
                            <TInput label="Data de postagem" type="date" value={tracking.posted_date} onChange={(v) => setTracking((t) => ({ ...t, posted_date: v }))} />
                            <TInput label="Link de rastreamento (opcional)" value={tracking.link} onChange={(v) => setTracking((t) => ({ ...t, link: v }))} />
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2 mt-4">
                            <button onClick={() => saveTracking(false)} disabled={saving} className="btn-outline flex-1 text-sm">
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar rastreamento"}
                            </button>
                            <button onClick={() => saveTracking(true)} disabled={saving} className="btn-gold flex-1 text-sm">
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4" strokeWidth={1.5} /> Marcar como enviado</>}
                            </button>
                        </div>
                    </div>

                    {/* status history */}
                    {order.status_history && order.status_history.length > 0 && (
                        <div className="bg-background p-5">
                            <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Histórico de status</h2>
                            <div className="space-y-2">
                                {order.status_history.map((h, i) => (
                                    <div key={i} className="flex items-center gap-3 text-sm">
                                        <div className="w-2 h-2 rounded-full bg-[hsl(var(--gold))]" />
                                        <span className="font-medium">{ORDER_STATUS[h.status]?.label || h.status}</span>
                                        <span className="text-muted-foreground text-xs ml-auto">{new Date(h.date).toLocaleString("pt-BR")}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* right: customer + address */}
                <div className="space-y-5">
                    <div className="bg-background p-5">
                        <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-3">Cliente</h2>
                        <div className="space-y-1.5 text-sm">
                            <p className="font-medium">{order.customer_name}</p>
                            <p className="text-muted-foreground">{order.customer_email}</p>
                            <p className="text-muted-foreground">{order.customer_phone}</p>
                            <p className="text-muted-foreground">CPF: {order.customer_cpf || "—"}</p>
                        </div>
                    </div>
                    <div className="bg-background p-5">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Endereço de entrega</h2>
                            <button onClick={copyAddress} className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground hover:text-[hsl(var(--gold))] transition-colors">
                                <Copy className="w-3.5 h-3.5" strokeWidth={1.5} /> Copiar
                            </button>
                        </div>
                        <div className="text-sm leading-relaxed">
                            <p>{order.address?.street}, {order.address?.number}{order.address?.complement ? ` - ${order.address.complement}` : ""}</p>
                            <p>{order.address?.district}</p>
                            <p>{order.address?.city}/{order.address?.state}</p>
                            <p className="text-muted-foreground">CEP {order.address?.cep}</p>
                        </div>
                    </div>
                    <div className="bg-background p-5">
                        <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-3">Pagamento e entrega</h2>
                        <div className="space-y-1.5 text-sm">
                            <p><span className="text-muted-foreground">Pagamento:</span> {PAYMENT_LABELS[order.payment_method] || order.payment_method || "—"}</p>
                            <p><span className="text-muted-foreground">Entrega:</span> {SHIPPING_LABELS[order.shipping_method] || order.shipping_method || "—"}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function TInput({ label, value, onChange, type = "text" }) {
    return (
        <div>
            <label className="block text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-1.5">{label}</label>
            <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:border-[hsl(var(--gold))]" />
        </div>
    );
}