import React, { useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function AdminUpload({ label, value, onChange, description, aspect = "3/4", full }) {
    const [uploading, setUploading] = useState(false);

    const upload = async (file) => {
        setUploading(true);
        try {
            const { file_url } = await base44.integrations.Core.UploadFile({ file });
            onChange(file_url);
        } catch (e) {
            console.error("Erro ao enviar arquivo:", e);
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className={full ? "sm:col-span-2" : ""}>
            {label && <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">{label}</label>}
            {value && (
                <div className="mb-2 overflow-hidden rounded-lg bg-bone border border-border" style={{ aspectRatio: aspect }}>
                    <img src={value} alt="" className="w-full h-full object-cover" />
                </div>
            )}
            <label className="btn-outline w-full cursor-pointer flex items-center justify-center gap-2">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" strokeWidth={1.5} />}
                {uploading ? "Enviando..." : value ? "Trocar imagem" : "Enviar imagem"}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files[0] && upload(e.target.files[0])} />
            </label>
            {description && <p className="text-[11px] text-muted-foreground mt-1.5">{description}</p>}
        </div>
    );
}