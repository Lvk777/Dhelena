import React from "react";
import { Mail } from "lucide-react";
import AdminFormSection from "@/components/admin/AdminFormSection";
import AdminInput from "@/components/admin/AdminInput";
import AdminToggle from "@/components/admin/AdminToggle";

export default function EmailsTab({ data, onChange }) {
    const set = (k, v) => onChange({ ...data, [k]: v });
    return (
        <div className="space-y-5">
            <AdminFormSection title="Remetente" icon={Mail}>
                <AdminInput label="Nome do remetente" value={data.sender_name} onChange={(v) => set("sender_name", v)} placeholder="D'Helenas" />
                <AdminInput label="E-mail do remetente" value={data.sender_email} onChange={(v) => set("sender_email", v)} type="email" placeholder="contato@dhelenas.com.br" />
                <AdminInput label="Responder para" value={data.reply_to} onChange={(v) => set("reply_to", v)} type="email" placeholder="contato@dhelenas.com.br" description="E-mail que recebe respostas dos clientes" full />
            </AdminFormSection>
            <AdminFormSection title="Notificações transacionais" description="Selecione quais eventos disparam e-mails automáticos para o cliente">
                <div className="sm:col-span-2 space-y-1">
                    <AdminToggle label="Pedido recebido" checked={data.order_received} onChange={(v) => set("order_received", v)} description="Confirmação de pedido realizado" />
                    <AdminToggle label="Pagamento aprovado" checked={data.payment_approved} onChange={(v) => set("payment_approved", v)} description="Confirmação de pagamento" />
                    <AdminToggle label="Pedido em separação" checked={data.order_separation} onChange={(v) => set("order_separation", v)} description="Pedido sendo separado para envio" />
                    <AdminToggle label="Pedido enviado" checked={data.order_shipped} onChange={(v) => set("order_shipped", v)} description="Pedido despachado com rastreamento" />
                    <AdminToggle label="Pedido entregue" checked={data.order_delivered} onChange={(v) => set("order_delivered", v)} description="Confirmação de entrega" />
                    <AdminToggle label="Pedido cancelado" checked={data.order_cancelled} onChange={(v) => set("order_cancelled", v)} description="Confirmação de cancelamento" />
                </div>
            </AdminFormSection>
        </div>
    );
}