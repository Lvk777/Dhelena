import React, { useState, useEffect } from "react";
import { Truck, Loader2, Check, X } from "lucide-react";
import AdminFormSection from "@/components/admin/AdminFormSection";
import AdminInput from "@/components/admin/AdminInput";
import AdminTextarea from "@/components/admin/AdminTextarea";
import AdminToggle from "@/components/admin/AdminToggle";
import { base44 } from "@/api/base44Client";

export default function ShippingTab({ data, onChange }) {
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);
    const [activeMode, setActiveMode] = useState('INDETERMINADO');
    useEffect(() => {
        base44.custom.integrationStatus().then(rows => setActiveMode(rows.find(row => row.key === 'melhorEnvio')?.environment || 'INDETERMINADO')).catch(() => {});
    }, []);
    const set = (k, v) => onChange({ ...data, [k]: v });

    const testConnection = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            const res = await base44.functions.invoke('testShippingConnection');
            setTestResult(res.data || res);
        } catch (e) {
            setTestResult({ connected: false, error: e.message || "Erro ao testar conexão" });
        } finally {
            setTesting(false);
        }
    };

    return (
        <div className="space-y-5">
            <AdminFormSection title="Retirada no estoque" icon={Truck}>
                <div className="sm:col-span-2">
                    <AdminToggle label="Ativar retirada" checked={data.pickup_enabled} onChange={(v) => set("pickup_enabled", v)} description="Permite que o cliente escolha retirar o pedido no estoque" />
                </div>
                <AdminInput label="Nome exibido" value={data.pickup_name} onChange={(v) => set("pickup_name", v)} />
                <AdminInput label="Prazo para retirada" value={data.pickup_time} onChange={(v) => set("pickup_time", v)} placeholder="Ex: 2 dias úteis" />
                <AdminTextarea label="Endereço público de retirada" value={data.pickup_address || ''} onChange={v => set('pickup_address', v)} full rows={2} />
                <AdminTextarea label="Instruções de retirada" value={data.pickup_instructions} onChange={(v) => set("pickup_instructions", v)} rows={2} full placeholder="Ex: Retirar no endereço X, das 9h às 18h" />
            </AdminFormSection>

            <AdminFormSection title="Frete grátis">
                <div className="sm:col-span-2">
                    <AdminToggle label="Ativar frete grátis" checked={data.free_shipping_enabled} onChange={(v) => set("free_shipping_enabled", v)} description="Oferece frete grátis a partir de R$ 499 após descontos" />
                </div>
                <p className="text-sm text-muted-foreground">Frete grátis para pedidos de R$ 499 ou mais, após descontos. A regra é aplicada no servidor.</p>
                <div />
            </AdminFormSection>

            <AdminFormSection title="Melhor Envio" description="Integração com a API do Melhor Envio para cálculo de frete real">
                <div className="sm:col-span-2">
                    <AdminToggle label="Ativar Melhor Envio" checked={data.melhor_envio_enabled} onChange={(v) => set("melhor_envio_enabled", v)} description="Calcula frete real com transportadoras via Melhor Envio" />
                </div>
                <AdminInput label="Ambiente ativo" value={activeMode} disabled onChange={() => {}} />
                <AdminInput label="Preparação e postagem (dias úteis)" type="number" value={data.melhor_envio_extra_days ?? ''} onChange={(v) => set("melhor_envio_extra_days", v === '' ? null : Number(v))} placeholder="2" description="Condição aprovada: até 2 dias úteis após a confirmação do pagamento, incluindo a entrega efetiva à transportadora. A soma depende da ativação no backend." />
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
                        {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Truck className="w-3 h-3" />}
                        {testing ? "Testando..." : "Testar conexão"}
                    </button>
                    <p className="text-[10px] text-muted-foreground mt-2">
                        O token nunca é exibido. Apenas o backend faz a chamada ao Melhor Envio.
                    </p>
                </div>
            </AdminFormSection>
        </div>
    );
}
