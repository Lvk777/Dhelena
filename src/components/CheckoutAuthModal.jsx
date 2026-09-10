import React from "react";
import { X, ShoppingBag } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function CheckoutAuthModal({ open, onClose }) {
    const navigate = useNavigate();
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-charcoal/40 backdrop-blur-sm animate-fade-in" onClick={onClose} />
            <div className="relative bg-background shadow-2xl w-full max-w-md p-8 text-center animate-fade-in">
                <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors" aria-label="Fechar">
                    <X className="w-5 h-5" strokeWidth={1.25} />
                </button>
                <div className="w-14 h-14 rounded-full bg-[hsl(var(--bone))] mx-auto flex items-center justify-center mb-5">
                    <ShoppingBag className="w-7 h-7 text-[hsl(var(--gold))]" strokeWidth={1.25} />
                </div>
                <h2 className="font-heading text-2xl tracking-[0.03em]">Quase lá!</h2>
                <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                    Para finalizar sua compra, entre ou crie sua conta D'Helenas.
                </p>
                <div className="mt-6 space-y-3">
                    <button
                        onClick={() => navigate("/login?returnTo=/checkout")}
                        className="btn-gold w-full py-4 text-sm"
                    >
                        Entrar
                    </button>
                    <button
                        onClick={() => navigate("/cadastro?returnTo=/checkout")}
                        className="btn-outline w-full py-4 text-sm"
                    >
                        Criar minha conta
                    </button>
                </div>
                <p className="mt-5 text-[11px] text-muted-foreground">
                    Seu carrinho será mantido.
                </p>
            </div>
        </div>
    );
}
