import React from "react";
import { CreditCard, AlertCircle } from "lucide-react";
import AdminFormSection from "@/components/admin/AdminFormSection";
import AdminInput from "@/components/admin/AdminInput";
import AdminToggle from "@/components/admin/AdminToggle";
import AdminSelect from "@/components/admin/AdminSelect";

export default function PaymentsTab({ data, onChange }) {
    const set = (k, v) => onChange({ ...data, [k]: v });
    return (
        <div className="space-y-5">
            <AdminFormSection title="Mercado Pago" icon={CreditCard} description="Gateway de pagamento principal">
                <div className="sm:col-span-2">
                    <AdminToggle label="Ativar Mercado Pago" checked={data.mercado_pago_enabled} onChange={(v) => set("mercado_pago_enabled", v)} description="Processa pagamentos via Pix, cartão e boleto" />
                </div>
                <AdminSelect label="Ambiente" value={data.mercado_pago_mode} onChange={(v) => set("mercado_pago_mode", v)} options={[{ value: "sandbox", label: "Sandbox (teste)" }, { value: "production", label: "Produção" }]} />
                <div />
            </AdminFormSection>

            <AdminFormSection title="Métodos de pagamento">
                <div className="sm:col-span-2 space-y-1">
                    <AdminToggle label="Pix" checked={data.pix_enabled} onChange={(v) => set("pix_enabled", v)} description="Pagamento instantâneo com QR Code" />
                    <AdminToggle label="Cartão de crédito/débito" checked={data.card_enabled} onChange={(v) => set("card_enabled", v)} description="Pagamento via cartão com parcelamento" />
                    <AdminToggle label="Boleto bancário" checked={data.boleto_enabled} onChange={(v) => set("boleto_enabled", v)} description="Pagamento via boleto (compensação em 1-2 dias)" />
                </div>
            </AdminFormSection>

            <AdminFormSection title="Parcelamento">
                <AdminInput label="Número máximo de parcelas" type="number" value={data.max_installments} onChange={(v) => set("max_installments", parseInt(v) || 1)} />
                <AdminInput label="Parcelas sem juros" type="number" value={data.interest_free_installments} onChange={(v) => set("interest_free_installments", parseInt(v) || 0)} />
                <AdminInput label="Desconto no Pix (%)" type="number" value={data.pix_discount} onChange={(v) => set("pix_discount", parseFloat(v) || 0)} description="Desconto adicional para pagamentos via Pix" />
                <div />
            </AdminFormSection>

            <AdminFormSection title="Status da integração">
                <div className="sm:col-span-2">
                    <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg border border-border">
                        <AlertCircle className="w-4 h-4 text-muted-foreground shrink-0" strokeWidth={1.5} />
                        <div className="text-xs">
                            <p className="text-muted-foreground">Status: <span className="text-foreground font-medium">Não configurado</span></p>
                            <p className="text-muted-foreground mt-0.5">Configure os secrets <code className="text-foreground">MERCADO_PAGO_ACCESS_TOKEN</code> e <code className="text-foreground">MERCADO_PAGO_PUBLIC_KEY</code> no ambiente seguro da Base44</p>
                        </div>
                    </div>
                    <button onClick={() => alert("Configure os secrets MERCADO_PAGO_ACCESS_TOKEN e MERCADO_PAGO_PUBLIC_KEY no ambiente seguro da Base44 (Dashboard → Settings → Environment Variables) para ativar esta integração.")} className="btn-outline mt-3 text-xs">
                        Testar conexão
                    </button>
                </div>
            </AdminFormSection>
        </div>
    );
}