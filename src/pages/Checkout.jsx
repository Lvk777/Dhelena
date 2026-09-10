import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Check, CreditCard, QrCode, Banknote, Loader2 } from "lucide-react";
import { useStore } from "@/context/StoreContext";
import { useCatalog } from "@/context/CatalogContext";
import { useAuth } from "@/lib/AuthContext";
import { usePublicSettings } from "@/context/PublicSettingsContext";
import { base44 } from "@/api/base44Client";
import { COLOR_SWATCHES, formatBRL } from "@/data/products";
import AddressFields from "@/components/AddressFields";
import { validateCPF, validateEmail, validatePhone, validateCEP, maskCPF, maskPhone } from "@/lib/forms";
import { track } from "@/lib/analytics";

const STEPS = ["Dados pessoais", "Endereço", "Entrega", "Pagamento", "Confirmação"];

export default function Checkout() {
    const { cart, clearCart, couponCode, couponResult } = useStore();
    const { products } = useCatalog();
    const { user } = useAuth();
    const { isFreeShipping } = usePublicSettings();
    const [step, setStep] = useState(0);
    // Idempotência: gerada uma vez por montagem do componente — cliques repetidos não criam pedidos duplicados
    const [idempotencyKey] = useState(() => 'dh_' + Date.now() + '_' + Math.random().toString(36).slice(2));
    const [form, setForm] = useState({
        nome: "", cpf: "", email: "", telefone: "",
        cep: "", street: "", number: "", complement: "", district: "", city: "", state: "SP",
        entrega: "padrao", pagamento: "pix",
    });
    const [done, setDone] = useState(false);
    const [orderNo, setOrderNo] = useState("");
    const [placing, setPlacing] = useState(false);
    const [errors, setErrors] = useState({});
    const [orderError, setOrderError] = useState("");

    // Track checkout start
    useEffect(() => { track('begin_checkout'); }, []);

    useEffect(() => {
        if (user) {
            setForm((f) => ({
                ...f,
                nome: f.nome || user.full_name || "",
                email: f.email || user.email || "",
                telefone: f.telefone || user.phone || "",
                cpf: f.cpf || user.cpf || "",
            }));
        }
    }, [user]);

    const lines = cart.map((i) => ({ ...i, product: products.find((p) => p.id === i.productId) })).filter((l) => l.product);
    const subtotal = lines.reduce((s, l) => s + (l.product.salePrice || l.product.price) * l.qty, 0);
    const couponDiscount = couponResult?.valid ? (couponResult.discount || 0) : 0;
    const freeShippingFromCoupon = couponResult?.valid && couponResult.freeShipping;
    const shipping = form.entrega === "retirada" ? 0 : form.entrega === "expressa" ? 49.9 : (freeShippingFromCoupon || isFreeShipping(subtotal) ? 0 : 29.9);
    const total = subtotal - couponDiscount + shipping;

    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

    const validateStep = (s) => {
        const e = {};
        if (s === 0) {
            if (!form.nome.trim()) e.nome = "Informe seu nome completo";
            if (!validateCPF(form.cpf)) e.cpf = "Informe seu CPF";
            if (!validateEmail(form.email)) e.email = "Informe um e-mail válido";
            if (!validatePhone(form.telefone)) e.telefone = "Informe seu telefone";
        }
        if (s === 1) {
            if (!validateCEP(form.cep)) e.cep = "Informe um CEP válido";
            if (!form.street.trim()) e.street = "Informe a rua";
            if (!form.number.trim()) e.number = "Informe o número do endereço";
            if (!form.district.trim()) e.district = "Informe o bairro";
            if (!form.city.trim()) e.city = "Informe a cidade";
        }
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    const next = () => {
        if (!validateStep(step)) return;
        setStep((s) => Math.min(s + 1, STEPS.length - 1));
    };
    const prev = () => setStep((s) => Math.max(s - 1, 0));

    // PAGAMENTO_SIMULADO — o pedido é criado via backend function que valida estoque,
    // decrementa de forma segura e salva um snapshot do produto (nome, sku, foto, cor, tamanho, preço).
    // O status inicial é sempre "recebido" — nunca "pagamento_aprovado" (sem gateway real).
    const createOrder = async () => {
        try {
            const res = await base44.functions.invoke('placeOrder', {
                customer: { name: form.nome, email: form.email, phone: form.telefone, cpf: form.cpf },
                address: {
                    cep: form.cep, street: form.street, number: form.number, complement: form.complement,
                    district: form.district, city: form.city, state: form.state,
                },
                items: cart.map((i) => ({ productId: i.productId, colorId: i.colorId, size: i.size, qty: i.qty })),
                payment_method: form.pagamento,
                shipping_method: form.entrega,
                coupon_code: couponCode || "",
                idempotency_key: idempotencyKey,
            });
            return res.data?.order_number || res.order_number;
        } catch (e) {
            throw new Error(e.response?.data?.error || e.message || "Erro ao finalizar pedido");
        }
    };

    const finish = async () => {
        setPlacing(true);
        setOrderError("");
        try {
            const num = await createOrder();
            setOrderNo(num);
            track('order_created');
            setDone(true);
            clearCart();
            window.scrollTo(0, 0);
        } catch (e) {
            setOrderError(e.message || "Erro ao finalizar pedido. Tente novamente.");
        } finally {
            setPlacing(false);
        }
    };

    if (done) {
        return (
            <div className="container-boutique py-32 text-center max-w-lg">
                <div className="w-16 h-16 rounded-full bg-[hsl(var(--gold))] mx-auto flex items-center justify-center">
                    <Check className="w-8 h-8 text-white" strokeWidth={1.5} />
                </div>
                <h1 className="mt-6 font-heading text-4xl tracking-[0.03em]">Pedido confirmado</h1>
                <div className="flex justify-center mt-5"><div className="gold-rule" /></div>
                <p className="mt-6 text-muted-foreground leading-relaxed">
                    Obrigada por escolher a D'Helenas. Seu pedido <strong className="text-foreground">{orderNo}</strong> foi recebido e em breve aparecerá em sua conta.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center mt-8">
                    <Link to="/minha-conta/pedidos" className="btn-gold">Ver meus pedidos</Link>
                    <Link to="/" className="btn-outline">Voltar ao início</Link>
                </div>
            </div>
        );
    }

    if (lines.length === 0) {
        return (
            <div className="container-boutique py-32 text-center">
                <p className="text-muted-foreground">Sua sacola está vazia.</p>
                <Link to="/loja" className="btn-outline mt-6">Explorar a coleção</Link>
            </div>
        );
    }

    return (
        <div className="container-boutique py-14">
            <h1 className="font-heading text-4xl sm:text-5xl tracking-[0.03em] text-center">Finalizar compra</h1>
            <div className="flex justify-center mt-5"><div className="gold-rule" /></div>

            {/* steps indicator */}
            <div className="flex items-center justify-center mt-10 mb-12 overflow-x-auto no-scrollbar">
                {STEPS.map((s, i) => (
                    <div key={s} className="flex items-center shrink-0">
                        <div className="flex flex-col items-center">
                            <div className={`w-9 h-9 rounded-full border flex items-center justify-center text-xs transition-colors ${i < step ? "bg-[hsl(var(--gold))] border-[hsl(var(--gold))] text-white" : i === step ? "border-foreground text-foreground" : "border-border text-muted-foreground"}`}>
                                {i < step ? <Check className="w-4 h-4" strokeWidth={1.5} /> : i + 1}
                            </div>
                            <span className={`mt-2 text-[9px] uppercase tracking-[0.16em] ${i === step ? "text-foreground" : "text-muted-foreground"} hidden sm:block`}>{s}</span>
                        </div>
                        {i < STEPS.length - 1 && <div className={`w-10 sm:w-16 h-px mx-1 ${i < step ? "bg-[hsl(var(--gold))]" : "bg-border"}`} />}
                    </div>
                ))}
            </div>

            <div className="grid lg:grid-cols-3 gap-12">
                <div className="lg:col-span-2">
                    {/* step 0 */}
                    {step === 0 && (
                        <FormGrid>
                            <Field label="Nome completo" value={form.nome} onChange={(v) => set("nome", v)} full error={errors.nome} />
                            <Field label="CPF" value={form.cpf} onChange={(v) => set("cpf", maskCPF(v))} error={errors.cpf} />
                            <Field label="Telefone" value={form.telefone} onChange={(v) => set("telefone", maskPhone(v))} error={errors.telefone} />
                            <Field label="E-mail" value={form.email} onChange={(v) => set("email", v)} full error={errors.email} />
                        </FormGrid>
                    )}
                    {/* step 1 */}
                    {step === 1 && (
                        <AddressFields form={form} set={set} errors={errors} />
                    )}
                    {/* step 2 */}
                    {step === 2 && (
                        <div className="space-y-3">
                            <OptionCard selected={form.entrega === "padrao"} onClick={() => set("entrega", "padrao")} title="Entrega padrão" desc="3 a 7 dias úteis" price={isFreeShipping(subtotal) ? "Grátis" : formatBRL(29.9)} />
                            <OptionCard selected={form.entrega === "expressa"} onClick={() => set("entrega", "expressa")} title="Entrega expressa" desc="1 a 2 dias úteis" price={formatBRL(49.9)} />
                            <OptionCard selected={form.entrega === "retirada"} onClick={() => set("entrega", "retirada")} title="Retirada na boutique" desc="Combinar retirada na loja" price="Grátis" />
                        </div>
                    )}
                    {/* step 3 */}
                    {step === 3 && (
                        <div className="space-y-3">
                            <PayOption selected={form.pagamento === "pix"} onClick={() => set("pagamento", "pix")} icon={QrCode} title="Pix" desc="Aprovação imediata · 5% de desconto" />
                            <PayOption selected={form.pagamento === "credito"} onClick={() => set("pagamento", "credito")} icon={CreditCard} title="Cartão de crédito" desc="Em até 6x sem juros" />
                            <PayOption selected={form.pagamento === "debito"} onClick={() => set("pagamento", "debito")} icon={Banknote} title="Cartão de débito" desc="À vista" />

                        </div>
                    )}
                    {/* step 4 */}
                    {step === 4 && (
                        <div className="text-center py-8">
                            <p className="text-sm text-muted-foreground">Revise seus dados e confirme o pedido.</p>
                            <div className="mt-6 text-left max-w-md mx-auto space-y-2 text-sm">
                                <p><span className="text-muted-foreground">Cliente:</span> {form.nome}</p>
                                <p><span className="text-muted-foreground">Entrega:</span> {form.street}, {form.number} — {form.city}/{form.state}</p>
                                <p><span className="text-muted-foreground">Pagamento:</span> {form.pagamento === "pix" ? "Pix" : form.pagamento === "credito" ? "Cartão de crédito" : "Cartão de débito"}</p>
                            </div>
                        </div>
                    )}

                    {/* nav */}
                    <div className="flex justify-between mt-10">
                        <button onClick={prev} disabled={step === 0} className="btn-ghost disabled:opacity-30">← Voltar</button>
                        {step < STEPS.length - 1 ? (
                            <button onClick={next} className="btn-gold">Continuar</button>
                        ) : (
                            <button onClick={finish} disabled={placing} className="btn-gold">{placing ? <><Loader2 className="w-4 h-4 animate-spin" /> Finalizando...</> : "Confirmar pedido"}</button>
                        )}
                    </div>
                    {orderError && (
                        <div className="mt-4 p-4 bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                            {orderError}
                        </div>
                    )}
                </div>

                {/* summary */}
                <div>
                    <div className="bg-[hsl(var(--bone))] p-7 space-y-4">
                        <h3 className="text-[11px] uppercase tracking-[0.24em]">Seu pedido</h3>
                        <div className="space-y-3 max-h-64 overflow-y-auto">
                            {lines.map((l) => (
                                <div key={`${l.productId}-${l.colorId}-${l.size}`} className="flex gap-3">
                                    <img src={l.product.images[0]} alt="" className="w-14 h-18 object-cover bg-bone" style={{ height: "72px" }} />
                                    <div className="flex-1 text-sm">
                                        <p className="font-medium leading-tight">{l.product.name}</p>
                                        <p className="text-[11px] text-muted-foreground">{COLOR_SWATCHES[l.colorId]?.name} · {l.size} · {l.qty}x</p>
                                        <p className="text-sm mt-1">{formatBRL(l.product.price * l.qty)}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="pt-4 border-t border-border space-y-2 text-sm">
                            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatBRL(subtotal)}</span></div>
                            {couponDiscount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Cupom ({couponCode})</span><span className="text-[hsl(var(--rose))]">- {formatBRL(couponDiscount)}</span></div>}
                            <div className="flex justify-between"><span className="text-muted-foreground">Frete</span><span>{shipping === 0 ? "Grátis" : formatBRL(shipping)}</span></div>
                            <div className="flex justify-between pt-3 border-t border-border text-base font-medium"><span>Total</span><span>{formatBRL(total)}</span></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function FormGrid({ children }) {
    return <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">{children}</div>;
}

function Field({ label, value, onChange, full, error }) {
    return (
        <div className={full ? "sm:col-span-2" : ""}>
            <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">{label}</label>
            <input value={value} onChange={(e) => onChange(e.target.value)} className={`w-full border bg-background px-4 py-3.5 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors ${error ? "border-[hsl(var(--rose))]" : "border-border"}`} />
            {error && <p className="text-[11px] text-[hsl(var(--rose))] mt-1">{error}</p>}
        </div>
    );
}

function OptionCard({ selected, onClick, title, desc, price }) {
    return (
        <button onClick={onClick} className={`w-full flex items-center justify-between p-5 border text-left transition-colors ${selected ? "border-[hsl(var(--gold))] bg-[hsl(var(--gold))]/5" : "border-border hover:border-foreground/40"}`}>
            <div>
                <p className="text-sm font-medium">{title}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{desc}</p>
            </div>
            <span className="text-sm font-medium">{price}</span>
        </button>
    );
}

function PayOption({ selected, onClick, icon: Icon, title, desc }) {
    return (
        <button onClick={onClick} className={`w-full flex items-center gap-4 p-5 border text-left transition-colors ${selected ? "border-[hsl(var(--gold))] bg-[hsl(var(--gold))]/5" : "border-border hover:border-foreground/40"}`}>
            <Icon className="w-5 h-5 text-[hsl(var(--gold))]" strokeWidth={1.25} />
            <div className="flex-1">
                <p className="text-sm font-medium">{title}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{desc}</p>
            </div>
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${selected ? "border-[hsl(var(--gold))]" : "border-border"}`}>
                {selected && <div className="w-2.5 h-2.5 rounded-full bg-[hsl(var(--gold))]" />}
            </div>
        </button>
    );
}