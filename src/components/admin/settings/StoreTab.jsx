import React from "react";
import { ShoppingBag } from "lucide-react";
import AdminFormSection from "@/components/admin/AdminFormSection";
import AdminInput from "@/components/admin/AdminInput";
import AdminTextarea from "@/components/admin/AdminTextarea";
import AdminToggle from "@/components/admin/AdminToggle";

export default function StoreTab({ data, onChange }) {
    const set = (k, v) => onChange({ ...data, [k]: v });
    return (
        <div className="space-y-5">
            <AdminFormSection title="Barra superior" icon={ShoppingBag}>
                <AdminTextarea label="Texto da barra superior" value={data.top_bar_text} onChange={(v) => set("top_bar_text", v)} rows={2} full description="Aparece no topo da loja pública" placeholder="Frete grátis acima de R$ 499 · Parcelamos em até 6x" />
            </AdminFormSection>
            <AdminFormSection title="Frete e parcelamento">
                <AdminInput label="Valor mínimo para frete grátis (R$)" type="number" value={data.free_shipping_threshold} onChange={(v) => set("free_shipping_threshold", parseFloat(v) || 0)} />
                <AdminInput label="Quantidade máxima de parcelas" type="number" value={data.max_installments} onChange={(v) => set("max_installments", parseInt(v) || 1)} />
                <AdminInput label="Parcelas sem juros" type="number" value={data.interest_free_installments} onChange={(v) => set("interest_free_installments", parseInt(v) || 0)} description="Número de parcelas sem juros no cartão" />
                <div />
            </AdminFormSection>
            <AdminFormSection title="Controle de estoque">
                <div className="sm:col-span-2 space-y-1">
                    <AdminToggle label="Permitir venda sem estoque" checked={data.allow_out_of_stock} onChange={(v) => set("allow_out_of_stock", v)} description="Permite comprar produtos mesmo sem estoque disponível (não recomendado)" />
                    <AdminToggle label="Mostrar alerta de estoque baixo" checked={data.show_low_stock} onChange={(v) => set("show_low_stock", v)} description="Exibe alerta no painel quando o estoque está abaixo do limite" />
                </div>
                <AdminInput label="Limite de estoque baixo" type="number" value={data.low_stock_threshold} onChange={(v) => set("low_stock_threshold", parseInt(v) || 0)} description="Unidades abaixo das quais o estoque é considerado baixo" />
                <div />
            </AdminFormSection>
        </div>
    );
}