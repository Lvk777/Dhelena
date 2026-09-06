import React, { useState } from "react";
import { Loader2, Mail, Check, KeyRound } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";

export default function ChangePassword() {
    const { user } = useAuth();
    const [sent, setSent] = useState(false);
    const [loading, setLoading] = useState(false);

    const sendLink = async () => {
        setLoading(true);
        try {
            await base44.auth.resetPasswordRequest(user?.email);
            setSent(true);
        } catch {
            setSent(true); // always show success
        } finally {
            setLoading(false);
        }
    };

    return (
        <div>
            <h1 className="font-heading text-3xl tracking-[0.03em] mb-6">Alterar senha</h1>

            <div className="bg-[hsl(var(--bone))] p-8 max-w-lg">
                <KeyRound className="w-8 h-8 text-[hsl(var(--gold))] mb-4" strokeWidth={1.25} />

                {sent ? (
                    <div className="text-center py-4">
                        <div className="w-12 h-12 rounded-full bg-[hsl(var(--gold))] mx-auto flex items-center justify-center mb-4">
                            <Check className="w-6 h-6 text-white" strokeWidth={1.5} />
                        </div>
                        <p className="text-sm text-foreground leading-relaxed">
                            Enviamos um link de redefinição de senha para <strong>{user?.email}</strong>.
                            Verifique sua caixa de entrada e siga as instruções.
                        </p>
                    </div>
                ) : (
                    <>
                        <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                            Para garantir sua segurança, enviamos um link de redefinição de senha para o seu e-mail cadastrado.
                            Clique no botão abaixo para receber o link.
                        </p>
                        <button onClick={sendLink} disabled={loading} className="btn-gold w-full">
                            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Enviando...</> : <><Mail className="w-4 h-4" strokeWidth={1.5} /> Enviar link de redefinição</>}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}