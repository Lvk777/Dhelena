import React, { useState, useEffect, useRef, useId } from "react";
import EmailChange from '@/components/account/EmailChange';
import { Loader2, Check } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { validateCPF, validatePhone } from '@/lib/forms';

const maskCPF = (v) => v.replace(/\D/g, "").slice(0, 11).replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
const maskPhone = (v) => v.replace(/\D/g, "").slice(0, 11).replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");

export default function Profile() {
    const { user, checkUserAuth } = useAuth();
    const [form, setForm] = useState({ name: "", email: "", phone: "", cpf: "", birth_date: "" });
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [saveError, setSaveError] = useState("");
    const dirty = useRef(false);

    useEffect(() => {
        if (user) {
            if (!dirty.current) setForm({
                name: user.full_name || "",
                email: user.email || "",
                phone: user.phone || "",
                cpf: user.cpf || "",
                birth_date: user.birth_date || "",
            });
            else setForm(f => ({ ...f, email: user.email || '' }));
        }
    }, [user]);

    const set = (k, v) => { dirty.current = true; setSaved(false); setSaveError(""); setForm((f) => ({ ...f, [k]: v })); };

    const save = async () => {
        if (saving) return;
        if (!form.name.trim() || form.phone && !validatePhone(form.phone) || form.cpf && !validateCPF(form.cpf)) {
            setSaveError('Confira seu nome, telefone e CPF antes de salvar.'); return;
        }
        setSaving(true);
        try {
            await base44.auth.updateMe({
                full_name: form.name,
                phone: form.phone,
                cpf: form.cpf,
                birth_date: form.birth_date,
            });
            dirty.current = false;
            await checkUserAuth();
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch (e) {
            setSaveError(e.message || "Erro ao salvar dados. Tente novamente.");
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
                    <Field label="Data de nascimento" type="date" max={new Date().toISOString().slice(0, 10)} value={form.birth_date} onChange={(v) => set("birth_date", v)} />
                </div>
                <div className="flex items-center gap-4 mt-8">
                    <button onClick={save} disabled={saving} className="btn-gold">
                        {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</> : "Salvar alterações"}
                    </button>
                    {saved && <span className="flex items-center gap-1.5 text-sm text-[hsl(var(--rose))]"><Check className="w-4 h-4" strokeWidth={1.5} /> Dados atualizados</span>}
                </div>
                {saveError && <p role="alert" className="text-sm text-destructive mt-3">{saveError}</p>}
                <EmailChange />
            </div>
        </div>
    );
}

function Field({ label, value, onChange = undefined, type = "text", disabled = false, max = undefined }) {
    const id = useId();
    return (
        <div>
            <label htmlFor={id} className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">{label}</label>
            <input
                type={type}
                id={id}
                value={value}
                onChange={(e) => onChange?.(e.target.value)}
                disabled={disabled}
                max={max}
                className="w-full border border-border bg-background px-4 py-3.5 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors disabled:opacity-50 disabled:bg-bone"
            />
        </div>
    );
}
