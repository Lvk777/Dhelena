import React, { useState, useEffect } from "react";
import { CreditCard, Loader2, Check, X, QrCode, Banknote } from "lucide-react";
import AdminFormSection from "@/components/admin/AdminFormSection";
import AdminInput from "@/components/admin/AdminInput";
import AdminToggle from "@/components/admin/AdminToggle";
import AdminSelect from "@/components/admin/AdminSelect";
import { base44 } from "@/api/base44Client";

export default function PaymentsTab({ data, onChange }) {
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);
    const [methodsInfo, setMethodsInfo] = useState(null);
    const [methodsLoading, setMethodsLoading] = useState(false);
    const set = (k, v) => onChange({ ...data, [k]: v });

    useEffect(() => {
        loadMethods();
    }, []);

    const loadMethods = async () => {
        setMethodsLoading(true);
        try {
            const res = await base44.functions.invoke("getPaymentMethods");
            setMethodsInfo(res);
        } catch (e) {
            setMethodsInfo({ error: e.response?.data?.error || e.message });
        } finally { setMethodsLoading(false); }
    };

    const testConnection = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            const res = await base44.functions.invoke('testPaymentConnection');
            setTestResult(res.data || res);
        } catch (e) {
            setTestResult({ connected: false, error: e.message || "Erro ao testar conexão" });
        } finally {
            setTesting(false);
        }
    };

    return (
        <div className="space-y-5">
            <AdminFormSection title="Mercado Pago" icon={CreditCard} description="Gateway de pagamento — Checkout Transparente via Orders API">
                <div className="sm:col-span-2">
                    <AdminToggle label="Ativar Mercado Pago" checked={data.mercado_pago_enabled} onChange={(v) => set("mercado_pago_enabled", v)} description="Processa pagamentos via Pix, cartão e boleto" />
                </div>
                <AdminSelect label="Ambiente" value={data.mercado_pago_mode} onChange={(v) => set("mercado_pago_mode", v)} options={[{ value: "sandbox", label: "Sandbox (teste)" }, { value: "production", label: "Produção" }]} />
                <div />
            </AdminFormSection>

            <AdminFormSection title="Métodos de pagamento">
                <div className="sm:col-span-2 space-y-1">
                    <AdminToggle label="Pix" icon={QrCode} checked={data.pix_enabled} onChange={(v) => set("pix_enabled", v)} description="Pagamento instantâneo com QR Code" />
                    <AdminToggle label="Cartão de crédito" checked={data.card_enabled} onChange={(v) => set("card_enabled", v)} description="Pagamento via cartão com parcelamento (Card Payment Brick)" />
                    <AdminToggle label="Cartão de débito" checked={data.debit_card_enabled} onChange={(v) => set("debit_card_enabled", v)} description="Somente se disponível na conta Mercado Pago" />
                    <AdminToggle label="Boleto bancário" checked={data.boleto_enabled} onChange={(v) => set("boleto_enabled", v)} description="Pagamento via boleto (compensação em 1-2 dias)" />
                </div>
            </AdminFormSection>

            <AdminFormSection title="Parcelamento">
                <AdminInput label="Número máximo de parcelas" type="number" value={data.max_installments} onChange={(v) => set("max_installments", parseInt(v) || 1)} />
                <AdminInput label="Parcelas sem juros" type="number" value={data.interest_free_installments} onChange={(v) => set("interest_free_installments", parseInt(v) || 0)} />
                <AdminInput label="Desconto no Pix (%)" type="number" value={data.pix_discount} onChange={(v) => set("pix_discount", parseFloat(v) || 0)} description="Desconto adicional para pagamentos via Pix" />
                <div />
            </AdminFormSection>

            <AdminFormSection title="Métodos disponíveis no Mercado Pago" description="Métodos que a conta MP oferece — combine com os toggles acima">
                <div className="sm:col-span-2">
                    {methodsLoading && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Verificando...</div>}
                    {methodsInfo?.error && <p className="text-xs text-red-600">{methodsInfo.error}</p>}
                    {methodsInfo && !methodsInfo.error && (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 text-xs">
                                <span className="text-muted-foreground">Ambiente:</span>
                                <span className="font-medium">{methodsInfo.environment || "—"}</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                <MethodBadge icon={QrCode} label="Pix" available={methodsInfo.available?.pix} enabled={methodsInfo.enabled?.pix} />
                                <MethodBadge icon={CreditCard} label="Cartão" available={methodsInfo.available?.credit_card} enabled={methodsInfo.enabled?.credit_card} />
                                <MethodBadge icon={Banknote} label="Débito" available={methodsInfo.available?.debit_card} enabled={methodsInfo.enabled?.debit_card} />
                            </div>
                            {methodsInfo.available && !methodsInfo.available.pix && (
                                <p className="text-xs text-amber-600 mt-2">⚠ Pix indisponível nesta conta Mercado Pago. Verifique se a chave Pix está cadastrada e o ambiente é correto.</p>
                            )}
                        </div>
                    )}
                </div>
            </AdminFormSection>

            <AdminFormSection title="Status da integração">
                <div className="sm:col-span-2">
                    {testResult && (
                        <div className={`flex items-start gap-2 p-3 rounded-lg border mb-3 ${
                            testResult.connected
                                ? "bg-green-500/5 border-green-500/20"
                                : "bg-red-500/5 border-red-500/20"
                        }`}>
                            {testResult.connected ? (
                                <Check className="w-4 h-4 text-green-600 shrink-0 mt-0.5" strokeWidth={1.5} />
                            ) : (
                                <X className="w-4 h-4 text-red-600 shrink-0 mt-0.5" strokeWidth={1.5} />
                            )}
                            <div className="text-xs">
                                <p className="font-medium">
                                    Status: <span className={testResult.connected ? "text-green-600" : "text-red-600"}>
                                        {testResult.connected ? "Conectado" : "Erro"}
                                    </span>
                                </p>
                                {testResult.environment && (
                                    <p className="text-muted-foreground mt-0.5">Ambiente: {testResult.environment}</p>
                                )}
                                {testResult.error && (
                                    <p className="text-red-600 mt-0.5">{testResult.error}</p>
                                )}
                            </div>
                        </div>
                    )}
                    <button
                        onClick={testConnection}
                        disabled={testing}
                        className="btn-outline text-xs flex items-center gap-2"
                    >
                        {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <CreditCard className="w-3 h-3" />}
                        {testing ? "Testando..." : "Testar conexão"}
                    </button>
                    <p className="text-[10px] text-muted-foreground mt-2">
                        O Access Token nunca é exibido. Apenas o backend faz a chamada ao Mercado Pago.
                    </p>
                </div>
            </AdminFormSection>
        </div>
    );
}

function MethodBadge({ icon: Icon, label, available, enabled }) {
    return (
        <div className={`p-3 border rounded-lg text-center ${enabled ? "border-green-500/30 bg-green-500/5" : available ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-muted/5"}`}>
            <Icon className={`w-5 h-5 mx-auto mb-1 ${enabled ? "text-green-600" : available ? "text-amber-600" : "text-muted-foreground"}`} strokeWidth={1.5} />
            <p className="text-xs font-medium">{label}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
                {enabled ? "Ativo" : available ? "Disponível (inativo)" : "Indisponível"}
            </p>
        </div>
    );
}
