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
                <AdminTextarea label="Texto da barra superior" value={data.top_bar_text} onChange={(v) => set("top_bar_text", v)} rows={2} full description="Aparece no topo da loja pública; confirme as condições comerciais antes de publicar" placeholder="Mensagem aprovada para a barra superior" />
            </AdminFormSection>
            <AdminFormSection title="Frete">
                <p className="text-sm text-muted-foreground">Frete grátis a partir de R$ 499 após descontos. Configuração aplicada no servidor.</p>
                <p className="text-sm">Parcelamento e juros são administrados em Configurações → Pagamentos → Parcelamento e Juros.</p>
                <div />
            </AdminFormSection>
            <AdminFormSection title="Controle de estoque">
                <div className="sm:col-span-2 space-y-1">
                    <p className="text-sm text-muted-foreground">O checkout apenas consulta disponibilidade. A reserva ocorre ao iniciar o pagamento; a venda é contabilizada após confirmação oficial.</p>
                    <AdminToggle label="Mostrar alerta de estoque baixo" checked={data.show_low_stock} onChange={(v) => set("show_low_stock", v)} description="Exibe alerta no painel quando o estoque está abaixo do limite" />
                </div>
                <AdminInput label="Limite de estoque baixo" type="number" value={data.low_stock_threshold} onChange={(v) => set("low_stock_threshold", parseInt(v) || 0)} description="Unidades abaixo das quais o estoque é considerado baixo" />
                <div />
            </AdminFormSection>
        </div>
    );
}
