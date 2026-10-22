import React, { useEffect } from "react";
import { Instagram, MessageCircle } from "lucide-react";
import { usePublicSettings } from '@/context/PublicSettingsContext';
import { instagramLink, whatsappLink } from '../../backend/src/lib/navigation.js';

export default function ComingSoon() {
    const { settings } = usePublicSettings();
    const instagram = instagramLink(settings.social?.instagram || 'd.helenasstore');
    const whatsapp = whatsappLink(settings.general?.whatsapp || settings.social?.whatsapp);
    useEffect(() => {
        // Add noindex meta tag for SEO while in maintenance
        const meta = document.createElement('meta');
        meta.name = 'robots';
        meta.content = 'noindex, nofollow';
        document.head.appendChild(meta);
        return () => { document.head.removeChild(meta); };
    }, []);

    return (
        <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--bone))] px-6">
            <div className="text-center max-w-md">
                {/* Logo / Brand */}
                <h1 className="font-heading text-5xl sm:text-6xl tracking-[0.04em] text-foreground">
                    D'Helenas
                </h1>
                <p className="text-[11px] uppercase tracking-[0.3em] text-[hsl(var(--gold))] mt-2">
                    Método Ponte
                </p>

                <div className="flex justify-center mt-8">
                    <div className="gold-rule" />
                </div>

                {/* Message */}
                <p className="mt-8 font-heading text-xl text-foreground leading-relaxed">
                    Estamos preparando uma experiência especial para você.
                </p>
                <p className="mt-3 text-sm text-muted-foreground">
                    Em breve, nossa loja estará no ar.
                </p>

                {/* Social links */}
                <div className="flex items-center justify-center gap-4 mt-10">
                    {instagram && <a
                        href={instagram}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-11 h-11 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-[hsl(var(--gold))] transition-colors"
                        aria-label="Instagram"
                    >
                        <Instagram className="w-4 h-4" strokeWidth={1.5} />
                    </a>}
                    {whatsapp && <a
                        href={whatsapp}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-11 h-11 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-[hsl(var(--gold))] transition-colors"
                        aria-label="WhatsApp"
                    >
                        <MessageCircle className="w-4 h-4" strokeWidth={1.5} />
                    </a>}
                </div>
            </div>
        </div>
    );
}
