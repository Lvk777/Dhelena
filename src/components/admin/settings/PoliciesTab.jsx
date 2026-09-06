import React from "react";
import { FileText } from "lucide-react";
import AdminTextarea from "@/components/admin/AdminTextarea";

export default function PoliciesTab({ data, onChange }) {
    const set = (k, v) => onChange({ ...data, [k]: v });
    return (
        <div className="space-y-5">
            <PolicySection icon={FileText} title="Política de troca e devolução" value={data.return_policy} onChange={(v) => set("return_policy", v)} />
            <PolicySection icon={FileText} title="Política de privacidade" value={data.privacy_policy} onChange={(v) => set("privacy_policy", v)} />
            <PolicySection icon={FileText} title="Termos de uso" value={data.terms_of_use} onChange={(v) => set("terms_of_use", v)} />
            <PolicySection icon={FileText} title="Política de entrega" value={data.shipping_policy} onChange={(v) => set("shipping_policy", v)} />
        </div>
    );
}

function PolicySection({ icon: Icon, title, value, onChange }) {
    return (
        <div className="border border-border rounded-xl p-5 bg-background/50">
            <div className="flex items-center gap-2 mb-4">
                <Icon className="w-4 h-4 text-accent" strokeWidth={1.5} />
                <h3 className="text-[11px] uppercase tracking-[0.2em] text-foreground font-medium">{title}</h3>
            </div>
            <AdminTextarea value={value || ""} onChange={onChange} rows={6} full placeholder={`Escreva aqui a ${title.toLowerCase()}...`} />
        </div>
    );
}