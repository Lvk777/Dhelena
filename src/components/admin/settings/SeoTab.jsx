import React from "react";
import { Search } from "lucide-react";
import AdminFormSection from "@/components/admin/AdminFormSection";
import AdminInput from "@/components/admin/AdminInput";
import AdminTextarea from "@/components/admin/AdminTextarea";
import AdminUpload from "@/components/admin/AdminUpload";

export default function SeoTab({ data, onChange }) {
    const set = (k, v) => onChange({ ...data, [k]: v });
    return (
        <div className="space-y-5">
            <AdminFormSection title="Meta tags" icon={Search}>
                <AdminInput label="Título padrão" value={data.default_title} onChange={(v) => set("default_title", v)} full description="Título exibido na aba do navegador e em resultados de busca" />
                <AdminTextarea label="Descrição padrão" value={data.default_description} onChange={(v) => set("default_description", v)} rows={3} full description="Descrição exibida em resultados de busca (até 160 caracteres)" />
            </AdminFormSection>
            <AdminFormSection title="Imagem de compartilhamento" description="Imagem exibida ao compartilhar o site em redes sociais (1200×630px)">
                <AdminUpload label="Imagem OG" value={data.sharing_image} onChange={(v) => set("sharing_image", v)} aspect="1.91/1" full />
            </AdminFormSection>
            <AdminFormSection title="Analytics & Pixel" description="Apenas IDs públicos — secrets privadas nunca devem ser armazenadas aqui">
                <AdminInput label="Google Analytics ID" value={data.ga_id} onChange={(v) => set("ga_id", v)} placeholder="G-XXXXXXXXXX" mono />
                <AdminInput label="Meta Pixel ID" value={data.meta_pixel_id} onChange={(v) => set("meta_pixel_id", v)} placeholder="123456789012345" mono />
            </AdminFormSection>
        </div>
    );
}