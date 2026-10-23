import React, { useEffect, useState } from "react";
import { base44 } from '@/api/base44Client';
import { Mail } from "lucide-react";
import AdminFormSection from "@/components/admin/AdminFormSection";
import AdminInput from "@/components/admin/AdminInput";
import AdminToggle from "@/components/admin/AdminToggle";

export default function EmailsTab({ data, onChange }) {
    const set = (k, v) => onChange({ ...data, [k]: v });
    const [readiness,setReadiness]=useState(null),[logs,setLogs]=useState([]);
    useEffect(()=>{base44.functions.invoke('notificationReadiness').then(setReadiness).catch(()=>setReadiness(null));
        base44.entities.NotificationLog.list('-created_date',20).then(setLogs).catch(()=>setLogs([]));},[]);
    return (
        <div className="space-y-5">
            <div className="border border-border p-4 text-sm space-y-1" role="status">
                <p>Comunicação transacional: {readiness?.delivery_enabled ? 'liberada' : 'aguardando homologação e autorização'}.</p>
                {readiness && <><p>Provedor configurado: {readiness.api_key_configured?'sim':'pendente'}. Remetente autorizado: {readiness.sender_and_reply_to_ready?'sim':'pendente'}.</p>
                    {!readiness.outbox_schema_ready && <p>Estrutura da fila aguarda implantação autorizada.</p>}</>}
                <p>A verificação do domínio e a entrega real precisam ser homologadas. Recuperação de senha e confirmação de cadastro usam o SMTP do Supabase Auth.</p>
            </div>
            <AdminFormSection title="Remetente" icon={Mail}>
                <AdminInput label="Nome do remetente" value={data.sender_name} onChange={(v) => set("sender_name", v)} placeholder="D'Helenas" />
                <AdminInput label="E-mail do remetente" value={data.sender_email} onChange={(v) => set("sender_email", v)} type="email" placeholder="Remetente verificado no provedor" />
                <AdminInput label="Responder para" value={data.reply_to} onChange={(v) => set("reply_to", v)} type="email" placeholder="Caixa de respostas autorizada" description="E-mail que recebe respostas dos clientes" full />
            </AdminFormSection>
            <div className="border border-border p-4 text-sm">
                <h3 className="font-medium mb-2">Histórico de comunicação</h3>
                {logs.length?logs.slice(0,20).map(log=><p key={log.id} className="py-2 border-b border-border">{log.event.split(':')[0]} · {log.channel} · {log.status} · {log.attempts} tentativa(s)</p>):<p>Nenhuma mensagem registrada.</p>}
            </div>
            <AdminFormSection title="Notificações transacionais">
                <div className="sm:col-span-2 space-y-1">
                    <AdminToggle label="Notificar a cliente" checked={data.customer_enabled !== false} onChange={(v) => set("customer_enabled", v)} description="Enviar eventos transacionais ao e-mail verificado da cliente" />
                    <AdminToggle label="Reembolso confirmado" checked={data.refund_processed !== false} onChange={(v) => set("refund_processed", v)} description="Somente após confirmação oficial do reembolso" />
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
