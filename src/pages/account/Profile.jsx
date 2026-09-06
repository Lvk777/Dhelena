import React, { useState, useEffect } from "react";
import { Loader2, Check } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";

const maskCPF = (v) => v.replace(/\D/g, "").slice(0, 11).replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
const maskPhone = (v) => v.replace(/\D/g, "").slice(0, 11).replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");

export default function Profile() {
    const { user, checkUserAuth } = useAuth();
    const [form, setForm] = useState({ name: "", email: "", phone: "", cpf: "", birth_date: "" });
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [saveError, setSaveError] = useState("");

    useEffect(() => {
        if (user) {
            setForm({
                name: user.full_name || "",
                email: user.email || "",
                phone: user.phone || "",
                cpf: user.cpf || "",
                birth_date: user.birth_date || "",
            });
        }
    }, [user]);

    const set = (k, v) => { setSaved(false); setSaveError(""); setForm((f) => ({ ...f, [k]: v })); };

    const save = async () => {
        setSaving(true);
        try {
            await base44.auth.updateMe({
                phone: form.phone,
                cpf: form.cpf,
                birth_date: form.birth_date,
            });
            await checkUserAuth();
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch (e) {
            setSaveError("Erro ao salvar dados. Tente novamente.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <h1 className="font-heading text-3xl tracking-[0.03em] mb-6">Meus dados</h1>

            <div className="bg-[hsl(var(--bone))] p-8 max-w-xl">
                <div className="space-y-5">
                    <Field label="Nome completo" value={form.name} onChange={(v) => set("name", v)} />
                    <Field label="E-mail" value={form.email} disabled />
                    <Field label="Telefone" value={form.phone} onChange={(v) => set("phone", maskPhone(v))} />
                    <Field label="CPF" value={form.cpf} onChange={(v) => set("cpf", maskCPF(v))} />
                    <Field label="Data de nascimento" type="date" value={form.birth_date} onChange={(v) => set("birth_date", v)} />
                </div>
                <div className="flex items-center gap-4 mt-8">
                    <button onClick={save} disabled={saving} className="btn-gold">
                        {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</> : "Salvar alterações"}
                    </button>
                    {saved && <span className="flex items-center gap-1.5 text-sm text-[hsl(var(--rose))]"><Check className="w-4 h-4" strokeWidth={1.5} /> Dados atualizados</span>}
                </div>
                {saveError && <p className="text-sm text-destructive mt-3">{saveError}</p>}
                <p className="text-[11px] text-muted-foreground mt-4">O e-mail não pode ser alterado. Para atualizar, entre em contato com o suporte.</p>
            </div>
        </div>
    );
}

function Field({ label, value, onChange, type = "text", disabled }) {
    return (
        <div>
            <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">{label}</label>
            <input
                type={type}
                value={value}
                onChange={(e) => onChange?.(e.target.value)}
                disabled={disabled}
                className="w-full border border-border bg-background px-4 py-3.5 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors disabled:opacity-50 disabled:bg-bone"
            />
        </div>
    );
}