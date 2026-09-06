import React, { useState } from "react";
import { Instagram, MessageCircle, Mail, MapPin } from "lucide-react";
import { useStore } from "@/context/StoreContext";

export default function Contact() {
    const { showToast } = useStore();
    const [form, setForm] = useState({ nome: "", email: "", assunto: "", mensagem: "" });
    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

    const submit = (e) => {
        e.preventDefault();
        showToast("Mensagem enviada. Retornaremos em breve ♡");
        setForm({ nome: "", email: "", assunto: "", mensagem: "" });
    };

    return (
        <div>
            <div className="bg-[hsl(var(--bone))] py-16 sm:py-20 text-center">
                <div className="container-boutique">
                    <p className="eyebrow">Atendimento</p>
                    <h1 className="mt-3 font-heading text-5xl sm:text-6xl tracking-[0.03em]">Contato</h1>
                    <div className="flex justify-center mt-5"><div className="gold-rule" /></div>
                    <p className="mt-5 text-muted-foreground max-w-xl mx-auto leading-relaxed">
                        Estamos aqui para conversar, tirar dúvidas e ajudar você a encontrar a peça perfeita.
                    </p>
                </div>
            </div>

            <div className="container-boutique py-16 grid lg:grid-cols-2 gap-16">
                {/* info */}
                <div>
                    <h2 className="font-heading text-3xl tracking-[0.03em]">Fale com a boutique</h2>
                    <div className="gold-rule mt-5" />
                    <div className="mt-8 space-y-6">
                        <ContactRow icon={MessageCircle} label="WhatsApp" value="(00) 00000-0000" link="https://wa.me/5500000000000" />
                        <ContactRow icon={Mail} label="E-mail" value="atendimento@dhelenas.com.br" link="mailto:atendimento@dhelenas.com.br" />
                        <ContactRow icon={Instagram} label="Instagram" value="@dhelenas.oficial" link="https://instagram.com" />
                        <ContactRow icon={MapPin} label="Boutique física" value="Rua das Flores, 123 — Centro (sob agendamento)" />
                    </div>
                    <div className="mt-10 p-6 border border-border bg-[hsl(var(--bone))]">
                        <p className="text-[11px] uppercase tracking-[0.22em] text-foreground mb-2">Horário de atendimento</p>
                        <p className="text-sm text-muted-foreground">Segunda a sábado, das 9h às 18h.</p>
                    </div>
                </div>

                {/* form */}
                <form onSubmit={submit} className="space-y-5">
                    <Field label="Nome" value={form.nome} onChange={(v) => set("nome", v)} />
                    <Field label="E-mail" value={form.email} onChange={(v) => set("email", v)} />
                    <Field label="Assunto" value={form.assunto} onChange={(v) => set("assunto", v)} />
                    <div>
                        <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Mensagem</label>
                        <textarea value={form.mensagem} onChange={(e) => set("mensagem", e.target.value)} rows={5} className="w-full border border-border px-4 py-3.5 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors resize-none" />
                    </div>
                    <button type="submit" className="btn-gold w-full">Enviar mensagem</button>
                </form>
            </div>
        </div>
    );
}

function ContactRow({ icon: Icon, label, value, link }) {
    const content = (
        <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-full border border-border flex items-center justify-center text-[hsl(var(--gold))]">
                <Icon className="w-5 h-5" strokeWidth={1.25} />
            </div>
            <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
                <p className="text-sm text-foreground mt-0.5">{value}</p>
            </div>
        </div>
    );
    return link ? <a href={link} target="_blank" rel="noreferrer" className="block hover:opacity-80 transition-opacity">{content}</a> : content;
}

function Field({ label, value, onChange }) {
    return (
        <div>
            <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">{label}</label>
            <input value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-border px-4 py-3.5 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors" />
        </div>
    );
}