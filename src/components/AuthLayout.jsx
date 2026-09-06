import React from "react";
import { Link } from "react-router-dom";

export default function AuthLayout({ title, subtitle, footer, children }) {
    return (
        <div className="min-h-screen flex flex-col bg-background">
            <div className="flex-1 flex items-center justify-center px-4 py-12">
                <div className="w-full max-w-md">
                    <div className="text-center mb-10">
                        <Link to="/" className="inline-block">
                            <span className="block font-heading text-3xl tracking-[0.08em] text-foreground">D'Helenas</span>
                            <span className="block text-[8px] uppercase tracking-[0.4em] text-[hsl(var(--gold))] mt-1">Método Ponte</span>
                        </Link>
                    </div>
                    <div className="text-center mb-8">
                        <h1 className="font-heading text-3xl tracking-[0.03em] text-foreground">{title}</h1>
                        {subtitle && <p className="text-sm text-muted-foreground mt-2">{subtitle}</p>}
                        <div className="flex justify-center mt-4"><div className="gold-rule" /></div>
                    </div>
                    <div className="bg-[hsl(var(--bone))] p-8">
                        {children}
                    </div>
                    {footer && (
                        <p className="text-center text-sm text-muted-foreground mt-6">{footer}</p>
                    )}
                </div>
            </div>
        </div>
    );
}