import React from "react";
import { Store } from "lucide-react";
import AdminFormSection from "@/components/admin/AdminFormSection";
import AdminInput from "@/components/admin/AdminInput";
import AdminUpload from "@/components/admin/AdminUpload";

export default function GeneralTab({ data, onChange }) {
    const set = (k, v) => onChange({ ...data, [k]: v });
    return (
        <div className="space-y-5">
            <AdminFormSection title="Identificação da loja" icon={Store}>
                <AdminInput label="Nome da loja" value={data.store_name} onChange={(v) => set("store_name", v)} required />
                <AdminInput label="Nome fantasia" value={data.trade_name} onChange={(v) => set("trade_name", v)} />
                <AdminInput label="Razão social" value={data.company_name} onChange={(v) => set("company_name", v)} />
                <AdminInput label="CNPJ" value={data.cnpj} onChange={(v) => set("cnpj", v)} placeholder="00.000.000/0000-00" />
            </AdminFormSection>
            <AdminFormSection title="Contato">
                <AdminInput label="E-mail principal" value={data.email} onChange={(v) => set("email", v)} type="email" placeholder="contato@dhelenas.com.br" />
                <AdminInput label="Telefone" value={data.phone} onChange={(v) => set("phone", v)} placeholder="(11) 3000-0000" />
                <AdminInput label="WhatsApp" value={data.whatsapp} onChange={(v) => set("whatsapp", v)} placeholder="(11) 99999-9999" full />
            </AdminFormSection>
            <AdminFormSection title="Identidade visual">
                <AdminUpload label="Logo" value={data.logo} onChange={(v) => set("logo", v)} aspect="3/1" description="Logo principal da loja" />
                <AdminUpload label="Logo (Dark Mode)" value={data.logo_dark} onChange={(v) => set("logo_dark", v)} aspect="3/1" description="Versão opcional para fundos escuros" />
                <AdminUpload label="Favicon" value={data.favicon} onChange={(v) => set("favicon", v)} aspect="1/1" description="Ícone da aba do navegador" />
            </AdminFormSection>
            <AdminFormSection title="Localização">
                <AdminInput label="Moeda" value={data.currency} onChange={(v) => set("currency", v)} disabled description="Real (BRL) — moeda padrão" />
                <AdminInput label="Fuso horário" value={data.timezone} onChange={(v) => set("timezone", v)} disabled description="America/Sao_Paulo — fuso padrão" />
            </AdminFormSection>
        </div>
    );
}