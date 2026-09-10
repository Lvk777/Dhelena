import React from "react";
import { Truck, AlertCircle } from "lucide-react";
import AdminFormSection from "@/components/admin/AdminFormSection";
import AdminInput from "@/components/admin/AdminInput";
import AdminTextarea from "@/components/admin/AdminTextarea";
import AdminToggle from "@/components/admin/AdminToggle";
import AdminSelect from "@/components/admin/AdminSelect";

export default function ShippingTab({ data, onChange }) {
    const set = (k, v) => onChange({ ...data, [k]: v });
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
                <div className="sm:col-span-2">
                    <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg border border-border">
                        <AlertCircle className="w-4 h-4 text-muted-foreground shrink-0" strokeWidth={1.5} />
                        <div className="text-xs">
                            <p className="text-muted-foreground">Status: <span className="text-foreground font-medium">Não configurado</span></p>
                            <p className="text-muted-foreground mt-0.5">Configure o secret <code className="text-foreground">MELHOR_ENVIO_TOKEN</code> no ambiente seguro da Base44 (Settings → Environment Variables)</p>
                        </div>
                    </div>
                    <button onClick={() => console.log("Melhor Envio: integração pendente de configuração no ambiente")} className="btn-outline mt-3 text-xs">
                        Testar conexão
                    </button>
                </div>
            </AdminFormSection>
        </div>
    );
}