import React from "react";
import { Share2, Instagram, Facebook, Music2, MessageCircle } from "lucide-react";
import AdminFormSection from "@/components/admin/AdminFormSection";

export default function SocialTab({ data, onChange }) {
    const set = (k, v) => onChange({ ...data, [k]: v });
    return (
        <div className="space-y-5">
            <AdminFormSection title="Redes sociais" icon={Share2} description="Os links cadastrados aqui aparecem automaticamente na loja pública">
                <SocialInput icon={Instagram} label="Instagram" value={data.instagram} onChange={(v) => set("instagram", v)} placeholder="@dhelenas ou https://instagram.com/dhelenas" />
                <SocialInput icon={Facebook} label="Facebook" value={data.facebook} onChange={(v) => set("facebook", v)} placeholder="https://facebook.com/dhelenas" />
                <SocialInput icon={Music2} label="TikTok" value={data.tiktok} onChange={(v) => set("tiktok", v)} placeholder="@dhelenas ou https://tiktok.com/@dhelenas" />
                <SocialInput icon={MessageCircle} label="WhatsApp" value={data.whatsapp} onChange={(v) => set("whatsapp", v)} placeholder="https://wa.me/5511999999999" />
            </AdminFormSection>
        </div>
    );
}

function SocialInput({ icon: Icon, label, value, onChange, placeholder }) {
    return (
        <div>
            <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">{label}</label>
            <div className="relative">
                <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" strokeWidth={1.5} />
                <input value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="admin-field pl-10" />
            </div>
        </div>
    );
}