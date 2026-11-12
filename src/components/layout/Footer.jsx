import React from "react";
import { Link } from "react-router-dom";
import { Instagram, MessageCircle } from "lucide-react";
import { usePublicSettings } from "@/context/PublicSettingsContext";
import { instagramLink, whatsappLink, validCnpjFormat } from '../../../backend/src/lib/navigation.js';

export default function Footer() {
    const { settings } = usePublicSettings();
    const instLink = instagramLink(settings.social?.instagram);
    const wppLink = whatsappLink(settings.general?.whatsapp || settings.social?.whatsapp);
    const company = settings.general?.company_name;
    const tradeName = settings.general?.trade_name;
    const cnpj = settings.general?.cnpj;
    const realCnpj = validCnpjFormat(cnpj);
    return (
        <footer className="bg-[hsl(var(--rose-deep))] border-t border-[hsl(var(--rose-deep))] mt-24">
            <div className="container-boutique py-16">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-10">
                    {/* brand */}
                    <div className="col-span-2 lg:col-span-2">
                        <span className="font-heading text-2xl tracking-[0.08em] text-on-dark">D'Helenas</span>
                        <p className="text-[8px] uppercase tracking-[0.4em] text-on-dark mt-1">Método Ponte</p>
                        <p className="mt-5 text-sm text-on-dark/90 leading-relaxed max-w-xs">
                            Moda feminina e acessórios. Mais que moda, conectamos mulheres, histórias e legados.
                        </p>
                        <div className="flex items-center gap-3 mt-6">
                            {instLink && <a href={instLink} target="_blank" rel="noopener noreferrer" className="w-11 h-11 rounded-full border border-on-dark/25 flex items-center justify-center text-on-dark/90 hover:border-on-dark hover:text-on-dark transition-colors" aria-label="Instagram">
                                <Instagram className="w-4 h-4" strokeWidth={1.25} />
                            </a>}
                            {wppLink && <a href={wppLink} target="_blank" rel="noopener noreferrer" className="w-11 h-11 rounded-full border border-on-dark/25 flex items-center justify-center text-on-dark/90 hover:border-on-dark hover:text-on-dark transition-colors" aria-label="WhatsApp">
                                <MessageCircle className="w-4 h-4" strokeWidth={1.25} />
                            </a>}
                        </div>
                    </div>

                    {/* institucional */}
                    <FooterCol title="Institucional" links={[
                        { label: "Nossa história", to: "/sobre" },
                        { label: "Contato", to: "/contato" },
                        { label: "Trocas e devoluções", to: "/trocas-e-devolucoes" },
                        { label: "Política de privacidade", to: "/politica-de-privacidade" },
                        { label: "Termos de uso", to: "/termos-de-uso" },
                    ]} />

                    <FooterCol title="Atendimento" links={[
                        { label: "Política de entrega", to: "/politica-de-entrega" },
                        { label: "Dúvidas frequentes", to: "/contato" },
                        { label: "Coleções", to: "/colecoes" },
                        { label: "Novidades", to: "/loja?filtro=novidades" },
                    ]} />

                    <div>
                        {tradeName && <p className="text-[11px] text-on-dark/90 mt-5 leading-relaxed break-words">{tradeName}</p>}
                        {company && realCnpj && <p className="text-[11px] text-on-dark/90 mt-2 leading-relaxed break-words">{company} · CNPJ {cnpj}</p>}
                    </div>
                </div>

                <div className="mt-14 pt-6 border-t border-on-dark/15 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <p className="text-[11px] tracking-wide text-on-dark/90">© {new Date().getFullYear()} D'Helenas. Todos os direitos reservados.</p>
                    <div className="flex items-center gap-4">
                        <p className="text-[11px] tracking-[0.2em] uppercase text-on-dark/90">Moda que conecta histórias</p>
                    </div>
                </div>
            </div>
        </footer>
    );
}

function FooterCol({ title, links }) {
    return (
        <div>
            <h2 className="text-[11px] uppercase tracking-[0.22em] text-on-dark mb-5">{title}</h2>
            <ul className="space-y-3">
                {links.map((l) => (
                    <li key={l.label}>
                        <Link to={l.to} className="text-sm text-on-dark/90 hover:text-on-dark hover:underline transition-colors">{l.label}</Link>
                    </li>
                ))}
            </ul>
        </div>
    );
}
