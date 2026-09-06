import React from "react";
import { Link } from "react-router-dom";
import { Instagram, MessageCircle } from "lucide-react";
import { usePublicSettings } from "@/context/PublicSettingsContext";

export default function Footer() {
    const { settings } = usePublicSettings();
    const instLink = settings.social?.instagram || "https://instagram.com";
    const wppLink = settings.social?.whatsapp
        ? (settings.social.whatsapp.startsWith("http") ? settings.social.whatsapp : `https://wa.me/${settings.social.whatsapp.replace(/\D/g, "")}`)
        : "https://wa.me/5500000000000";
    return (
        <footer className="bg-[hsl(var(--bone))] border-t border-border mt-24">
            <div className="container-boutique py-16">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-10">
                    {/* brand */}
                    <div className="col-span-2 lg:col-span-2">
                        <span className="font-heading text-2xl tracking-[0.08em] text-foreground">D'Helenas</span>
                        <p className="text-[8px] uppercase tracking-[0.4em] text-[hsl(var(--gold))] mt-1">Método Ponte</p>
                        <p className="mt-5 text-sm text-muted-foreground leading-relaxed max-w-xs">
                            Moda feminina e acessórios. Mais que moda, conectamos mulheres, histórias e legados.
                        </p>
                        <div className="flex items-center gap-3 mt-6">
                            <a href={instLink} target="_blank" rel="noreferrer" className="w-9 h-9 rounded-full border border-border flex items-center justify-center text-foreground/70 hover:border-[hsl(var(--gold))] hover:text-[hsl(var(--gold))] transition-colors" aria-label="Instagram">
                                <Instagram className="w-4 h-4" strokeWidth={1.25} />
                            </a>
                            <a href={wppLink} target="_blank" rel="noreferrer" className="w-9 h-9 rounded-full border border-border flex items-center justify-center text-foreground/70 hover:border-[hsl(var(--gold))] hover:text-[hsl(var(--gold))] transition-colors" aria-label="WhatsApp">
                                <MessageCircle className="w-4 h-4" strokeWidth={1.25} />
                            </a>
                        </div>
                    </div>

                    {/* institucional */}
                    <FooterCol title="Institucional" links={[
                        { label: "Nossa história", to: "/sobre" },
                        { label: "Contato", to: "/contato" },
                        { label: "Trocas e devoluções", to: "/contato" },
                        { label: "Política de privacidade", to: "/contato" },
                        { label: "Termos de uso", to: "/contato" },
                    ]} />

                    <FooterCol title="Atendimento" links={[
                        { label: "Entrega", to: "/contato" },
                        { label: "Dúvidas frequentes", to: "/contato" },
                        { label: "Coleções", to: "/colecoes" },
                        { label: "Novidades", to: "/loja?filtro=novidades" },
                    ]} />

                    <div>
                        <h4 className="text-[11px] uppercase tracking-[0.22em] text-foreground mb-5">Pagamento</h4>
                        <div className="flex flex-wrap gap-2">
                            {["Pix", "Visa", "Master", "Elo", "Débito"].map((p) => (
                                <span key={p} className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground border border-border px-2.5 py-1.5">{p}</span>
                            ))}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-5 leading-relaxed">
                            Silvestre & Sousa — CNPJ 00.000.000/0001-00
                        </p>
                    </div>
                </div>

                <div className="mt-14 pt-6 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3">
                    <p className="text-[11px] tracking-wide text-muted-foreground">© {new Date().getFullYear()} D'Helenas. Todos os direitos reservados.</p>
                    <div className="flex items-center gap-4">
                        <Link to="/admin" className="text-[11px] tracking-[0.1em] text-muted-foreground/70 hover:text-[hsl(var(--gold))] transition-colors">
                            Painel Admin
                        </Link>
                        <span className="text-muted-foreground/30">•</span>
                        <p className="text-[11px] tracking-[0.2em] uppercase text-muted-foreground">Moda que conecta histórias</p>
                    </div>
                </div>
            </div>
        </footer>
    );
}

function FooterCol({ title, links }) {
    return (
        <div>
            <h4 className="text-[11px] uppercase tracking-[0.22em] text-foreground mb-5">{title}</h4>
            <ul className="space-y-3">
                {links.map((l) => (
                    <li key={l.label}>
                        <Link to={l.to} className="text-sm text-muted-foreground hover:text-foreground transition-colors">{l.label}</Link>
                    </li>
                ))}
            </ul>
        </div>
    );
}