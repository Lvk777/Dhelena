import React, { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Check, CreditCard, QrCode, Banknote, Loader2 } from "lucide-react";
import { useStore } from "@/context/StoreContext";
import { useCatalog } from "@/context/CatalogContext";
import { useAuth } from "@/lib/AuthContext";
import { usePublicSettings } from "@/context/PublicSettingsContext";
import { base44 } from "@/api/base44Client";
import { COLOR_SWATCHES, formatBRL, stockFor } from "@/data/products";
import AddressFields from "@/components/AddressFields";
import { validateCPF, validateEmail, validatePhone, validateCEP, maskCPF, maskPhone } from "@/lib/forms";
import { track } from "@/lib/analytics";
import ShippingStep from "@/components/checkout/ShippingStep";
import PixPaymentScreen from "@/components/checkout/PixPaymentScreen";
import CardPaymentBrick from "@/components/checkout/CardPaymentBrick";
import { selectedDelivery, selectedDeliveryCost, shippingContextKey } from "@/lib/shippingSelection";

const STEPS = ["Identificação", "Endereço", "Entrega", "Pagamento"];

export default function Checkout() {
    const { cart, clearCart, couponCode, couponResult } = useStore();
    const { products } = useCatalog();
    const { user } = useAuth();
    const { settings: publicSettings } = usePublicSettings();

    const [step, setStep] = useState(0);
    const [idempotencyKey] = useState(() => "dh_" + Date.now() + "_" + Math.random().toString(36).slice(2));
    const [form, setForm] = useState({
        nome: "", cpf: "", email: "", telefone: "",
        cep: "", street: "", number: "", complement: "", district: "", city: "", state: "SP",
    });
    const [shipping, setShipping] = useState({ method: "", cost: null, carrier: null, serviceName: null, deliveryTime: null, quoteId: null });
    const [quoteLoading, setQuoteLoading] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState("");
    const [paymentMethods, setPaymentMethods] = useState(null);
    const [paymentLoadError, setPaymentLoadError] = useState("");
    const [done, setDone] = useState(false);
    const [order, setOrder] = useState(null);
    const [placing, setPlacing] = useState(false);
    const placingRef = useRef(false);
    const [errors, setErrors] = useState(/** @type {Record<string, any>} */ ({}));
    const [orderError, setOrderError] = useState("");
    const [paymentScreen, setPaymentScreen] = useState(null); // null | 'pix' | 'card'
    const shippingKey = shippingContextKey(form.cep, cart, couponCode);

    useEffect(() => {
        setShipping((current) => current.method === "melhor_envio"
            ? { method: "", cost: null, carrier: null, serviceName: null, deliveryTime: null, quoteId: null }
            : current);
    }, [shippingKey]);

    useEffect(() => { track("begin_checkout"); }, []);

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

    // Load payment methods when reaching payment step
    useEffect(() => {
        if (step === 3 && !paymentMethods) {
            loadPaymentMethods();
        }
    }, [step]);

    const loadPaymentMethods = async () => {
        setPaymentLoadError("");
        try {
            const res = await base44.functions.invoke("getPaymentMethods");
            setPaymentMethods(res);
            setPaymentMethod((selected) => {
                const key = { pix: "pix", credito: "credit_card", debito: "debit_card" }[selected];
                return key && res.enabled?.[key] ? selected : "";
            });
        } catch (e) {
            setPaymentLoadError("Não foi possível carregar as formas de pagamento.");
        }
    };

    const lines = cart.map((i) => ({ ...i, product: products.find((p) => p.id === i.productId) })).filter((l) => l.product);
    const invalidLines = lines.filter((line) => !Number.isInteger(line.qty) || line.qty <= 0
        || stockFor(line.product, line.colorId, line.size) < line.qty);
    const subtotal = lines.reduce((s, l) => s + (l.product.salePrice || l.product.price) * l.qty, 0);
    const couponDiscount = couponResult?.valid ? (couponResult.discount || 0) : 0;
    const freeShippingFromCoupon = couponResult?.valid && couponResult.freeShipping;
    const freeShippingThreshold = 499;
    const freeShippingEnabled = publicSettings?.shipping?.free_shipping_enabled !== false;
    const pickupEnabled = publicSettings?.shipping?.pickup_enabled;
    const pickupName = publicSettings?.shipping?.pickup_name;
    const pickupTime = publicSettings?.shipping?.pickup_time;

    const hasFreeShipping = freeShippingFromCoupon || (freeShippingEnabled && subtotal - couponDiscount >= freeShippingThreshold);
    // Only a selected service can contribute a shipping amount.
    const currentShipping = selectedDelivery(shipping, shippingKey);
    const shippingCost = selectedDeliveryCost(shipping, shippingKey, hasFreeShipping);

    const total = subtotal - couponDiscount + (shippingCost ?? 0);

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
        if (s === 2) {
            if (quoteLoading && currentShipping?.method !== "retirada") e.shipping = "Aguarde a cotação de frete";
            else if (!currentShipping) e.shipping = "Selecione uma opção de entrega";
        }
        if (s === 3) {
            const enabledKey = { pix: "pix", credito: "credit_card", debito: "debit_card" }[paymentMethod];
            if (!enabledKey || !paymentMethods?.enabled?.[enabledKey]) e.payment = "Selecione um método de pagamento disponível";
        }
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    const next = () => {
        if (!validateStep(step)) return;
        setStep((s) => Math.min(s + 1, STEPS.length - 1));
    };
    const prev = () => setStep((s) => Math.max(s - 1, 0));

    // Create order via backend (validates stock, price, coupon, shipping)
    const createOrder = async () => {
        const res = await base44.functions.invoke("placeOrder", {
            idempotencyKey,
            customer: { name: form.nome, email: form.email, phone: form.telefone, cpf: form.cpf },
            shipping_address: {
                cep: form.cep, street: form.street, number: form.number, complement: form.complement,
                district: form.district, city: form.city, state: form.state,
            },
            items: cart.map((i) => ({ productId: i.productId, colorId: i.colorId, size: i.size, qty: i.qty })),
            payment_method: paymentMethod === "pix" ? "pix" : paymentMethod === "credito" ? "credito" : "debito",
            shipping_method: currentShipping?.method,
            shipping_quote_id: currentShipping?.quoteId,
            coupon_code: couponCode || "",
        });
        return res;
    };

    const finish = async () => {
        if (placingRef.current) return;
        if (invalidLines.length || lines.length !== cart.length) { setOrderError("Revise os itens e o estoque da sacola antes de continuar."); return; }
        if (!validateStep(2)) { setStep(2); return; }
        if (!validateStep(3)) return;
        placingRef.current = true;
        setPlacing(true);
        setOrderError("");
        try {
            const createdOrder = await createOrder();
            setOrder(createdOrder);
            track("order_created");

            // Route to payment screen based on method
            if (paymentMethod === "pix") {
                setPaymentScreen("pix");
            } else {
                setPaymentScreen("card");
            }
        } catch (e) {
            setOrderError(e.response?.data?.error || e.message || "Erro ao finalizar pedido");
        } finally {
            placingRef.current = false;
            setPlacing(false);
        }
    };

    const onPaymentApproved = () => {
        setDone(true);
        clearCart();
        window.scrollTo(0, 0);
    };

    // ─── Confirmation screen ───
    if (done) {
        return (
            <div className="container-boutique py-32 text-center max-w-lg">
                <div className="w-16 h-16 rounded-full bg-[hsl(var(--gold))] mx-auto flex items-center justify-center">
                    <Check className="w-8 h-8 text-white" strokeWidth={1.5} />
                </div>
                <h1 className="mt-6 font-heading text-4xl tracking-[0.03em]">Pedido confirmado</h1>
                <div className="flex justify-center mt-5"><div className="gold-rule" /></div>
                <p className="mt-6 text-muted-foreground leading-relaxed">
                    Obrigada por escolher a D'Helenas. Seu pedido{" "}
                    <strong className="text-foreground">{order?.order_number}</strong> foi recebido e o pagamento foi confirmado.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center mt-8">
                    <Link to="/minha-conta/pedidos" className="btn-gold">Ver meus pedidos</Link>
                    <Link to="/" className="btn-outline">Voltar ao início</Link>
                </div>
            </div>
        );
    }

    // ─── PIX payment screen ───
    if (paymentScreen === "pix" && order) {
        return (
            <div className="container-boutique py-14">
                <PixPaymentScreen order={order} onApproved={onPaymentApproved} />
                <div className="text-center mt-8">
                    <Link to="/minha-conta/pedidos" className="text-sm text-muted-foreground hover:text-foreground">
                        Ver meus pedidos
                    </Link>
                </div>
            </div>
        );
    }

    // ─── Card payment screen ───
    if (paymentScreen === "card" && order) {
        const isDebit = paymentMethod === "debito";
        return (
            <div className="container-boutique py-14">
                <CardPaymentBrick
                    order={order}
                    publicKey={paymentMethods?.public_key}
                    amount={order.total}
                    maxInstallments={isDebit ? 1 : (paymentMethods?.max_installments || 6)}
                    isDebit={isDebit}
                    onApproved={onPaymentApproved}
                    onRejected={() => {}}
                />
                <div className="text-center mt-8">
                    <Link to="/minha-conta/pedidos" className="text-sm text-muted-foreground hover:text-foreground">
                        Ver meus pedidos
                    </Link>
                </div>
            </div>
        );
    }

    // ─── Empty cart ───
    if (lines.length === 0) {
        return (
            <div className="container-boutique py-32 text-center">
                <p className="text-muted-foreground">Sua sacola está vazia.</p>
                <Link to="/loja" className="btn-outline mt-6">Explorar a coleção</Link>
            </div>
        );
    }

    // ─── Checkout steps ───
    return (
        <div className="container-boutique py-14">
            <h1 className="font-heading text-4xl sm:text-5xl tracking-[0.03em] text-center">Finalizar compra</h1>
            <div className="flex justify-center mt-5"><div className="gold-rule" /></div>

            {/* Steps indicator */}
            <div className="flex items-center justify-center mt-10 mb-12 overflow-x-auto no-scrollbar">
                {STEPS.map((s, i) => (
                    <div key={s} className="flex items-center shrink-0">
                        <div className="flex flex-col items-center">
                            <div className={`w-9 h-9 rounded-full border flex items-center justify-center text-xs transition-colors ${i < step ? "bg-[hsl(var(--gold))] border-[hsl(var(--gold))] text-white" : i === step ? "border-foreground text-foreground" : "border-border text-muted-foreground"}`}>
                                {i < step ? <Check className="w-4 h-4" strokeWidth={2} /> : i + 1}
                            </div>
                            <span className={`text-[10px] mt-2 whitespace-nowrap ${i === step ? "text-foreground font-medium" : "text-muted-foreground"}`}>{s}</span>
                        </div>
                        {i < STEPS.length - 1 && <div className={`w-12 sm:w-20 h-px mx-2 ${i < step ? "bg-[hsl(var(--gold))]" : "bg-border"}`} />}
                    </div>
                ))}
            </div>

            <div className="grid lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2">
                    {/* Step 0: Identificação */}
                    {step === 0 && (
                        <div className="space-y-5">
                            <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Dados pessoais</h2>
                            <FormGrid>
                                <Field label="Nome completo" value={form.nome} onChange={(v) => set("nome", v)} full error={errors.nome} />
                                <Field label="CPF" value={form.cpf} onChange={(v) => set("cpf", maskCPF(v))} error={errors.cpf} />
                                <Field label="Telefone / WhatsApp" value={form.telefone} onChange={(v) => set("telefone", maskPhone(v))} error={errors.telefone} />
                                <Field label="E-mail" value={form.email} onChange={(v) => set("email", v)} full error={errors.email} />
                            </FormGrid>
                        </div>
                    )}

                    {/* Step 1: Endereço */}
                    {step === 1 && (
                        <div className="space-y-5">
                            <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Endereço de entrega</h2>
                            <AddressFields form={form} set={set} errors={errors} />
                        </div>
                    )}

                    {/* Step 2: Entrega */}
                    {step === 2 && (
                        <div className="space-y-5">
                            <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Opções de entrega</h2>
                            <ShippingStep
                                cep={form.cep}
                                products={lines}
                                quoteContextKey={shippingKey}
                                shippingMethod={currentShipping?.method}
                                shippingQuoteId={currentShipping?.quoteId}
                                shippingCost={currentShipping?.cost}
                                freeShipping={hasFreeShipping}
                                onQuoteLoading={setQuoteLoading}
                                onShippingSelect={(s) => {
                                    setShipping(s.method === "melhor_envio" ? { ...s, contextKey: shippingKey } : s);
                                    setErrors((e) => ({ ...e, shipping: undefined }));
                                }}
                                pickupEnabled={pickupEnabled}
                                pickupName={pickupName}
                                pickupTime={pickupTime}
                            />
                            {errors.shipping && <p className="text-[11px] text-[hsl(var(--rose))]">{errors.shipping}</p>}
                        </div>
                    )}

                    {/* Step 3: Pagamento */}
                    {step === 3 && (
                        <div className="space-y-5">
                            <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Forma de pagamento</h2>
                            {paymentLoadError && <div role="alert" className="text-sm text-destructive">{paymentLoadError} <button type="button" onClick={loadPaymentMethods} className="underline min-h-11">Tentar novamente</button></div>}
                            {!paymentMethods && !paymentLoadError ? (
                                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                    <Loader2 className="w-4 h-4 animate-spin" /> Carregando métodos de pagamento...
                                </div>
                            ) : paymentMethods ? (
                                <div className="space-y-3" role="radiogroup" aria-label="Forma de pagamento">
                                    <PayOption selected={paymentMethod === "pix"} disabled={!paymentMethods.enabled?.pix} onClick={() => setPaymentMethod("pix")} icon={QrCode} title="Pix" desc="Pagamento instantâneo com QR Code" />
                                    <PayOption selected={paymentMethod === "credito"} disabled={!paymentMethods.enabled?.credit_card} onClick={() => setPaymentMethod("credito")} icon={CreditCard} title="Cartão de crédito" desc={`Parcele em até ${paymentMethods?.max_installments || 6}x, conforme as opções disponíveis no cartão`} />
                                    <PayOption selected={paymentMethod === "debito"} disabled={!paymentMethods.enabled?.debit_card} onClick={() => setPaymentMethod("debito")} icon={Banknote} title="Cartão de débito" desc="Pagamento à vista" />
                                    {!paymentMethods.enabled?.pix && !paymentMethods.enabled?.credit_card && !paymentMethods.enabled?.debit_card && (
                                        <div className="p-4 border border-amber-500/30 bg-amber-500/5 text-sm text-amber-700">
                                            Nenhum método de pagamento disponível. Verifique a configuração do Mercado Pago no admin.
                                        </div>
                                    )}
                                </div>
                            ) : null}
                            {errors.payment && <p className="text-[11px] text-[hsl(var(--rose))]">{errors.payment}</p>}
                            <div className="p-4 bg-[hsl(var(--bone))] text-xs text-muted-foreground leading-relaxed">
                                <p>Ao confirmar, seu pedido será criado e o pagamento processado pelo Mercado Pago.</p>
                                <p className="mt-1">Você verá o valor confirmado antes de pagar.</p>
                            </div>
                        </div>
                    )}

                    {/* Navigation */}
                    <div className="flex justify-between mt-10">
                        <button onClick={prev} disabled={step === 0} className="btn-ghost disabled:opacity-30">← Voltar</button>
                        {step < STEPS.length - 1 ? (
                            <button onClick={next} className="btn-gold">Continuar</button>
                        ) : (
                            <button onClick={finish} disabled={placing} className="btn-gold">
                                {placing ? <><Loader2 className="w-4 h-4 animate-spin" /> Criando pedido...</> : "Confirmar pedido"}
                            </button>
                        )}
                    </div>
                    {orderError && (
                        <div className="mt-4 p-4 bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                            {orderError}
                        </div>
                    )}
                </div>

                {/* Summary */}
                <div>
                    <div className="bg-[hsl(var(--bone))] p-7 space-y-4 sticky top-8">
                        <h3 className="text-[11px] uppercase tracking-[0.24em]">Seu pedido</h3>
                        <div className="space-y-3 max-h-64 overflow-y-auto">
                            {lines.map((l) => (
                                <div key={`${l.productId}-${l.colorId}-${l.size}`} className="flex gap-3">
                                    <img src={l.product.images[0]} alt="" className="w-14 h-18 object-cover bg-bone" style={{ height: "72px" }} />
                                    <div className="flex-1 text-sm">
                                        <p className="font-medium leading-tight">{l.product.name}</p>
                                        <p className="text-[11px] text-muted-foreground">{COLOR_SWATCHES[l.colorId]?.name} · {l.size} · {l.qty}x</p>
                                        <p className="text-sm mt-1">{formatBRL((l.product.salePrice ?? l.product.price) * l.qty)}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="pt-4 border-t border-border space-y-2 text-sm">
                            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatBRL(subtotal)}</span></div>
                            {couponDiscount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Cupom ({couponCode})</span><span className="text-[hsl(var(--rose))]">- {formatBRL(couponDiscount)}</span></div>}
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Frete</span>
                                <span>{currentShipping ? (shippingCost === 0 ? "Grátis" : formatBRL(shippingCost)) : "Selecione a entrega"}</span>
                            </div>
                            <div className="flex justify-between pt-3 border-t border-border text-base font-medium">
                                <span>{currentShipping ? "Total estimado" : "Total parcial"}</span><span>{formatBRL(total)}</span>
                            </div>
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

function Field({ label, value, onChange, full = false, error = "" }) {
    return (
        <div className={full ? "sm:col-span-2" : ""}>
            <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">{label}</label>
            <input value={value} onChange={(e) => onChange(e.target.value)} className={`w-full border bg-background px-4 py-3.5 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors ${error ? "border-[hsl(var(--rose))]" : "border-border"}`} />
            {error && <p className="text-[11px] text-[hsl(var(--rose))] mt-1">{error}</p>}
        </div>
    );
}

function PayOption({ selected, disabled, onClick, icon: Icon, title, desc }) {
    return (
        <button type="button" role="radio" aria-checked={selected} disabled={disabled} onClick={onClick} className={`w-full flex items-center gap-4 p-5 border text-left min-h-14 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${selected ? "border-[hsl(var(--gold))] bg-[hsl(var(--gold))]/5" : "border-border hover:border-foreground/40"}`}>
            <Icon className="w-5 h-5 text-[hsl(var(--gold))]" strokeWidth={1.25} />
            <div className="flex-1">
                <p className="text-sm font-medium">{title}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{disabled ? "Indisponível no momento" : desc}</p>
            </div>
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${selected ? "border-[hsl(var(--gold))]" : "border-border"}`}>
                {selected && <div className="w-2.5 h-2.5 rounded-full bg-[hsl(var(--gold))]" />}
            </div>
        </button>
    );
}
