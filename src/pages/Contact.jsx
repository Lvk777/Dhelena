import React, { useState } from "react";
import { Instagram, MessageCircle, Mail, MapPin, Phone } from "lucide-react";
import { useStore } from "@/context/StoreContext";
import { usePublicSettings } from '@/context/PublicSettingsContext';
import { base44 } from '@/api/base44Client';
import { instagramLink, whatsappLink, validEmail } from '../../backend/src/lib/navigation.js';

export default function Contact() {
    const { showToast } = useStore();
    const { settings } = usePublicSettings();
    const general = settings.general || {};
    const whatsapp = whatsappLink(general.whatsapp || settings.social?.whatsapp);
    const instagram = instagramLink(settings.social?.instagram);
    const email = validEmail(general.email) ? general.email : '';
    const phone = whatsappLink(general.phone) ? general.phone : '';
    const [form, setForm] = useState({ nome: "", email: "", assunto: "", mensagem: "", website: "" });
    const [sending, setSending] = useState(false);
    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

    const submit = async (e) => {
        e.preventDefault();
        setSending(true);
        try {
            await base44.custom.submitContact({
                    name: form.nome, email: form.email, subject: form.assunto,
                    message: form.mensagem, website: form.website, // honeypot
            });
                showToast("Mensagem enviada. Retornaremos em breve ♡");
                setForm({ nome: "", email: "", assunto: "", mensagem: "", website: "" });
        } catch {
            showToast("Erro de conexão. Tente novamente.", 'error');
        } finally {
            setSending(false);
        }
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
                        {whatsapp && <ContactRow icon={MessageCircle} label="WhatsApp" value="Conversar com a boutique" link={whatsapp} />}
                        {phone && <ContactRow icon={Phone} label="Telefone" value={phone} link={`tel:${phone.replace(/[^+\d]/g, '')}`} />}
                        {email && <ContactRow icon={Mail} label="E-mail" value={email} link={`mailto:${encodeURIComponent(email)}`} />}
                        {instagram && <ContactRow icon={Instagram} label="Instagram" value="Instagram da boutique" link={instagram} />}
                        {general.public_address && <ContactRow icon={MapPin} label="Boutique" value={general.public_address} />}
                    </div>
                    {general.business_hours && <div className="mt-10 p-6 border border-border bg-[hsl(var(--bone))]">
                        <p className="text-[11px] uppercase tracking-[0.22em] text-foreground mb-2">Horário de atendimento</p>
                        <p className="text-sm text-muted-foreground whitespace-pre-line break-words">{general.business_hours}</p>
                    </div>}
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
                    {/* Honeypot — hidden from real users, bots fill it */}
                    <input
                        type="text"
                        name="website"
                        value={form.website}
                        onChange={(e) => set("website", e.target.value)}
                        style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', opacity: 0 }}
                        tabIndex={-1}
                        autoComplete="off"
                        aria-hidden="true"
                    />
                    <button type="submit" disabled={sending} className="btn-gold w-full disabled:opacity-40">
                        {sending ? "Enviando..." : "Enviar mensagem"}
                    </button>
                </form>
            </div>
        </div>
    );
}

function ContactRow({ icon: Icon, label, value, link = "" }) {
    const content = (
        <div className="flex items-center gap-4">
            <div className="w-11 h-11 shrink-0 rounded-full border border-border flex items-center justify-center text-[hsl(var(--gold))]">
                <Icon className="w-5 h-5" strokeWidth={1.25} />
            </div>
            <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
                <p className="text-sm text-foreground mt-0.5 whitespace-pre-line break-words">{value}</p>
            </div>
        </div>
    );
    return link ? <a href={link} target="_blank" rel="noreferrer" className="block hover:opacity-80 transition-opacity">{content}</a> : content;
}

function Field({ label, value, onChange }) {
    const id = React.useId();
    return (
        <div>
            <label htmlFor={id} className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">{label}</label>
            <input id={id} type={label === 'E-mail' ? 'email' : 'text'} required={label !== 'Assunto'} value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-border px-4 py-3.5 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors" />
        </div>
    );
}
