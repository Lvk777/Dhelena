import React, { useState } from "react";
import { Truck, AlertCircle, Loader2, Check, X } from "lucide-react";
import AdminFormSection from "@/components/admin/AdminFormSection";
import AdminInput from "@/components/admin/AdminInput";
import AdminTextarea from "@/components/admin/AdminTextarea";
import AdminToggle from "@/components/admin/AdminToggle";
import AdminSelect from "@/components/admin/AdminSelect";
import { base44 } from "@/api/base44Client";

export default function ShippingTab({ data, onChange }) {
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);
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
                <AdminTextarea label="Instruções de retirada" value={data.pickup_instructions} onChange={(v) => set("pickup_instructions", v)} rows={2} full placeholder="Ex: Retirar no endereço X, das 9h às 18h" />
            </AdminFormSection>

            <AdminFormSection title="Frete grátis">
                <div className="sm:col-span-2">
                    <AdminToggle label="Ativar frete grátis" checked={data.free_shipping_enabled} onChange={(v) => set("free_shipping_enabled", v)} description="Oferece frete grátis acima de um valor mínimo" />
                </div>
                <AdminInput label="Valor mínimo para frete grátis (R$)" type="number" value={data.free_shipping_threshold} onChange={(v) => set("free_shipping_threshold", parseFloat(v) || 0)} />
                <div />
            </AdminFormSection>

            <AdminFormSection title="Melhor Envio" description="Integração com a API do Melhor Envio para cálculo de frete real">
                <div className="sm:col-span-2">
                    <AdminToggle label="Ativar Melhor Envio" checked={data.melhor_envio_enabled} onChange={(v) => set("melhor_envio_enabled", v)} description="Calcula frete real com transportadoras via Melhor Envio" />
                </div>
                <AdminSelect label="Ambiente" value={data.melhor_envio_mode} onChange={(v) => set("melhor_envio_mode", v)} options={[{ value: "sandbox", label: "Sandbox (teste)" }, { value: "production", label: "Produção" }]} />
                <AdminInput label="Prazo adicional de preparação (dias)" type="number" value={data.melhor_envio_extra_days} onChange={(v) => set("melhor_envio_extra_days", parseInt(v) || 0)} description="Dias extras somados ao prazo da transportadora" />
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
